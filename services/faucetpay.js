import crypto from "crypto";
import pool from "../db/pool.js";

/*
=========================================================
MEMORY COINS — FAUCETPAY PAYOUT SERVICE
=========================================================

This service processes PENDING withdrawals.

Environment variables required:

FAUCETPAY_API_KEY
FAUCETPAY_API_URL

The exact FaucetPay payout endpoint and request format
must match the current FaucetPay API documentation/account
configuration before enabling live payouts.

IMPORTANT:
Never put the API key in frontend JavaScript.
Never put it in GitHub.
Never hard-code it in this file.
=========================================================
*/

const API_KEY =
  process.env.FAUCETPAY_API_KEY || "";

const API_URL =
  process.env.FAUCETPAY_API_URL || "";

/* =========================================================
   CONFIG
========================================================= */

const MAX_RETRIES = 3;

/* =========================================================
   CHECK CONFIGURATION
========================================================= */

export function isFaucetPayConfigured() {
  return Boolean(
    API_KEY &&
    API_URL
  );
}

/* =========================================================
   GENERATE IDEMPOTENCY KEY
========================================================= */

function createIdempotencyKey(
  withdrawalId
) {
  return crypto
    .createHash("sha256")
    .update(
      `memory-coins-withdrawal:${withdrawalId}`
    )
    .digest("hex");
}

/* =========================================================
   SEND PAYOUT REQUEST
=========================================================

IMPORTANT:

The endpoint/body below should only be enabled after
confirming the exact current FaucetPay payout API format.

Do not assume that an arbitrary endpoint or parameter
will work with FaucetPay.

========================================================= */

async function sendFaucetPayPayout(
  withdrawal
) {
  if (!isFaucetPayConfigured()) {
    throw new Error(
      "FAUCETPAY_NOT_CONFIGURED"
    );
  }

  const idempotencyKey =
    createIdempotencyKey(
      withdrawal.id
    );

  /*
  ---------------------------------------------------------
  IMPORTANT
  ---------------------------------------------------------

  We intentionally do not invent the live FaucetPay
  payout endpoint or request schema.

  Once the official FaucetPay API credentials and current
  payout endpoint are confirmed, this function should send
  the request here.

  ---------------------------------------------------------
  */

  const response = await fetch(
    API_URL,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        "Authorization":
          `Bearer ${API_KEY}`,

        "Idempotency-Key":
          idempotencyKey
      },

      body: JSON.stringify({
        /*
          Fill these fields according to the
          current FaucetPay payout API documentation.
        */

        withdrawalId:
          withdrawal.id,

        email:
          withdrawal.faucetpay_email,

        amount:
          Number(
            withdrawal.amount_usd
          )
      })
    }
  );

  const text =
    await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      raw: text
    };
  }

  if (!response.ok) {
    const error =
      new Error(
        "FAUCETPAY_REQUEST_FAILED"
      );

    error.status =
      response.status;

    error.response =
      data;

    throw error;
  }

  return data;
}

/* =========================================================
   PROCESS ONE WITHDRAWAL
========================================================= */

export async function processWithdrawal(
  withdrawalId
) {
  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    /*
    Lock the withdrawal so two workers cannot
    process the same payout simultaneously.
    */

    const result =
      await client.query(
        `
        SELECT
          id,
          user_id,
          provider,
          amount_coins,
          amount_usd,
          faucetpay_email,
          status,
          provider_transaction_id
        FROM withdrawals
        WHERE id = $1
        FOR UPDATE
        `,
        [withdrawalId]
      );

    if (result.rowCount === 0) {
      throw new Error(
        "WITHDRAWAL_NOT_FOUND"
      );
    }

    const withdrawal =
      result.rows[0];

    /*
    Only pending withdrawals can be processed.
    */

    if (
      withdrawal.status !==
      "pending"
    ) {
      throw new Error(
        "WITHDRAWAL_NOT_PENDING"
      );
    }

    /*
    Mark as processing before external request.
    */

    await client.query(
      `
      UPDATE withdrawals
      SET
        status = 'processing',
        updated_at = NOW()
      WHERE id = $1
      `,
      [withdrawalId]
    );

    await client.query(
      "COMMIT"
    );

    /*
    ---------------------------------------------------------
    External FaucetPay request happens AFTER COMMIT.
    ---------------------------------------------------------
    */

    let payoutResult;

    try {
      payoutResult =
        await sendFaucetPayPayout(
          withdrawal
        );

    } catch (error) {

      /*
      Mark payout as failed.
      */

      await markWithdrawalFailed(
        withdrawalId,
        error.message
      );

      throw error;
    }

    /*
    Get provider transaction ID.

    The exact property name depends on the
    current FaucetPay API response.
    */

    const providerTransactionId =
      payoutResult?.transactionId ||
      payoutResult?.transaction_id ||
      payoutResult?.txid ||
      payoutResult?.id ||
      null;

    if (
      !providerTransactionId
    ) {
      await markWithdrawalFailed(
        withdrawalId,
        "Missing provider transaction ID."
      );

      throw new Error(
        "MISSING_PROVIDER_TRANSACTION_ID"
      );
    }

    /*
    Mark successful payout.
    */

    const finalResult =
      await pool.query(
        `
        UPDATE withdrawals
        SET
          status = 'paid',
          provider_transaction_id = $1,
          processed_at = NOW(),
          updated_at = NOW()
        WHERE id = $2
          AND status = 'processing'
        RETURNING
          id,
          status,
          provider_transaction_id,
          processed_at
        `,
        [
          String(
            providerTransactionId
          ),
          withdrawalId
        ]
      );

    if (
      finalResult.rowCount === 0
    ) {
      throw new Error(
        "WITHDRAWAL_STATE_UPDATE_FAILED"
      );
    }

    return {
      success: true,
      withdrawal:
        finalResult.rows[0]
    };

  } catch (error) {

    /*
    If transaction is still open,
    roll it back.
    */

    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {
      // Ignore rollback errors.
    }

    throw error;

  } finally {
    client.release();
  }
}

/* =========================================================
   MARK WITHDRAWAL FAILED
========================================================= */

async function markWithdrawalFailed(
  withdrawalId,
  reason
) {
  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    const result =
      await client.query(
        `
        SELECT
          id,
          user_id,
          amount_coins,
          status
        FROM withdrawals
        WHERE id = $1
        FOR UPDATE
        `,
        [withdrawalId]
      );

    if (
      result.rowCount === 0
    ) {
      throw new Error(
        "WITHDRAWAL_NOT_FOUND"
      );
    }

    const withdrawal =
      result.rows[0];

    /*
    Only refund a withdrawal that was
    actually being processed.
    */

    if (
      withdrawal.status !==
      "processing"
    ) {
      await client.query(
        "COMMIT"
      );

      return;
    }

    /*
    Lock the user.
    */

    const userResult =
      await client.query(
        `
        SELECT
          coins
        FROM users
        WHERE id = $1
        FOR UPDATE
        `,
        [withdrawal.user_id]
      );

    if (
      userResult.rowCount === 0
    ) {
      throw new Error(
        "USER_NOT_FOUND"
      );
    }

    const balanceBefore =
      Number(
        userResult.rows[0].coins
      );

    const refund =
      Number(
        withdrawal.amount_coins
      );

    const balanceAfter =
      balanceBefore + refund;

    /*
    Refund the coins.
    */

    await client.query(
      `
      UPDATE users
      SET
        coins = $1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [
        balanceAfter,
        withdrawal.user_id
      ]
    );

    /*
    Record refund transaction.
    */

    await client.query(
      `
      INSERT INTO coin_transactions (
        user_id,
        type,
        amount,
        balance_before,
        balance_after,
        reference_id,
        description
      )
      VALUES (
        $1,
        'withdrawal_refund',
        $2,
        $3,
        $4,
        $5,
        $6
      )
      `,
      [
        withdrawal.user_id,
        refund,
        balanceBefore,
        balanceAfter,
        withdrawal.id,
        `Withdrawal refund: ${reason}`
      ]
    );

    /*
    Mark withdrawal failed.
    */

    await client.query(
      `
      UPDATE withdrawals
      SET
        status = 'failed',
        failure_reason = $1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [
        String(reason).slice(
          0,
          500
        ),
        withdrawal.id
      ]
    );

    await client.query(
      "COMMIT"
    );

  } catch (error) {

    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {
      // Ignore rollback errors.
    }

    throw error;

  } finally {
    client.release();
  }
}

/* =========================================================
   PROCESS NEXT PENDING WITHDRAWAL
========================================================= */

export async function processNextWithdrawal() {
  const result =
    await pool.query(
      `
      SELECT id
      FROM withdrawals
      WHERE status = 'pending'
      ORDER BY requested_at ASC
      LIMIT 1
      `
    );

  if (
    result.rowCount === 0
  ) {
    return null;
  }

  return processWithdrawal(
    result.rows[0].id
  );
}

/* =========================================================
   PROCESS MULTIPLE PENDING WITHDRAWALS
========================================================= */

export async function processPendingWithdrawals(
  limit = 10
) {
  limit = Math.min(
    Math.max(
      Number(limit) || 10,
      1
    ),
    50
  );

  const result =
    await pool.query(
      `
      SELECT id
      FROM withdrawals
      WHERE status = 'pending'
      ORDER BY requested_at ASC
      LIMIT $1
      `,
      [limit]
    );

  const results = [];

  for (
    const row of result.rows
  ) {
    try {
      const processed =
        await processWithdrawal(
          row.id
        );

      results.push({
        id: row.id,
        success: true,
        result: processed
      });

    } catch (error) {
      results.push({
        id: row.id,
        success: false,
        error: error.message
      });
    }
  }

  return results;
}

/* =========================================================
   CONFIGURATION STATUS
========================================================= */

export function getFaucetPayStatus() {
  return {
    configured:
      isFaucetPayConfigured(),

    apiUrlConfigured:
      Boolean(API_URL),

    apiKeyConfigured:
      Boolean(API_KEY),

    maxRetries:
      MAX_RETRIES
  };
}

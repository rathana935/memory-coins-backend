import pool from "../db/pool.js";

/*
=========================================================
MEMORY COINS WITHDRAWAL SERVICE
=========================================================

Economy:
  10,000 coins = $1

Minimum:
  2,500 coins

Provider:
  FaucetPay

Important:
  This service only creates a secure PENDING withdrawal.

  It does NOT directly send funds to FaucetPay.

  A separate payout worker/API integration should process
  pending withdrawals after the FaucetPay credentials and
  payout API are configured.
=========================================================
*/

const COINS_PER_USD = 10000;
const MINIMUM_WITHDRAWAL = 2500;
const PROVIDER = "faucetpay";

/* =========================================================
   VALIDATE FAUCETPAY EMAIL
========================================================= */

function validateEmail(email) {
  if (typeof email !== "string") {
    return false;
  }

  const value = email.trim().toLowerCase();

  if (value.length < 5 || value.length > 254) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/* =========================================================
   CALCULATE USD
========================================================= */

function coinsToUsd(coins) {
  return Number(coins) / COINS_PER_USD;
}

/* =========================================================
   CREATE WITHDRAWAL
========================================================= */

export async function createWithdrawal(
  userId,
  coins,
  faucetpayEmail
) {
  const amountCoins = Number(coins);

  if (
    !Number.isSafeInteger(amountCoins) ||
    amountCoins <= 0
  ) {
    throw new Error("INVALID_AMOUNT");
  }

  if (amountCoins < MINIMUM_WITHDRAWAL) {
    throw new Error("MINIMUM_WITHDRAWAL");
  }

  if (!validateEmail(faucetpayEmail)) {
    throw new Error("INVALID_EMAIL");
  }

  const email = faucetpayEmail
    .trim()
    .toLowerCase();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /*
    Lock the user row.

    This prevents two simultaneous withdrawal requests
    from spending the same coins.
    */

    const userResult = await client.query(
      `
      SELECT
        id,
        coins,
        is_blocked
      FROM users
      WHERE id = $1
      FOR UPDATE
      `,
      [userId]
    );

    if (userResult.rowCount === 0) {
      throw new Error("USER_NOT_FOUND");
    }

    const user = userResult.rows[0];

    if (user.is_blocked) {
      throw new Error("ACCOUNT_BLOCKED");
    }

    const currentBalance = Number(user.coins);

    if (currentBalance < amountCoins) {
      throw new Error("INSUFFICIENT_BALANCE");
    }

    /*
    Prevent multiple pending withdrawals from being
    created at the same time for the same user.
    */

    const pendingResult = await client.query(
      `
      SELECT id
      FROM withdrawals
      WHERE user_id = $1
        AND status IN ('pending', 'processing')
      LIMIT 1
      `,
      [userId]
    );

    if (pendingResult.rowCount > 0) {
      throw new Error("WITHDRAWAL_PENDING");
    }

    const usdAmount = coinsToUsd(amountCoins);

    /*
    Deduct coins atomically.
    */

    const newBalance =
      currentBalance - amountCoins;

    await client.query(
      `
      UPDATE users
      SET
        coins = $1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [
        newBalance,
        userId
      ]
    );

    /*
    Create withdrawal record.
    */

    const withdrawalResult =
      await client.query(
        `
        INSERT INTO withdrawals (
          user_id,
          provider,
          amount_coins,
          amount_usd,
          faucetpay_email,
          status,
          requested_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          'pending',
          NOW(),
          NOW()
        )
        RETURNING
          id,
          provider,
          amount_coins,
          amount_usd,
          faucetpay_email,
          status,
          requested_at
        `,
        [
          userId,
          PROVIDER,
          amountCoins,
          usdAmount,
          email
        ]
      );

    const withdrawal =
      withdrawalResult.rows[0];

    /*
    Record the balance transaction.
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
        'withdrawal',
        $2,
        $3,
        $4,
        $5,
        $6
      )
      `,
      [
        userId,
        -amountCoins,
        currentBalance,
        newBalance,
        withdrawal.id,
        `FaucetPay withdrawal request: ${amountCoins} coins`
      ]
    );

    await client.query("COMMIT");

    return {
      id: withdrawal.id,
      provider: withdrawal.provider,
      amountCoins: Number(
        withdrawal.amount_coins
      ),
      amountUsd: Number(
        withdrawal.amount_usd
      ),
      faucetpayEmail:
        withdrawal.faucetpay_email,
      status: withdrawal.status,
      requestedAt:
        withdrawal.requested_at,
      newBalance
    };

  } catch (error) {
    await client.query("ROLLBACK");
    throw error;

  } finally {
    client.release();
  }
}

/* =========================================================
   GET USER WITHDRAWALS
========================================================= */

export async function getUserWithdrawals(
  userId,
  limit = 20,
  offset = 0
) {
  limit = Math.min(
    Math.max(Number(limit) || 20, 1),
    50
  );

  offset = Math.max(
    Number(offset) || 0,
    0
  );

  const result = await pool.query(
    `
    SELECT
      id,
      provider,
      amount_coins,
      amount_usd,
      faucetpay_email,
      status,
      provider_transaction_id,
      failure_reason,
      requested_at,
      processed_at,
      updated_at
    FROM withdrawals
    WHERE user_id = $1
    ORDER BY requested_at DESC
    LIMIT $2
    OFFSET $3
    `,
    [
      userId,
      limit,
      offset
    ]
  );

  return result.rows.map(row => ({
    id: row.id,
    provider: row.provider,
    amountCoins: Number(
      row.amount_coins
    ),
    amountUsd: Number(
      row.amount_usd
    ),
    faucetpayEmail:
      row.faucetpay_email,
    status: row.status,
    providerTransactionId:
      row.provider_transaction_id,
    failureReason:
      row.failure_reason,
    requestedAt:
      row.requested_at,
    processedAt:
      row.processed_at,
    updatedAt:
      row.updated_at
  }));
}

/* =========================================================
   GET SINGLE WITHDRAWAL
========================================================= */

export async function getWithdrawal(
  userId,
  withdrawalId
) {
  const result = await pool.query(
    `
    SELECT
      id,
      provider,
      amount_coins,
      amount_usd,
      faucetpay_email,
      status,
      provider_transaction_id,
      failure_reason,
      requested_at,
      processed_at,
      updated_at
    FROM withdrawals
    WHERE id = $1
      AND user_id = $2
    LIMIT 1
    `,
    [
      withdrawalId,
      userId
    ]
  );

  if (result.rowCount === 0) {
    throw new Error(
      "WITHDRAWAL_NOT_FOUND"
    );
  }

  const row = result.rows[0];

  return {
    id: row.id,
    provider: row.provider,
    amountCoins: Number(
      row.amount_coins
    ),
    amountUsd: Number(
      row.amount_usd
    ),
    faucetpayEmail:
      row.faucetpay_email,
    status: row.status,
    providerTransactionId:
      row.provider_transaction_id,
    failureReason:
      row.failure_reason,
    requestedAt:
      row.requested_at,
    processedAt:
      row.processed_at,
    updatedAt:
      row.updated_at
  };
}

/* =========================================================
   EXPORT CONFIG
========================================================= */

export const WITHDRAWAL_CONFIG = {
  provider: PROVIDER,
  coinsPerUsd: COINS_PER_USD,
  minimumCoins: MINIMUM_WITHDRAWAL
};

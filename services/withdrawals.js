import pool from "../db/pool.js";

/*
=========================================================
MEMORY CARD / MEMORY COINS
WITHDRAWAL SERVICE
=========================================================

Economy:
  10,000 coins = $1

Minimum withdrawal:
  2,500 coins

Providers:
  - FaucetPay
  - ABA Bank

IMPORTANT:
  This service creates secure PENDING withdrawals.

  It does NOT automatically send money.

  Actual FaucetPay / ABA payout processing should be
  handled by a separate payout worker or admin system.

SECURITY:
  - User row locked with FOR UPDATE
  - Balance checked inside transaction
  - Active withdrawals prevented
  - Coins deducted atomically
  - Coin transaction recorded
  - Provider-specific details validated
=========================================================
*/


/* =========================================================
   WITHDRAWAL CONFIG
========================================================= */

const COINS_PER_USD = 10000;
const MINIMUM_WITHDRAWAL = 2500;

const PROVIDERS = {
  FAUCETPAY: "faucetpay",
  ABA: "aba"
};


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
   VALIDATE ABA ACCOUNT NUMBER
========================================================= */

function validateAbaAccountNumber(accountNumber) {
  if (
    typeof accountNumber !== "string" &&
    typeof accountNumber !== "number"
  ) {
    return false;
  }

  const value = String(accountNumber).trim();

  if (value.length < 6 || value.length > 30) {
    return false;
  }

  return /^[0-9]+$/.test(value);
}


/* =========================================================
   VALIDATE ABA ACCOUNT HOLDER NAME
========================================================= */

function validateAbaAccountName(accountName) {
  if (typeof accountName !== "string") {
    return false;
  }

  const value = accountName.trim();

  if (value.length < 2 || value.length > 150) {
    return false;
  }

  return true;
}


/* =========================================================
   CALCULATE USD
========================================================= */

function coinsToUsd(coins) {
  return Number(coins) / COINS_PER_USD;
}


/* =========================================================
   NORMALIZE PROVIDER
========================================================= */

function normalizeProvider(provider) {
  if (typeof provider !== "string") {
    return null;
  }

  const value = provider.trim().toLowerCase();

  if (value === PROVIDERS.FAUCETPAY) {
    return PROVIDERS.FAUCETPAY;
  }

  if (value === PROVIDERS.ABA) {
    return PROVIDERS.ABA;
  }

  return null;
}


/* =========================================================
   MASK EMAIL
========================================================= */

function maskEmail(email) {
  if (!email) {
    return null;
  }

  const value = String(email);

  const atIndex = value.indexOf("@");

  if (atIndex <= 0) {
    return "***";
  }

  const name = value.substring(0, atIndex);
  const domain = value.substring(atIndex + 1);

  if (name.length <= 2) {
    return `*${domain ? `@${domain}` : ""}`;
  }

  return (
    name.substring(0, 2) +
    "***" +
    (domain ? `@${domain}` : "")
  );
}


/* =========================================================
   MASK ABA ACCOUNT NUMBER
========================================================= */

function maskAbaAccountNumber(accountNumber) {
  if (!accountNumber) {
    return null;
  }

  const value = String(accountNumber);

  if (value.length <= 3) {
    return "*".repeat(value.length);
  }

  return (
    "*".repeat(value.length - 3) +
    value.slice(-3)
  );
}


/* =========================================================
   FORMAT WITHDRAWAL FOR API
========================================================= */

function formatWithdrawal(row, includeSensitive = false) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,

    provider: row.provider,

    amountCoins: Number(row.amount_coins),

    amountUsd: Number(row.amount_usd),

    faucetpayEmail: includeSensitive
      ? row.faucetpay_email
      : maskEmail(row.faucetpay_email),

    abaAccountNumber: includeSensitive
      ? row.aba_account_number
      : maskAbaAccountNumber(
          row.aba_account_number
        ),

    abaAccountName:
      row.aba_account_name || null,

    status: row.status,

    providerTransactionId:
      row.provider_transaction_id || null,

    failureReason:
      row.failure_reason || null,

    requestedAt:
      row.requested_at,

    processedAt:
      row.processed_at || null,

    updatedAt:
      row.updated_at || null
  };
}


/* =========================================================
   CREATE WITHDRAWAL
========================================================= */

export async function createWithdrawal(
  userId,
  coins,
  provider,
  paymentDetails = {}
) {
  const amountCoins = Number(coins);


  /* -------------------------------------------------------
     VALIDATE AMOUNT
  ------------------------------------------------------- */

  if (
    !Number.isSafeInteger(amountCoins) ||
    amountCoins <= 0
  ) {
    throw new Error("INVALID_AMOUNT");
  }

  if (
    amountCoins < MINIMUM_WITHDRAWAL
  ) {
    throw new Error("MINIMUM_WITHDRAWAL");
  }


  /* -------------------------------------------------------
     VALIDATE PROVIDER
  ------------------------------------------------------- */

  const normalizedProvider =
    normalizeProvider(provider);

  if (!normalizedProvider) {
    throw new Error("INVALID_PROVIDER");
  }


  let faucetpayEmail = null;
  let abaAccountNumber = null;
  let abaAccountName = null;


  /* =======================================================
     FAUCETPAY
  ======================================================= */

  if (
    normalizedProvider ===
    PROVIDERS.FAUCETPAY
  ) {
    if (
      !validateEmail(
        paymentDetails.faucetpayEmail
      )
    ) {
      throw new Error("INVALID_EMAIL");
    }

    faucetpayEmail =
      paymentDetails.faucetpayEmail
        .trim()
        .toLowerCase();
  }


  /* =======================================================
     ABA BANK
  ======================================================= */

  if (
    normalizedProvider ===
    PROVIDERS.ABA
  ) {
    if (
      !validateAbaAccountNumber(
        paymentDetails.abaAccountNumber
      )
    ) {
      throw new Error(
        "INVALID_ABA_ACCOUNT"
      );
    }

    if (
      !validateAbaAccountName(
        paymentDetails.abaAccountName
      )
    ) {
      throw new Error(
        "INVALID_ABA_NAME"
      );
    }

    abaAccountNumber =
      String(
        paymentDetails.abaAccountNumber
      ).trim();

    abaAccountName =
      paymentDetails.abaAccountName.trim();
  }


  /* =======================================================
     DATABASE TRANSACTION
  ======================================================= */

  const client = await pool.connect();

  try {
    await client.query("BEGIN");


    /* =====================================================
       LOCK USER
    ===================================================== */

    const userResult =
      await client.query(
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

    const user =
      userResult.rows[0];


    /* =====================================================
       BLOCKED ACCOUNT
    ===================================================== */

    if (user.is_blocked) {
      throw new Error(
        "ACCOUNT_BLOCKED"
      );
    }


    /* =====================================================
       CURRENT BALANCE
    ===================================================== */

    const currentBalance =
      Number(user.coins);


    /* =====================================================
       CHECK BALANCE
    ===================================================== */

    if (
      currentBalance <
      amountCoins
    ) {
      throw new Error(
        "INSUFFICIENT_BALANCE"
      );
    }


    /* =====================================================
       PREVENT MULTIPLE ACTIVE WITHDRAWALS
    ===================================================== */

    const pendingResult =
      await client.query(
        `
        SELECT id
        FROM withdrawals
        WHERE user_id = $1
          AND status IN (
            'pending',
            'processing'
          )
        LIMIT 1
        `,
        [userId]
      );

    if (
      pendingResult.rowCount > 0
    ) {
      throw new Error(
        "WITHDRAWAL_PENDING"
      );
    }


    /* =====================================================
       CALCULATE USD
    ===================================================== */

    const usdAmount =
      coinsToUsd(amountCoins);


    /* =====================================================
       NEW BALANCE
    ===================================================== */

    const newBalance =
      currentBalance -
      amountCoins;


    /* =====================================================
       DEDUCT COINS
    ===================================================== */

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


    /* =====================================================
       CREATE WITHDRAWAL
    ===================================================== */

    const withdrawalResult =
      await client.query(
        `
        INSERT INTO withdrawals (
          user_id,
          provider,
          amount_coins,
          amount_usd,
          faucetpay_email,
          aba_account_number,
          aba_account_name,
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
          $6,
          $7,
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
          aba_account_number,
          aba_account_name,
          status,
          provider_transaction_id,
          failure_reason,
          requested_at,
          processed_at,
          updated_at
        `,
        [
          userId,
          normalizedProvider,
          amountCoins,
          usdAmount,
          faucetpayEmail,
          abaAccountNumber,
          abaAccountName
        ]
      );


    const withdrawal =
      withdrawalResult.rows[0];


    /* =====================================================
       RECORD COIN TRANSACTION
    ===================================================== */

    const description =
      normalizedProvider ===
      PROVIDERS.FAUCETPAY
        ? `FaucetPay withdrawal request: ${amountCoins} coins`
        : `ABA Bank withdrawal request: ${amountCoins} coins`;

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
        description
      ]
    );


    /* =====================================================
       COMMIT
    ===================================================== */

    await client.query(
      "COMMIT"
    );


    /* =====================================================
       RETURN SAFE RESPONSE
    ===================================================== */

    return {
      ...formatWithdrawal(
        withdrawal,
        false
      ),

      newBalance
    };


  } catch (error) {

    await client.query(
      "ROLLBACK"
    );

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
    Math.max(
      Number(limit) || 20,
      1
    ),
    100
  );

  offset = Math.max(
    Number(offset) || 0,
    0
  );


  const result =
    await pool.query(
      `
      SELECT
        id,
        provider,
        amount_coins,
        amount_usd,
        faucetpay_email,
        aba_account_number,
        aba_account_name,
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


  return result.rows.map(
    (row) =>
      formatWithdrawal(
        row,
        false
      )
  );
}


/* =========================================================
   GET SINGLE WITHDRAWAL
========================================================= */

export async function getWithdrawal(
  userId,
  withdrawalId
) {

  if (
    typeof withdrawalId !==
      "string" ||
    !withdrawalId.trim()
  ) {
    throw new Error(
      "WITHDRAWAL_NOT_FOUND"
    );
  }


  const result =
    await pool.query(
      `
      SELECT
        id,
        provider,
        amount_coins,
        amount_usd,
        faucetpay_email,
        aba_account_number,
        aba_account_name,
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
        withdrawalId.trim(),
        userId
      ]
    );


  if (
    result.rowCount === 0
  ) {
    throw new Error(
      "WITHDRAWAL_NOT_FOUND"
    );
  }


  return formatWithdrawal(
    result.rows[0],
    false
  );
}


/* =========================================================
   WITHDRAWAL CONFIG
========================================================= */

export const WITHDRAWAL_CONFIG = {
  coinsPerUsd:
    COINS_PER_USD,

  minimumCoins:
    MINIMUM_WITHDRAWAL,

  providers: [
    PROVIDERS.FAUCETPAY,
    PROVIDERS.ABA
  ]
};

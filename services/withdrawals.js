import pool from "../db/pool.js";

/*
=========================================================
MEMORY COINS WITHDRAWAL SERVICE
=========================================================

Economy:
  10,000 coins = $1

Minimum withdrawal:
  2,500 coins

Providers:
  - FaucetPay
  - ABA Bank

Important:
  This service creates secure PENDING withdrawals.

  It does NOT automatically send money.

  Actual FaucetPay / ABA payout processing should be
  handled by a separate payout worker or admin system.

Security:
  - User row is locked with FOR UPDATE
  - Balance is checked inside transaction
  - Active withdrawal is checked
  - Coins are deducted atomically
  - Coin transaction is recorded
  - Provider-specific payment details are validated
=========================================================
*/

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

  /*
    Keep validation flexible because account-number
    formats may vary.
  */

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
     Validate amount
  ------------------------------------------------------- */

  if (
    !Number.isSafeInteger(amountCoins) ||
    amountCoins <= 0
  ) {
    throw new Error("INVALID_AMOUNT");
  }

  if (amountCoins < MINIMUM_WITHDRAWAL) {
    throw new Error("MINIMUM_WITHDRAWAL");
  }

  /* -------------------------------------------------------
     Validate provider
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

    const currentBalance =
      Number(user.coins);

    /* =====================================================
       CHECK BALANCE
    ===================================================== */

    if (currentBalance < amountCoins) {
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
        FOR UPDATE
        `,
        [userId]
      );

    if (pendingResult.rowCount > 0) {
      throw new Error(
        "WITHDRAWAL_PENDING"
      );
    }

    /* =====================================================
       CALCULATE USD
    ===================================================== */

    const usdAmount =
      coinsToUsd(amountCoins);

    const newBalance =
      currentBalance - amountCoins;

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
          requested_at
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

    await client.query("COMMIT");

    return {
      id: withdrawal.id,

      provider:
        withdrawal.provider,

      amountCoins:
        Number(
          withdrawal.amount_coins
        ),

      amountUsd:
        Number(
          withdrawal.amount_usd
        ),

      faucetpayEmail:
        withdrawal.faucetpay_email,

      abaAccountNumber:
        withdrawal.aba_account_number,

      abaAccountName:
        withdrawal.aba_account_name,

      status:
        withdrawal.status,

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
    Math.max(
      Number(limit) || 20,

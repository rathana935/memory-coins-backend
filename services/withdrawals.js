import pool from "../db/pool.js";


/*
=========================================================
MEMORY COINS
WITHDRAWAL SERVICE
=========================================================

ECONOMY

10,000 coins = $1

MINIMUM

2,500 coins = $0.25

PAYMENT METHOD

FaucetPay ONLY

IMPORTANT

This service:

- verifies the authenticated user
- locks the user row
- checks balance inside a transaction
- prevents multiple active withdrawals
- deducts coins atomically
- creates the withdrawal record
- creates the coin transaction record
- rolls everything back if anything fails

This service DOES NOT automatically send money.

Actual FaucetPay payout should be handled separately
by an admin/payout worker.
=========================================================
*/


/* =========================================================
   CONFIGURATION
========================================================= */

const COINS_PER_USD = 10000;

const MINIMUM_WITHDRAWAL = 2500;

const PROVIDER = "faucetpay";


/* =========================================================
   EMAIL VALIDATION
========================================================= */

function validateEmail(email) {

    if (typeof email !== "string") {
        return false;
    }

    const value =
        email
            .trim()
            .toLowerCase();

    if (
        value.length < 5 ||
        value.length > 254
    ) {
        return false;
    }

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}


/* =========================================================
   NORMALIZE EMAIL
========================================================= */

function normalizeEmail(email) {

    return String(email)
        .trim()
        .toLowerCase();

}


/* =========================================================
   VALIDATE USER ID
========================================================= */

function validateUserId(userId) {

    return !(
        userId === null ||
        userId === undefined ||
        userId === ""
    );

}


/* =========================================================
   VALIDATE UUID
========================================================= */

function validateUUID(value) {

    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(String(value || ""));

}


/* =========================================================
   CALCULATE USD
========================================================= */

function coinsToUsd(coins) {

    /*
     * Keep the value at 4 decimal places.
     *
     * 2,500 coins = 0.25 USD
     * 10,000 coins = 1.00 USD
     */

    return Number(
        (
            Number(coins) /
            COINS_PER_USD
        ).toFixed(4)
    );

}


/* =========================================================
   MASK EMAIL
========================================================= */

function maskEmail(email) {

    if (!email) {
        return null;
    }

    const value =
        String(email);

    const atIndex =
        value.indexOf("@");

    if (atIndex <= 0) {
        return "***";
    }

    const name =
        value.substring(
            0,
            atIndex
        );

    const domain =
        value.substring(
            atIndex + 1
        );

    if (name.length <= 2) {

        return (
            "*" +
            `@${domain}`
        );

    }

    return (
        name.substring(0, 2) +
        "***@" +
        domain
    );

}


/* =========================================================
   FORMAT WITHDRAWAL
========================================================= */

function formatWithdrawal(
    row,
    includeSensitive = false
) {

    if (!row) {
        return null;
    }

    return {

        id:
            row.id,

        provider:
            row.provider,

        amountCoins:
            Number(row.amount_coins),

        amountUsd:
            Number(row.amount_usd),

        faucetpayEmail:
            includeSensitive
                ? row.faucetpay_email
                : maskEmail(
                    row.faucetpay_email
                ),

        status:
            row.status,

        providerTransactionId:
            row.provider_transaction_id ||
            null,

        failureReason:
            row.failure_reason ||
            null,

        requestedAt:
            row.requested_at,

        processedAt:
            row.processed_at ||
            null,

        updatedAt:
            row.updated_at ||
            null

    };

}


/* =========================================================
   CREATE WITHDRAWAL
========================================================= */

export async function createWithdrawal({

    userId,

    amountCoins,

    provider,

    faucetpayEmail

}) {

    /* =====================================================
       VALIDATE USER
    ===================================================== */

    if (!validateUserId(userId)) {

        const error =
            new Error(
                "User authentication is required."
            );

        error.code =
            "AUTHENTICATION_REQUIRED";

        error.statusCode =
            401;

        throw error;

    }


    /* =====================================================
       VALIDATE AMOUNT
    ===================================================== */

    const coins =
        Number(amountCoins);

    if (!Number.isSafeInteger(coins)) {

        const error =
            new Error(
                "Withdrawal amount must be a whole number of coins."
            );

        error.code =
            "INVALID_AMOUNT";

        error.statusCode =
            400;

        throw error;

    }

    if (coins <= 0) {

        const error =
            new Error(
                "Withdrawal amount must be greater than zero."
            );

        error.code =
            "INVALID_AMOUNT";

        error.statusCode =
            400;

        throw error;

    }


    /* =====================================================
       MINIMUM
    ===================================================== */

    if (
        coins <
        MINIMUM_WITHDRAWAL
    ) {

        const error =
            new Error(
                `Minimum withdrawal is ${MINIMUM_WITHDRAWAL.toLocaleString()} coins.`
            );

        error.code =
            "MINIMUM_WITHDRAWAL";

        error.statusCode =
            400;

        throw error;

    }


    /* =====================================================
       PROVIDER
    ===================================================== */

    const normalizedProvider =
        String(provider || "")
            .trim()
            .toLowerCase();

    if (
        normalizedProvider !==
        PROVIDER
    ) {

        const error =
            new Error(
                "Only FaucetPay withdrawals are supported."
            );

        error.code =
            "INVALID_PROVIDER";

        error.statusCode =
            400;

        throw error;

    }


    /* =====================================================
       FAUCETPAY EMAIL
    ===================================================== */

    if (
        !validateEmail(
            faucetpayEmail
        )
    ) {

        const error =
            new Error(
                "A valid FaucetPay email is required."
            );

        error.code =
            "INVALID_FAUCETPAY_EMAIL";

        error.statusCode =
            400;

        throw error;

    }

    const email =
        normalizeEmail(
            faucetpayEmail
        );


    /* =====================================================
       USD VALUE
    ===================================================== */

    const amountUsd =
        coinsToUsd(coins);


    /* =====================================================
       DATABASE
    ===================================================== */

    const client =
        await pool.connect();

    try {

        /* =================================================
           BEGIN
        ================================================= */

        await client.query(
            "BEGIN"
        );


        /* =================================================
           LOCK USER
        ================================================= */

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


        if (
            userResult.rowCount === 0
        ) {

            const error =
                new Error(
                    "User not found."
                );

            error.code =
                "USER_NOT_FOUND";

            error.statusCode =
                404;

            throw error;

        }


        const user =
            userResult.rows[0];


        /* =================================================
           BLOCKED USER
        ================================================= */

        if (
            user.is_blocked === true
        ) {

            const error =
                new Error(
                    "This account is blocked."
                );

            error.code =
                "ACCOUNT_BLOCKED";

            error.statusCode =
                403;

            throw error;

        }


        /* =================================================
           CURRENT BALANCE
        ================================================= */

        const currentBalance =
            Number(user.coins);


        if (
            !Number.isSafeInteger(
                currentBalance
            )
        ) {

            const error =
                new Error(
                    "Invalid account balance."
                );

            error.code =
                "INVALID_BALANCE";

            error.statusCode =
                500;

            throw error;

        }


        /* =================================================
           BALANCE CHECK
        ================================================= */

        if (
            currentBalance <
            coins
        ) {

            const error =
                new Error(
                    "Insufficient coin balance."
                );

            error.code =
                "INSUFFICIENT_BALANCE";

            error.statusCode =
                400;

            throw error;

        }


        /* =================================================
           ACTIVE WITHDRAWAL CHECK
        ================================================= */

        const pendingResult =
            await client.query(

                `
                SELECT
                    id
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

            const error =
                new Error(
                    "You already have a withdrawal being processed."
                );

            error.code =
                "WITHDRAWAL_PENDING";

            error.statusCode =
                409;

            throw error;

        }


        /* =================================================
           NEW BALANCE
        ================================================= */

        const newBalance =
            currentBalance -
            coins;


        /* =================================================
           DEDUCT COINS
        ================================================= */

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


        /* =================================================
           CREATE WITHDRAWAL
        ================================================= */

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
                    provider_transaction_id,
                    failure_reason,
                    requested_at,
                    processed_at,
                    updated_at
                `,

                [
                    userId,
                    PROVIDER,
                    coins,
                    amountUsd,
                    email
                ]

            );


        const withdrawal =
            withdrawalResult.rows[0];


        /* =================================================
           COIN TRANSACTION
        ================================================= */

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

                -coins,

                currentBalance,

                newBalance,

                withdrawal.id,

                `FaucetPay withdrawal request: ${coins} coins`

            ]

        );


        /* =================================================
           COMMIT
        ================================================= */

        await client.query(
            "COMMIT"
        );


        /* =================================================
           RETURN
        ================================================= */

        return {

            ...formatWithdrawal(
                withdrawal,
                false
            ),

            newBalance

        };


    } catch (error) {

        try {

            await client.query(
                "ROLLBACK"
            );

        } catch (rollbackError) {

            console.error(
                "Withdrawal rollback error:",
                rollbackError
            );

        }

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

    if (
        !validateUserId(userId)
    ) {

        const error =
            new Error(
                "Authentication required."
            );

        error.code =
            "AUTHENTICATION_REQUIRED";

        error.statusCode =
            401;

        throw error;

    }


    let safeLimit =
        Number.parseInt(
            limit,
            10
        );

    if (
        !Number.isInteger(
            safeLimit
        )
    ) {

        safeLimit = 20;

    }

    safeLimit =
        Math.min(
            Math.max(
                safeLimit,
                1
            ),
            100
        );


    let safeOffset =
        Number.parseInt(
            offset,
            10
        );

    if (
        !Number.isInteger(
            safeOffset
        ) ||
        safeOffset < 0
    ) {

        safeOffset = 0;

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
                safeLimit,
                safeOffset
            ]

        );


    return result.rows.map(
        row =>
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

    withdrawalId,

    userId

) {

    if (
        !validateUserId(userId)
    ) {

        const error =
            new Error(
                "Authentication required."
            );

        error.code =
            "AUTHENTICATION_REQUIRED";

        error.statusCode =
            401;

        throw error;

    }


    const id =
        String(
            withdrawalId || ""
        ).trim();


    if (
        !validateUUID(id)
    ) {

        const error =
            new Error(
                "Invalid withdrawal ID."
            );

        error.code =
            "INVALID_WITHDRAWAL_ID";

        error.statusCode =
            400;

        throw error;

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
                id,
                userId
            ]

        );


    if (
        result.rowCount === 0
    ) {

        const error =
            new Error(
                "Withdrawal not found."
            );

        error.code =
            "WITHDRAWAL_NOT_FOUND";

        error.statusCode =
            404;

        throw error;

    }


    return formatWithdrawal(
        result.rows[0],
        false
    );

}


/* =========================================================
   CONFIG
========================================================= */

export const WITHDRAWAL_CONFIG = {

    COINS_PER_USD:
        COINS_PER_USD,

    MIN_COINS:
        MINIMUM_WITHDRAWAL,

    PROVIDER:
        PROVIDER,

    PROVIDERS: [
        PROVIDER
    ]

};


/* =========================================================
   DEFAULT EXPORT
========================================================= */

export default {

    createWithdrawal,

    getUserWithdrawals,

    getWithdrawal,

    WITHDRAWAL_CONFIG

};

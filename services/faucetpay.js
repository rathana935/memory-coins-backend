import crypto from "node:crypto";
import pool from "../db/pool.js";

/*
============================================================
MEMORY CARD — FAUCETPAY V2 PAYOUT SERVICE
============================================================

FaucetPay API:
POST https://faucetpay.io/api/v2/send

Authentication:
Authorization: Bearer <scoped API key>

Required v2 fields:
- idempotency_key
- to
- amount
- currency

IMPORTANT:
The amount sent to FaucetPay MUST be an integer in the
currency's smallest unit.

Example for USDT with 6 decimals:

$1.00 USDT
= 1,000,000 smallest units

Therefore:

$0.25
= 250,000

============================================================
ENVIRONMENT VARIABLES
============================================================

Required:

FAUCETPAY_API_KEY
FAUCETPAY_API_URL

Recommended:

FAUCETPAY_CURRENCY=USDT
FAUCETPAY_DECIMALS=6
FAUCETPAY_USD_PER_UNIT=1

Example:

FAUCETPAY_API_KEY=fpk_xxxxxxxxx
FAUCETPAY_API_URL=https://faucetpay.io/api/v2/send
FAUCETPAY_CURRENCY=USDT
FAUCETPAY_DECIMALS=6
FAUCETPAY_USD_PER_UNIT=1

For USDT:

1 USDT = approximately $1

The USD conversion is intentionally configurable.
Do NOT silently assume another cryptocurrency exchange rate.

============================================================
SECURITY
============================================================

- Never expose the API key to frontend JavaScript.
- Never put the API key in GitHub.
- Never trust client payout amounts.
- Never trust client currency.
- Never retry an uncertain payout with a NEW idempotency key.
- Never refund automatically when the external payout result
  is unknown.
- Only definitive FaucetPay rejection is refundable.
============================================================
*/


/* =========================================================
   CONFIGURATION
========================================================= */

const API_KEY =
    process.env.FAUCETPAY_API_KEY?.trim() || "";

const API_URL =
    (
        process.env.FAUCETPAY_API_URL ||
        "https://faucetpay.io/api/v2/send"
    ).trim();

const CURRENCY =
    (
        process.env.FAUCETPAY_CURRENCY ||
        "USDT"
    ).trim().toUpperCase();


/*
USDT normally uses 6 decimal places.

This is configurable so the service does not hard-code
decimal assumptions for another cryptocurrency.
*/

const DECIMALS =
    parseIntegerEnv(
        process.env.FAUCETPAY_DECIMALS,
        6
    );


/*
How many payout-currency units equal $1 USD.

For USDT:

1 USDT ≈ $1

Therefore:

FAUCETPAY_USD_PER_UNIT=1

If you later use another cryptocurrency, this value must
be updated from your chosen pricing source before enabling
automatic payouts.
*/

const USD_PER_UNIT =
    parsePositiveNumberEnv(
        process.env.FAUCETPAY_USD_PER_UNIT,
        1
    );


/*
Maximum number of withdrawal records a worker can process
in one batch.
*/

const DEFAULT_BATCH_LIMIT = 10;

const MAX_BATCH_LIMIT = 50;


/*
Request timeout.

A timeout is NOT considered a confirmed failure because
the request may have reached FaucetPay.
*/

const REQUEST_TIMEOUT_MS =
    30_000;


/* =========================================================
   ENVIRONMENT HELPERS
========================================================= */

function parseIntegerEnv(
    value,
    fallback
) {
    const number =
        Number.parseInt(
            value,
            10
        );

    if (
        !Number.isInteger(number) ||
        number < 0
    ) {
        return fallback;
    }

    return number;
}


function parsePositiveNumberEnv(
    value,
    fallback
) {
    const number =
        Number(value);

    if (
        !Number.isFinite(number) ||
        number <= 0
    ) {
        return fallback;
    }

    return number;
}


/* =========================================================
   CONFIGURATION STATUS
========================================================= */

export function isFaucetPayConfigured() {

    return Boolean(
        API_KEY &&
        API_URL &&
        CURRENCY &&
        Number.isInteger(DECIMALS) &&
        DECIMALS >= 0 &&
        Number.isFinite(USD_PER_UNIT) &&
        USD_PER_UNIT > 0
    );
}


/* =========================================================
   PUBLIC CONFIGURATION STATUS
========================================================= */

export function getFaucetPayStatus() {

    return {

        configured:
            isFaucetPayConfigured(),

        apiUrlConfigured:
            Boolean(API_URL),

        apiKeyConfigured:
            Boolean(API_KEY),

        currency:
            CURRENCY,

        decimals:
            DECIMALS,

        usdPerUnit:
            USD_PER_UNIT,

        timeoutMs:
            REQUEST_TIMEOUT_MS

    };
}


/* =========================================================
   VALIDATE CONFIGURATION
========================================================= */

function assertFaucetPayConfigured() {

    if (!API_KEY) {
        throw new Error(
            "FAUCETPAY_API_KEY_NOT_CONFIGURED"
        );
    }


    if (!API_URL) {
        throw new Error(
            "FAUCETPAY_API_URL_NOT_CONFIGURED"
        );
    }


    if (!CURRENCY) {
        throw new Error(
            "FAUCETPAY_CURRENCY_NOT_CONFIGURED"
        );
    }


    if (
        !Number.isInteger(DECIMALS) ||
        DECIMALS < 0
    ) {
        throw new Error(
            "FAUCETPAY_DECIMALS_INVALID"
        );
    }


    if (
        !Number.isFinite(USD_PER_UNIT) ||
        USD_PER_UNIT <= 0
    ) {
        throw new Error(
            "FAUCETPAY_USD_PER_UNIT_INVALID"
        );
    }

}


/* =========================================================
   IDEMPOTENCY KEY
========================================================= */

function createIdempotencyKey(
    withdrawalId
) {

    return crypto
        .createHash("sha256")
        .update(
            `memory-card-faucetpay-v2:${withdrawalId}`
        )
        .digest("hex");

}


/* =========================================================
   CONVERT USD → FAUCETPAY SMALLEST UNIT
=========================================================

Example:

USD amount:
1.25

USD_PER_UNIT:
1

DECIMALS:
6

Result:
1,250,000

The result is always an integer.
========================================================= */

function usdToSmallestUnits(
    amountUsd
) {

    const usd =
        Number(amountUsd);


    if (
        !Number.isFinite(usd) ||
        usd <= 0
    ) {

        throw new Error(
            "INVALID_WITHDRAWAL_USD_AMOUNT"
        );

    }


    const cryptoUnits =
        usd / USD_PER_UNIT;


    const multiplier =
        10 ** DECIMALS;


    const smallestUnits =
        Math.round(
            cryptoUnits *
            multiplier
        );


    if (
        !Number.isSafeInteger(
            smallestUnits
        ) ||
        smallestUnits <= 0
    ) {

        throw new Error(
            "INVALID_FAUCETPAY_AMOUNT"
        );

    }


    return smallestUnits;

}


/* =========================================================
   SEND FAUCETPAY V2 PAYOUT
========================================================= */

async function sendFaucetPayPayout(
    withdrawal
) {

    assertFaucetPayConfigured();


    /*
    --------------------------------------------------------
    Validate withdrawal provider
    --------------------------------------------------------
    */

    if (
        withdrawal.provider !==
        "faucetpay"
    ) {

        throw new Error(
            "INVALID_WITHDRAWAL_PROVIDER"
        );

    }


    /*
    --------------------------------------------------------
    Validate recipient
    --------------------------------------------------------
    */

    const recipient =
        String(
            withdrawal.faucetpay_email ||
            ""
        ).trim();


    if (!recipient) {

        throw new Error(
            "FAUCETPAY_EMAIL_MISSING"
        );

    }


    /*
    --------------------------------------------------------
    Calculate crypto amount
    --------------------------------------------------------
    */

    const amount =
        usdToSmallestUnits(
            withdrawal.amount_usd
        );


    /*
    --------------------------------------------------------
    Generate deterministic idempotency key
    --------------------------------------------------------
    */

    const idempotencyKey =
        createIdempotencyKey(
            withdrawal.id
        );


    /*
    --------------------------------------------------------
    AbortController timeout
    --------------------------------------------------------
    */

    const controller =
        new AbortController();


    const timeout =
        setTimeout(
            () => controller.abort(),
            REQUEST_TIMEOUT_MS
        );


    let response;

    try {

        response =
            await fetch(
                API_URL,
                {

                    method:
                        "POST",

                    headers: {

                        "Authorization":
                            `Bearer ${API_KEY}`,

                        "Content-Type":
                            "application/json",

                        "Accept":
                            "application/json"

                    },

                    body:
                        JSON.stringify({

                            idempotency_key:
                                idempotencyKey,

                            to:
                                recipient,

                            amount:
                                amount,

                            currency:
                                CURRENCY

                        }),

                    signal:
                        controller.signal

                }
            );

    } catch (error) {

        /*
        ----------------------------------------------------
        IMPORTANT
        ----------------------------------------------------

        Network failure / timeout does NOT mean that
        FaucetPay did not receive the request.

        The payout remains PROCESSING.

        We deliberately do NOT refund here.
        ----------------------------------------------------
        */

        const unknownError =
            new Error(
                error?.name === "AbortError"
                    ? "FAUCETPAY_REQUEST_TIMEOUT_UNKNOWN"
                    : "FAUCETPAY_NETWORK_ERROR_UNKNOWN"
            );


        unknownError.uncertain =
            true;


        unknownError.originalError =
            error;


        throw unknownError;

    } finally {

        clearTimeout(
            timeout
        );

    }


    /*
    --------------------------------------------------------
    Read response
    --------------------------------------------------------
    */

    const text =
        await response.text();


    let data;

    try {

        data =
            text
                ? JSON.parse(text)
                : {};

    } catch {

        data = {
            raw: text
        };

    }


    /*
    --------------------------------------------------------
    HTTP ERROR
    --------------------------------------------------------

    5xx:
      Unknown outcome.
      DO NOT refund automatically.

    4xx:
      Normally a definitive rejection.
      Safe to mark failed/refund.

    --------------------------------------------------------
    */

    if (
        response.status >= 500
    ) {

        const error =
            new Error(
                "FAUCETPAY_SERVER_ERROR_UNKNOWN"
            );

        error.status =
            response.status;

        error.response =
            data;

        error.uncertain =
            true;

        throw error;
    }


    if (
        response.status >= 400
    ) {

        const error =
            new Error(
                "FAUCETPAY_REQUEST_REJECTED"
            );

        error.status =
            response.status;

        error.response =
            data;

        error.uncertain =
            false;

        throw error;
    }


    /*
    --------------------------------------------------------
    FaucetPay v2 standard response:
    
    {
      "success": true,
      "message": "OK",
      "data": {
        "payout_id": ...
      }
    }
    --------------------------------------------------------
    */

    if (
        data?.success !== true
    ) {

        const error =
            new Error(
                "FAUCETPAY_PAYOUT_REJECTED"
            );

        error.status =
            response.status;

        error.response =
            data;

        /*
        A normal JSON rejection from the API is treated
        as definitive because FaucetPay returned a normal
        application-level response.
        */

        error.uncertain =
            false;

        throw error;
    }


    /*
    --------------------------------------------------------
    Extract payout ID
    --------------------------------------------------------
    */

    const payoutId =
        data?.data?.payout_id;


    if (
        payoutId === undefined ||
        payoutId === null ||
        String(payoutId).trim() === ""
    ) {

        /*
        A successful response without payout_id is
        suspicious. Do NOT refund because the payout may
        already have happened.
        */

        const error =
            new Error(
                "FAUCETPAY_PAYOUT_ID_MISSING_UNKNOWN"
            );

        error.status =
            response.status;

        error.response =
            data;

        error.uncertain =
            true;

        throw error;
    }


    /*
    --------------------------------------------------------
    SUCCESS
    --------------------------------------------------------
    */

    return {

        success:
            true,

        payoutId:
            String(payoutId),

        currency:
            data?.data?.currency ||
            CURRENCY,

        amount:
            amount,

        message:
            data?.message ||
            "Payout completed successfully.",

        raw:
            data

    };

}


/* =========================================================
   GET WITHDRAWAL FOR PROCESSING
========================================================= */

async function getWithdrawalForProcessing(
    client,
    withdrawalId
) {

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
            [
                withdrawalId
            ]
        );


    if (
        result.rowCount === 0
    ) {

        throw new Error(
            "WITHDRAWAL_NOT_FOUND"
        );

    }


    return result.rows[0];

}


/* =========================================================
   CLAIM WITHDRAWAL
=========================================================

Changes:

pending → processing

This prevents the same withdrawal from being picked
by multiple workers at the same time.
========================================================= */

async function claimWithdrawal(
    withdrawalId
) {

    const client =
        await pool.connect();


    try {

        await client.query(
            "BEGIN"
        );


        const withdrawal =
            await getWithdrawalForProcessing(
                client,
                withdrawalId
            );


        /*
        Only FaucetPay withdrawals belong to this service.
        */

        if (
            withdrawal.provider !==
            "faucetpay"
        ) {

            await client.query(
                "ROLLBACK"
            );


            throw new Error(
                "NOT_FAUCETPAY_WITHDRAWAL"
            );

        }


        /*
        Already paid = nothing to do.
        */

        if (
            withdrawal.status ===
            "paid"
        ) {

            await client.query(
                "COMMIT"
            );


            return {

                claimed:
                    false,

                alreadyPaid:
                    true,

                withdrawal

            };

        }


        /*
        A processing withdrawal must NOT be
        automatically claimed again.

        It may represent an uncertain external payout.
        */

        if (
            withdrawal.status ===
            "processing"
        ) {

            await client.query(
                "COMMIT"
            );


            return {

                claimed:
                    false,

                uncertain:
                    true,

                withdrawal

            };

        }


        /*
        Only pending can enter the external
        payout process.
        */

        if (
            withdrawal.status !==
            "pending"
        ) {

            await client.query(
                "COMMIT"
            );


            return {

                claimed:
                    false,

                withdrawal

            };

        }


        /*
        Mark processing BEFORE contacting FaucetPay.
        */

        const updated =
            await client.query(
                `
                UPDATE withdrawals
                SET
                    status = 'processing',
                    updated_at = NOW()
                WHERE id = $1
                  AND status = 'pending'
                RETURNING
                    id,
                    user_id,
                    provider,
                    amount_coins,
                    amount_usd,
                    faucetpay_email,
                    status,
                    provider_transaction_id
                `,
                [
                    withdrawalId
                ]
            );


        if (
            updated.rowCount === 0
        ) {

            await client.query(
                "COMMIT"
            );


            return {

                claimed:
                    false

            };

        }


        await client.query(
            "COMMIT"
        );


        return {

            claimed:
                true,

            withdrawal:
                updated.rows[0]

        };

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
   MARK WITHDRAWAL PAID
========================================================= */

async function markWithdrawalPaid(
    withdrawalId,
    payoutId
) {

    const result =
        await pool.query(
            `
            UPDATE withdrawals
            SET
                status = 'paid',
                provider_transaction_id = $1,
                processed_at = NOW(),
                failure_reason = NULL,
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
                String(payoutId),
                withdrawalId
            ]
        );


    if (
        result.rowCount === 0
    ) {

        throw new Error(
            "WITHDRAWAL_STATE_UPDATE_FAILED"
        );

    }


    return result.rows[0];

}


/* =========================================================
   MARK DEFINITIVE FAILURE + REFUND
=========================================================

ONLY use this for a definitive provider rejection.

NEVER call this for:

- timeout
- network failure
- 5xx
- missing payout ID
- unknown provider state

Those remain PROCESSING and need reconciliation.
========================================================= */

async function markWithdrawalFailedAndRefund(
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
                [
                    withdrawalId
                ]
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
        If it is no longer processing,
        don't refund again.
        */

        if (
            withdrawal.status !==
            "processing"
        ) {

            await client.query(
                "COMMIT"
            );


            return {

                refunded:
                    false,

                status:
                    withdrawal.status

            };

        }


        /*
        Lock user.
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
                [
                    withdrawal.user_id
                ]
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
            balanceBefore +
            refund;


        /*
        Refund coins.
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

                `FaucetPay withdrawal refund: ${String(
                    reason
                ).slice(0, 400)}`
            ]
        );


        /*
        Mark failed.
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


        return {

            refunded:
                true,

            status:
                "failed",

            amountCoins:
                refund

        };

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
   PROCESS ONE WITHDRAWAL
========================================================= */

export async function processWithdrawal(
    withdrawalId
) {

    /*
    --------------------------------------------------------
    Claim the withdrawal first.
    --------------------------------------------------------
    */

    const claim =
        await claimWithdrawal(
            withdrawalId
        );


    /*
    Nothing to process.
    */

    if (
        !claim.claimed
    ) {

        return {

            success:
                false,

            skipped:
                true,

            alreadyPaid:
                claim.alreadyPaid ||
                false,

            uncertain:
                claim.uncertain ||
                false,

            withdrawal:
                claim.withdrawal ||
                null

        };

    }


    const withdrawal =
        claim.withdrawal;


    /*
    --------------------------------------------------------
    Send payout to FaucetPay.
    --------------------------------------------------------
    */

    let payout;


    try {

        payout =
            await sendFaucetPayPayout(
                withdrawal
            );

    } catch (error) {

        /*
        ----------------------------------------------------
        UNKNOWN OUTCOME
        ----------------------------------------------------

        DO NOT REFUND.

        The request may have reached FaucetPay.

        Leave status = processing.

        A reconciliation process/webhook can resolve it.
        ----------------------------------------------------
        */

        if (
            error.uncertain === true
        ) {

            console.error(
                "FaucetPay payout outcome uncertain:",
                {
                    withdrawalId,
                    error:
                        error.message
                }
            );


            return {

                success:
                    false,

                uncertain:
                    true,

                status:
                    "processing",

                error:
                    error.message,

                withdrawalId

            };

        }


        /*
        ----------------------------------------------------
        DEFINITIVE REJECTION
        ----------------------------------------------------

        Safe to refund because FaucetPay explicitly
        rejected the request.
        ----------------------------------------------------
        */

        try {

            await markWithdrawalFailedAndRefund(
                withdrawalId,
                getProviderErrorMessage(
                    error
                )
            );

        } catch (refundError) {

            console.error(
                "Failed to refund rejected withdrawal:",
                {
                    withdrawalId,
                    error:
                        refundError.message
                }
            );


            /*
            Do NOT hide the original payout rejection.
            The withdrawal remains processing if refund
            could not be completed.
            */

            return {

                success:
                    false,

                uncertain:
                    true,

                status:
                    "processing",

                error:
                    "PAYOUT_REJECTED_REFUND_FAILED",

                withdrawalId

            };

        }


        return {

            success:
                false,

            refunded:
                true,

            status:
                "failed",

            error:
                error.message,

            withdrawalId

        };

    }


    /*
    --------------------------------------------------------
    FaucetPay confirmed success.
    --------------------------------------------------------
    */

    const finalWithdrawal =
        await markWithdrawalPaid(
            withdrawalId,
            payout.payoutId
        );


    return {

        success:
            true,

        withdrawal:
            finalWithdrawal,

        payout: {

            payoutId:
                payout.payoutId,

            currency:
                payout.currency,

            amount:
                payout.amount

        }

    };

}


/* =========================================================
   PROVIDER ERROR MESSAGE
========================================================= */

function getProviderErrorMessage(
    error
) {

    const response =
        error?.response;


    const message =
        response?.message ||
        response?.error ||
        error?.message ||
        "FaucetPay payout rejected.";


    return String(
        message
    ).slice(
        0,
        500
    );

}


/* =========================================================
   PROCESS NEXT FAUCETPAY WITHDRAWAL
========================================================= */

export async function processNextWithdrawal() {

    /*
    Only FaucetPay withdrawals.

    ABA must be handled separately.
    */

    const result =
        await pool.query(
            `
            SELECT
                id
            FROM withdrawals
            WHERE provider = 'faucetpay'
              AND status = 'pending'
            ORDER BY
                requested_at ASC
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
   PROCESS MULTIPLE FAUCETPAY WITHDRAWALS
========================================================= */

export async function processPendingWithdrawals(
    limit = DEFAULT_BATCH_LIMIT
) {

    const requestedLimit =
        Number(limit);


    const safeLimit =
        Math.min(
            Math.max(
                Number.isInteger(
                    requestedLimit
                )
                    ? requestedLimit
                    : DEFAULT_BATCH_LIMIT,
                1
            ),
            MAX_BATCH_LIMIT
        );


    /*
    --------------------------------------------------------
    We intentionally select only IDs.

    Each individual withdrawal is then claimed with
    SELECT ... FOR UPDATE and status transition.

    Therefore a competing worker cannot successfully
    claim the same pending withdrawal twice.
    --------------------------------------------------------
    */

    const result =
        await pool.query(
            `
            SELECT
                id
            FROM withdrawals
            WHERE provider = 'faucetpay'
              AND status = 'pending'
            ORDER BY
                requested_at ASC
            LIMIT $1
            `,
            [
                safeLimit
            ]
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

                id:
                    row.id,

                success:
                    processed.success,

                skipped:
                    processed.skipped ||
                    false,

                uncertain:
                    processed.uncertain ||
                    false,

                result:
                    processed

            });

        } catch (error) {

            console.error(
                "FaucetPay withdrawal processing error:",
                {
                    withdrawalId:
                        row.id,

                    error:
                        error.message
                }
            );


            results.push({

                id:
                    row.id,

                success:
                    false,

                error:
                    error.message

            });

        }

    }


    return results;

}


/* =========================================================
   CONVERSION INFORMATION
========================================================= */

export function getFaucetPayConversionInfo() {

    return {

        currency:
            CURRENCY,

        decimals:
            DECIMALS,

        usdPerUnit:
            USD_PER_UNIT,

        example:

            usdToSmallestUnits(
                1
            )

    };

}

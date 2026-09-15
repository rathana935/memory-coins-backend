import dotenv from "dotenv";

dotenv.config();

import {
    processPendingWithdrawals,
    getFaucetPayStatus
} from "../services/faucetpay.js";


/*
============================================================
MEMORY CARD — FAUCETPAY WITHDRAWAL WORKER
============================================================

This worker processes ONLY:

    provider = 'faucetpay'
    status   = 'pending'

ABA withdrawals are NOT processed by this worker.

Run separately from the Express API:

    node workers/withdrawal-worker.js

Recommended environment:

    WITHDRAWAL_WORKER_INTERVAL_MS=30000

30 seconds = 30000 ms

Optional:

    WITHDRAWAL_WORKER_BATCH_SIZE=10

Maximum supported batch size:
    50

============================================================
IMPORTANT
============================================================

This worker NEVER directly handles user balances.

The payout service handles:

    pending
       ↓
    processing
       ↓
    paid

OR:

    processing
       ↓
    failed + refund

For uncertain external payout results:

    processing

The worker MUST NOT automatically refund an uncertain payout.

============================================================
*/


/* =========================================================
   CONFIGURATION
========================================================= */

const INTERVAL_MS =
    parsePositiveInteger(
        process.env.WITHDRAWAL_WORKER_INTERVAL_MS,
        30000
    );


const BATCH_SIZE =
    Math.min(
        Math.max(
            parsePositiveInteger(
                process.env.WITHDRAWAL_WORKER_BATCH_SIZE,
                10
            ),
            1
        ),
        50
    );


/*
Prevent overlapping executions inside this worker process.
*/

let isRunning = false;


/*
Used during graceful shutdown.
*/

let shuttingDown = false;


/* =========================================================
   ENVIRONMENT HELPERS
========================================================= */

function parsePositiveInteger(
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
        number <= 0
    ) {

        return fallback;

    }


    return number;

}


/* =========================================================
   FORMAT WORKER RESULT
========================================================= */

function logResult(
    result
) {

    const id =
        result?.id ||
        result?.result?.withdrawal?.id ||
        "unknown";


    /*
    ---------------------------------------------------------
    SUCCESS
    ---------------------------------------------------------
    */

    if (
        result?.success === true
    ) {

        const payoutId =
            result
                ?.result
                ?.payout
                ?.payoutId ||
            result
                ?.result
                ?.withdrawal
                ?.provider_transaction_id ||
            "unknown";


        console.log(
            `[Withdrawal Worker] PAID ` +
            `withdrawal=${id} ` +
            `payout=${payoutId}`
        );


        return;

    }


    /*
    ---------------------------------------------------------
    UNCERTAIN
    ---------------------------------------------------------
    */

    if (
        result?.uncertain === true ||
        result?.result?.uncertain === true
    ) {

        console.error(
            `[Withdrawal Worker] ` +
            `UNCERTAIN ` +
            `withdrawal=${id} ` +
            `status=processing ` +
            `error=${result?.error || "UNKNOWN"}`
        );


        return;

    }


    /*
    ---------------------------------------------------------
    SKIPPED
    ---------------------------------------------------------
    */

    if (
        result?.skipped === true ||
        result?.result?.skipped === true
    ) {

        console.log(
            `[Withdrawal Worker] ` +
            `SKIPPED ` +
            `withdrawal=${id}`
        );


        return;

    }


    /*
    ---------------------------------------------------------
    FAILURE
    ---------------------------------------------------------
    */

    console.error(
        `[Withdrawal Worker] ` +
        `FAILED ` +
        `withdrawal=${id} ` +
        `error=${result?.error || "UNKNOWN"}`
    );

}


/* =========================================================
   PROCESS ONE WORKER BATCH
========================================================= */

async function runWorker() {

    /*
    ---------------------------------------------------------
    Prevent overlap
    ---------------------------------------------------------
    */

    if (
        isRunning
    ) {

        console.log(
            "[Withdrawal Worker] " +
            "Previous job is still running. Skipping."
        );


        return;

    }


    /*
    ---------------------------------------------------------
    Do not start new work during shutdown
    ---------------------------------------------------------
    */

    if (
        shuttingDown
    ) {

        return;

    }


    isRunning =
        true;


    const startedAt =
        Date.now();


    try {

        console.log(
            "[Withdrawal Worker] " +
            "Checking pending FaucetPay withdrawals..."
        );


        /*
        -----------------------------------------------------
        Check FaucetPay configuration
        -----------------------------------------------------
        */

        const faucetPayStatus =
            getFaucetPayStatus();


        if (
            !faucetPayStatus.configured
        ) {

            console.error(
                "[Withdrawal Worker] " +
                "FaucetPay is not configured."
            );


            console.error(
                {
                    apiUrlConfigured:
                        faucetPayStatus
                            .apiUrlConfigured,

                    apiKeyConfigured:
                        faucetPayStatus
                            .apiKeyConfigured,

                    currency:
                        faucetPayStatus
                            .currency,

                    decimals:
                        faucetPayStatus
                            .decimals
                }
            );


            return;

        }


        /*
        -----------------------------------------------------
        Process FaucetPay withdrawals
        -----------------------------------------------------
        */

        const results =
            await processPendingWithdrawals(
                BATCH_SIZE
            );


        /*
        -----------------------------------------------------
        No work
        -----------------------------------------------------
        */

        if (
            !results.length
        ) {

            console.log(
                "[Withdrawal Worker] " +
                "No pending FaucetPay withdrawals."
            );


            return;

        }


        /*
        -----------------------------------------------------
        Print individual results
        -----------------------------------------------------
        */

        let paid =
            0;

        let failed =
            0;

        let uncertain =
            0;

        let skipped =
            0;


        for (
            const result of results
        ) {

            logResult(
                result
            );


            if (
                result.success === true
            ) {

                paid++;

            } else if (
                result.uncertain === true ||
                result.result?.uncertain === true
            ) {

                uncertain++;

            } else if (
                result.skipped === true ||
                result.result?.skipped === true
            ) {

                skipped++;

            } else {

                failed++;

            }

        }


        /*
        -----------------------------------------------------
        Summary
        -----------------------------------------------------
        */

        const duration =
            Date.now() -
            startedAt;


        console.log(
            "[Withdrawal Worker] " +
            `Batch complete. ` +
            `paid=${paid} ` +
            `failed=${failed} ` +
            `uncertain=${uncertain} ` +
            `skipped=${skipped} ` +
            `duration=${duration}ms`
        );


    } catch (error) {

        console.error(
            "[Withdrawal Worker] " +
            "Worker execution error:",
            error
        );


    } finally {

        isRunning =
            false;

    }

}


/* =========================================================
   STARTUP
========================================================= */

console.log(
    "=============================================="
);

console.log(
    "Memory Card — FaucetPay Withdrawal Worker"
);

console.log(
    "=============================================="
);

console.log(
    `Interval: ${INTERVAL_MS} ms`
);

console.log(
    `Batch size: ${BATCH_SIZE}`
);

console.log(
    "Provider: FaucetPay"
);

console.log(
    "Currency:",
    process.env.FAUCETPAY_CURRENCY ||
    "USDT"
);

console.log(
    "=============================================="
);


/*
------------------------------------------------------------
Check configuration at startup.
------------------------------------------------------------
*/

const startupStatus =
    getFaucetPayStatus();


console.log(
    "FaucetPay configured:",
    startupStatus.configured
);


if (
    !startupStatus.configured
) {

    console.warn(
        "[Withdrawal Worker] " +
        "WARNING: FaucetPay is not fully configured."
    );

}


/*
------------------------------------------------------------
Run immediately.
------------------------------------------------------------
*/

await runWorker();


/*
------------------------------------------------------------
Continue periodically.
------------------------------------------------------------
*/

const timer =
    setInterval(
        runWorker,
        INTERVAL_MS
    );


/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

async function shutdown(
    signal
) {

    /*
    ---------------------------------------------------------
    Prevent another job from starting.
    ---------------------------------------------------------
    */

    shuttingDown =
        true;


    console.log(
        `[Withdrawal Worker] ` +
        `${signal} received. ` +
        `Stopping worker...`
    );


    /*
    ---------------------------------------------------------
    Stop future intervals.
    ---------------------------------------------------------
    */

    clearInterval(
        timer
    );


    /*
    ---------------------------------------------------------
    Give current job time to finish.
    ---------------------------------------------------------
    */

    const start =
        Date.now();


    const shutdownTimeout =
        15000;


    while (
        isRunning &&
        Date.now() - start <
            shutdownTimeout
    ) {

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    250
                )
        );

    }


    /*
    ---------------------------------------------------------
    If the job did not finish, do NOT attempt to kill or
    refund the payout here.

    The database state protects the withdrawal.
    ---------------------------------------------------------
    */

    if (
        isRunning
    ) {

        console.warn(
            "[Withdrawal Worker] " +
            "Current operation is still running. " +
            "Exiting safely without changing payout state."
        );

    }


    console.log(
        "[Withdrawal Worker] " +
        "Worker stopped."
    );


    process.exit(
        0
    );

}


/* =========================================================
   SIGNAL HANDLERS
========================================================= */

process.on(
    "SIGTERM",
    () =>
        shutdown(
            "SIGTERM"
        )
);


process.on(
    "SIGINT",
    () =>
        shutdown(
            "SIGINT"
        )
);


/* =========================================================
   UNHANDLED ERRORS
========================================================= */

process.on(
    "unhandledRejection",
    error => {

        console.error(
            "[Withdrawal Worker] " +
            "Unhandled promise rejection:",
            error
        );

    }
);


process.on(
    "uncaughtException",
    error => {

        console.error(
            "[Withdrawal Worker] " +
            "Uncaught exception:",
            error
        );

    }
);

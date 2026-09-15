import dotenv from "dotenv";

dotenv.config();

import {
  processPendingWithdrawals
} from "../services/faucetpay.js";

/*
=========================================================
MEMORY COINS — WITHDRAWAL WORKER
=========================================================

This worker checks for pending withdrawals and sends them
to the FaucetPay payout service.

IMPORTANT:

Run this worker separately from the Express API.

Example:

node workers/withdrawal-worker.js

Environment:

WITHDRAWAL_WORKER_INTERVAL_MS=30000

30,000 ms = 30 seconds
=========================================================
*/

const INTERVAL_MS =
  Number(
    process.env.WITHDRAWAL_WORKER_INTERVAL_MS ||
    30000
  );

/*
Prevent overlapping worker executions.
*/

let isRunning = false;

/* =========================================================
   PROCESS WITHDRAWALS
========================================================= */

async function runWorker() {
  if (isRunning) {
    console.log(
      "[Withdrawal Worker] Previous job still running."
    );

    return;
  }

  isRunning = true;

  try {
    console.log(
      `[Withdrawal Worker] Checking pending withdrawals...`
    );

    const results =
      await processPendingWithdrawals(10);

    if (!results.length) {
      console.log(
        "[Withdrawal Worker] No pending withdrawals."
      );

      return;
    }

    for (const result of results) {
      if (result.success) {
        console.log(
          `[Withdrawal Worker] Paid: ${result.id}`
        );
      } else {
        console.error(
          `[Withdrawal Worker] Failed: ${result.id}`,
          result.error
        );
      }
    }

  } catch (error) {
    console.error(
      "[Withdrawal Worker] Error:",
      error
    );

  } finally {
    isRunning = false;
  }
}

/* =========================================================
   START
========================================================= */

console.log(
  "========================================"
);

console.log(
  "Memory Coins Withdrawal Worker"
);

console.log(
  "========================================"
);

console.log(
  `Interval: ${INTERVAL_MS} ms`
);

console.log(
  "Worker started."
);

console.log(
  "========================================"
);

/*
Run immediately.
*/

await runWorker();

/*
Then continue periodically.
*/

const timer =
  setInterval(
    runWorker,
    INTERVAL_MS
  );

/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

async function shutdown(signal) {
  console.log(
    `${signal} received. Stopping withdrawal worker...`
  );

  clearInterval(timer);

  /*
  Give the current worker operation a short
  opportunity to finish.
  */

  const start =
    Date.now();

  while (
    isRunning &&
    Date.now() - start < 10000
  ) {
    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          250
        )
    );
  }

  console.log(
    "Withdrawal worker stopped."
  );

  process.exit(0);
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

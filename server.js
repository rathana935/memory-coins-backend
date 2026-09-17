import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import pool from "./db/pool.js";

import authRouter from "./routes/auth.js";
import gameRouter from "./routes/game.js";
import rewardsRouter from "./routes/rewards.js";
import leaderboardRouter from "./routes/leaderboard.js";
import referralsRouter from "./routes/referrals.js";
import withdrawalsRouter from "./routes/withdrawals.js";

import { requireAuth } from "./middleware/auth.js";

import {
    confirmAdsgramReward
} from "./services/rewards.js";


/* =========================================================
   APP
========================================================= */

const app = express();

const PORT =
    Number(process.env.PORT || 10000);

const NODE_ENV =
    process.env.NODE_ENV || "production";


/* =========================================================
   ADSGRAM
========================================================= */

const ADSGRAM_BLOCK_ID =
    String(
        process.env.ADSGRAM_BLOCK_ID || "48148"
    ).trim();


/* =========================================================
   FRONTEND
========================================================= */

const FRONTEND_URL =
    String(
        process.env.FRONTEND_URL || ""
    ).trim();


/* =========================================================
   TRUST PROXY
========================================================= */

app.set(
    "trust proxy",
    1
);


/* =========================================================
   SECURITY
========================================================= */

app.use(
    helmet({
        crossOriginResourcePolicy: false
    })
);


/* =========================================================
   CORS
========================================================= */

app.use(
    cors({

        origin: (
            origin,
            callback
        ) => {

            /*
             * Allow requests without Origin.
             *
             * Useful for:
             * - Telegram WebView
             * - server-to-server requests
             * - health checks
             */

            if (!origin) {

                return callback(
                    null,
                    true
                );

            }


            /*
             * If FRONTEND_URL is configured,
             * only allow that exact origin.
             */

            if (
                FRONTEND_URL &&
                origin === FRONTEND_URL
            ) {

                return callback(
                    null,
                    true
                );

            }


            /*
             * If no FRONTEND_URL is configured,
             * allow all origins.
             */

            if (!FRONTEND_URL) {

                return callback(
                    null,
                    true
                );

            }


            return callback(
                new Error(
                    "CORS origin not allowed."
                )
            );

        },

        credentials: false

    })
);


/* =========================================================
   BODY PARSING
========================================================= */

app.use(
    express.json({
        limit: "100kb"
    })
);

app.use(
    express.urlencoded({
        extended: false,
        limit: "100kb"
    })
);


/* =========================================================
   RATE LIMITERS
========================================================= */

const generalLimiter =
    rateLimit({

        windowMs:
            60 * 1000,

        max:
            120,

        standardHeaders:
            true,

        legacyHeaders:
            false,

        message: {

            success: false,

            code:
                "RATE_LIMITED",

            message:
                "Too many requests. Please try again later."

        }

    });


const authLimiter =
    rateLimit({

        windowMs:
            15 * 60 * 1000,

        max:
            30,

        standardHeaders:
            true,

        legacyHeaders:
            false,

        message: {

            success: false,

            code:
                "AUTH_RATE_LIMITED",

            message:
                "Too many authentication requests."

        }

    });


const adsgramLimiter =
    rateLimit({

        windowMs:
            60 * 1000,

        max:
            60,

        standardHeaders:
            true,

        legacyHeaders:
            false,

        message: {

            success: false,

            code:
                "AD_RATE_LIMITED",

            message:
                "Too many ad reward requests."

        }

    });


/* =========================================================
   GENERAL RATE LIMIT
========================================================= */

app.use(
    generalLimiter
);


/* =========================================================
   ROOT
========================================================= */

app.get(
    "/",
    (req, res) => {

        return res.json({

            success: true,

            name:
                "Memory Card Backend",

            environment:
                NODE_ENV,

            status:
                "running",

            adsgramBlockId:
                ADSGRAM_BLOCK_ID,

            authentication:
                "Telegram WebApp + Bearer session",

            endpoints: {

                health:
                    "/health",

                auth:
                    "/api/auth",

                game:
                    "/api/game",

                rewards:
                    "/api/rewards",

                leaderboard:
                    "/api/leaderboard",

                referrals:
                    "/api/referrals",

                withdrawals:
                    "/api/withdrawals",

                adsgramReward:
                    "/api/adsgram/reward"

            }

        });

    }
);


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
    "/health",

    async (req, res) => {

        try {

            await pool.query(
                "SELECT 1"
            );


            return res.json({

                success: true,

                status:
                    "ok",

                database:
                    "connected",

                environment:
                    NODE_ENV,

                adsgram: {

                    blockId:
                        ADSGRAM_BLOCK_ID

                },

                timestamp:
                    new Date().toISOString()

            });

        } catch (error) {

            console.error(
                "Health check database error:",
                error
            );


            return res.status(503).json({

                success: false,

                status:
                    "error",

                database:
                    "disconnected",

                environment:
                    NODE_ENV,

                timestamp:
                    new Date().toISOString()

            });

        }

    }
);


/* =========================================================
   ADSGRAM REWARD CALLBACK
=========================================================

PUBLIC ENDPOINT

AdsGram does not send the user's Bearer token.

The callback only identifies the Telegram user.

The rewards service must verify that the user has
a valid pending ad reward before giving anything.

Example:

GET /api/adsgram/reward?userid=123456789

========================================================= */

app.get(
    "/api/adsgram/reward",

    adsgramLimiter,

    async (req, res) => {

        try {

            const telegramId =
                String(
                    req.query.userid ||
                    req.query.user_id ||
                    ""
                ).trim();


            /* -----------------------------------------
               USER ID REQUIRED
            ----------------------------------------- */

            if (!telegramId) {

                return res.status(400).json({

                    success: false,

                    code:
                        "MISSING_USER_ID",

                    message:
                        "Missing userid."

                });

            }


            /* -----------------------------------------
               BASIC TELEGRAM ID VALIDATION
            ----------------------------------------- */

            if (
                !/^\d{1,20}$/.test(
                    telegramId
                )
            ) {

                return res.status(400).json({

                    success: false,

                    code:
                        "INVALID_USER_ID",

                    message:
                        "Invalid userid."

                });

            }


            /* -----------------------------------------
               CONFIRM PENDING REWARD
            ----------------------------------------- */

            const result =
                await confirmAdsgramReward({

                    telegramId

                });


            return res.json(
                result
            );


        } catch (error) {

            console.error(
                "AdsGram Reward URL error:",
                error
            );


            /* -----------------------------------------
               KNOWN REWARD ERRORS
            ----------------------------------------- */

            if (
                error?.code ===
                "USER_NOT_FOUND"
            ) {

                return res.status(404).json({

                    success: false,

                    code:
                        "USER_NOT_FOUND",

                    message:
                        "Telegram user not found."

                });

            }


            if (
                error?.code ===
                "NO_PENDING_AD"
            ) {

                return res.status(409).json({

                    success: false,

                    code:
                        "NO_PENDING_AD",

                    message:
                        "No pending ad reward."

                });

            }


            if (
                error?.code ===
                "AD_ALREADY_PROCESSED"
            ) {

                return res.status(409).json({

                    success: false,

                    code:
                        "AD_ALREADY_PROCESSED",

                    message:
                        "Ad reward was already processed."

                });

            }


            if (
                error?.code ===
                "INVALID_AD_TYPE"
            ) {

                return res.status(500).json({

                    success: false,

                    code:
                        "INVALID_AD_TYPE",

                    message:
                        "Invalid stored ad type."

                });

            }


            if (
                error?.code ===
                "INVALID_GAME_SESSION"
            ) {

                return res.status(500).json({

                    success: false,

                    code:
                        "INVALID_GAME_SESSION",

                    message:
                        "Invalid stored game session."

                });

            }


            if (
                error?.code ===
                "GAME_SESSION_NOT_FOUND"
            ) {

                return res.status(404).json({

                    success: false,

                    code:
                        "GAME_SESSION_NOT_FOUND",

                    message:
                        "Game session not found."

                });

            }


            if (
                error?.code ===
                "GAME_NOT_COMPLETED"
            ) {

                return res.status(409).json({

                    success: false,

                    code:
                        "GAME_NOT_COMPLETED",

                    message:
                        "Game is not completed."

                });

            }


            return res.status(500).json({

                success: false,

                code:
                    "AD_REWARD_ERROR",

                message:
                    "Unable to process ad reward."

            });

        }

    }
);


/* =========================================================
   AUTHENTICATION
========================================================= */

app.use(
    "/api/auth",

    authLimiter,

    authRouter
);


/* =========================================================
   GAME
========================================================= */

app.use(
    "/api/game",

    requireAuth,

    gameRouter
);


/* =========================================================
   REWARDS
=========================================================

IMPORTANT:

If rewards.js already contains:

    router.use(requireAuth)

do not add requireAuth here.

========================================================= */

app.use(
    "/api/rewards",

    rewardsRouter
);


/* =========================================================
   LEADERBOARD
========================================================= */

app.use(
    "/api/leaderboard",

    requireAuth,

    leaderboardRouter
);


/* =========================================================
   REFERRALS
========================================================= */

app.use(
    "/api/referrals",

    requireAuth,

    referralsRouter
);


/* =========================================================
   WITHDRAWALS
========================================================= */

app.use(
    "/api/withdrawals",

    requireAuth,

    withdrawalsRouter
);


/* =========================================================
   404
========================================================= */

app.use(
    (req, res) => {

        return res.status(404).json({

            success: false,

            code:
                "NOT_FOUND",

            message:
                "Route not found."

        });

    }
);


/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "Unhandled server error:",
            error
        );


        if (
            res.headersSent
        ) {

            return next(error);

        }


        const status =
            Number(error?.status) || 500;


        return res.status(
            status
        ).json({

            success: false,

            code:
                error?.code ||
                "INTERNAL_SERVER_ERROR",

            message:
                NODE_ENV === "production"
                    ? (
                        error?.expose
                            ? error.message
                            : "Internal server error."
                    )
                    : (
                        error?.message ||
                        "Internal server error."
                    )

        });

    }
);


/* =========================================================
   START SERVER
========================================================= */

const server =
    app.listen(
        PORT,

        () => {

            console.log(
                "=========================================="
            );

            console.log(
                "Memory Card Backend"
            );

            console.log(
                `Environment: ${NODE_ENV}`
            );

            console.log(
                `Port: ${PORT}`
            );

            console.log(
                `AdsGram Block ID: ${ADSGRAM_BLOCK_ID}`
            );

            console.log(
                `Frontend URL: ${
                    FRONTEND_URL ||
                    "ALLOW ALL"
                }`
            );

            console.log(
                "Authentication: ENABLED"
            );

            console.log(
                "Game API: AUTH REQUIRED"
            );

            console.log(
                "Rewards API: AUTH REQUIRED"
            );

            console.log(
                "Leaderboard API: AUTH REQUIRED"
            );

            console.log(
                "Referral API: AUTH REQUIRED"
            );

            console.log(
                "Withdrawal API: AUTH REQUIRED"
            );

            console.log(
                "AdsGram callback: PUBLIC"
            );

            console.log(
                "Server started successfully."
            );

            console.log(
                "Health: /health"
            );

            console.log(
                "AdsGram Reward URL:"
            );

            console.log(
                "/api/adsgram/reward?userid=[userId]"
            );

            console.log(
                "=========================================="
            );

        }
    );


/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

async function shutdown(
    signal
) {

    console.log(
        `${signal} received. Shutting down...`
    );


    server.close(
        async () => {

            try {

                await pool.end();

                console.log(
                    "Database pool closed."
                );

            } catch (error) {

                console.error(
                    "Error closing database:",
                    error
                );

            } finally {

                process.exit(0);

            }

        }
    );


    setTimeout(
        () => {

            console.error(
                "Forced shutdown."
            );

            process.exit(1);

        },
        10000
    );

}


/* =========================================================
   PROCESS SIGNALS
========================================================= */

process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);

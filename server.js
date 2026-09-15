import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { pool } from "./db/pool.js";

import authRouter from "./routes/auth.js";
import gameRouter from "./routes/game.js";
import rewardsRouter from "./routes/rewards.js";
import leaderboardRouter from "./routes/leaderboard.js";
import referralsRouter from "./routes/referrals.js";
import withdrawalsRouter from "./routes/withdrawals.js";

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
        process.env.ADSGRAM_BLOCK_ID || "48045"
    );


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


app.use(
    cors({
        origin: true,
        credentials: false
    })
);


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
        windowMs: 60 * 1000,
        max: 120,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            message:
                "Too many requests. Please try again later."
        }
    });


const authLimiter =
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            message:
                "Too many authentication requests."
        }
    });


const adsgramLimiter =
    rateLimit({
        windowMs: 60 * 1000,
        max: 60,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            message:
                "Too many ad reward requests."
        }
    });


app.use(
    generalLimiter
);


/* =========================================================
   BASIC ROUTES
========================================================= */

app.get(
    "/",
    (req, res) => {

        res.json({

            success: true,

            name:
                "Memory Card Backend",

            environment:
                NODE_ENV,

            status:
                "running",

            adsgramBlockId:
                ADSGRAM_BLOCK_ID,

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
   HEALTH
========================================================= */

app.get(
    "/health",
    async (req, res) => {

        try {

            await pool.query(
                "SELECT 1"
            );

            res.json({

                success: true,

                status:
                    "ok",

                database:
                    "connected",

                environment:
                    NODE_ENV,

                adsgram:
                    {
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

            res.status(503).json({

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
   ADSGRAM REWARD URL
=========================================================

   AdsGram calls:

   GET

   /api/adsgram/reward?userid=[userId]

   IMPORTANT:

   Do NOT trust ad_type from the URL.

   The backend finds the user's latest pending
   AdsGram intent and determines the ad type
   from PostgreSQL.

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


            if (!telegramId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Missing userid."

                });

            }


            const reward =
                await confirmAdsgramReward({

                    telegramId

                });


            return res.json({

                success: true,

                message:
                    "AdsGram reward confirmed.",

                reward: {

                    id:
                        reward.id,

                    adType:
                        reward.ad_type,

                    status:
                        reward.status,

                    confirmedAt:
                        reward.confirmed_at

                }

            });

        } catch (error) {

            console.error(
                "AdsGram Reward URL error:",
                error
            );


            if (
                error.code ===
                "USER_NOT_FOUND"
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Telegram user not found."

                });

            }


            if (
                error.code ===
                "NO_PENDING_AD"
            ) {

                return res.status(409).json({

                    success: false,

                    message:
                        "No pending ad reward."

                });

            }


            if (
                error.code ===
                "AD_ALREADY_PROCESSED"
            ) {

                return res.status(409).json({

                    success: false,

                    message:
                        "Ad reward was already processed."

                });

            }


            if (
                error.code ===
                "INVALID_AD_TYPE"
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Invalid stored ad type."

                });

            }


            return res.status(500).json({

                success: false,

                message:
                    "Unable to process ad reward."

            });

        }

    }
);


/* =========================================================
   API ROUTES
========================================================= */

app.use(
    "/api/auth",
    authLimiter,
    authRouter
);


app.use(
    "/api/game",
    gameRouter
);


app.use(
    "/api/rewards",
    rewardsRouter
);


app.use(
    "/api/leaderboard",
    leaderboardRouter
);


app.use(
    "/api/referrals",
    referralsRouter
);


app.use(
    "/api/withdrawals",
    withdrawalsRouter
);


/* =========================================================
   404
========================================================= */

app.use(
    (req, res) => {

        res.status(404).json({

            success: false,

            message:
                "Route not found."

        });

    }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
    (error, req, res, next) => {

        console.error(
            "Unhandled server error:",
            error
        );


        if (
            res.headersSent
        ) {

            return next(error);

        }


        res.status(
            Number(error.status) || 500
        ).json({

            success: false,

            message:
                NODE_ENV === "production"
                    ? (
                        error.expose
                            ? error.message
                            : "Internal server error."
                    )
                    : error.message

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
                "Server started successfully."
            );

            console.log(
                "Referral API: /api/referrals"
            );

            console.log(
                "AdsGram Reward URL: /api/adsgram/reward"
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


process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);


process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);

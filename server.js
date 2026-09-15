import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import pool from "./db/pool.js";

import authRoutes from "./routes/auth.js";
import gameRoutes from "./routes/game.js";
import rewardsRoutes from "./routes/rewards.js";
import leaderboardRoutes from "./routes/leaderboard.js";
import withdrawalRoutes from "./routes/withdrawals.js";
import referralRoutes from "./routes/referrals.js";

import {
    confirmAdsgramReward
} from "./services/rewards.js";

import { requireAuth } from "./middleware/auth.js";

const app = express();

const PORT = Number(process.env.PORT || 3000);

const NODE_ENV =
    process.env.NODE_ENV || "development";


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

const allowedOrigins = [
    "https://rathana935.github.io",
    "https://web.telegram.org",
    "https://webk.telegram.org"
];

if (process.env.FRONTEND_URL) {
    allowedOrigins.push(
        process.env.FRONTEND_URL
    );
}

app.use(
    cors({
        origin(origin, callback) {

            /*
             * Requests without Origin are allowed.
             *
             * Useful for:
             * - server-to-server requests
             * - AdsGram Reward URL
             * - health checks
             */

            if (!origin) {
                return callback(null, true);
            }

            /*
             * Development:
             * allow all origins.
             */

            if (NODE_ENV !== "production") {
                return callback(null, true);
            }

            /*
             * Explicitly allowed origins.
             */

            if (
                allowedOrigins.includes(origin)
            ) {
                return callback(null, true);
            }

            /*
             * Telegram WebApp origins.
             */

            if (
                origin.startsWith(
                    "https://web.telegram.org"
                ) ||
                origin.startsWith(
                    "https://webk.telegram.org"
                )
            ) {
                return callback(null, true);
            }

            return callback(
                new Error(
                    "CORS: Origin not allowed"
                )
            );
        },

        credentials: true,

        methods: [
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS"
        ],

        allowedHeaders: [
            "Content-Type",
            "Authorization"
        ]
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
        extended: true,
        limit: "100kb"
    })
);


/* =========================================================
   GLOBAL RATE LIMIT
========================================================= */

const globalLimiter =
    rateLimit({
        windowMs: 60 * 1000,

        limit: 100,

        standardHeaders: "draft-7",

        legacyHeaders: false,

        message: {
            success: false,
            error:
                "Too many requests. Please try again later."
        }
    });

app.use(
    globalLimiter
);


/* =========================================================
   AUTH RATE LIMIT
========================================================= */

const authLimiter =
    rateLimit({
        windowMs: 60 * 1000,

        limit: 20,

        standardHeaders: "draft-7",

        legacyHeaders: false,

        message: {
            success: false,
            error:
                "Too many authentication requests."
        }
    });


/* =========================================================
   GAME RATE LIMIT
========================================================= */

const gameLimiter =
    rateLimit({
        windowMs: 60 * 1000,

        limit: 60,

        standardHeaders: "draft-7",

        legacyHeaders: false,

        message: {
            success: false,
            error:
                "Too many game requests."
        }
    });


/* =========================================================
   REWARDS RATE LIMIT
========================================================= */

const rewardsLimiter =
    rateLimit({
        windowMs: 60 * 1000,

        limit: 30,

        standardHeaders: "draft-7",

        legacyHeaders: false,

        message: {
            success: false,
            error:
                "Too many reward requests."
        }
    });


/* =========================================================
   ADSGRAM CALLBACK RATE LIMIT
========================================================= */

const adsgramLimiter =
    rateLimit({
        windowMs: 60 * 1000,

        limit: 30,

        standardHeaders: "draft-7",

        legacyHeaders: false,

        message: {
            success: false,
            error:
                "Too many AdsGram callback requests."
        }
    });


/* =========================================================
   LEADERBOARD RATE LIMIT
========================================================= */

const leaderboardLimiter =
    rateLimit({
        windowMs: 60 * 1000,

        limit: 60,

        standardHeaders: "draft-7",

        legacyHeaders: false,

        message: {
            success: false,
            error:
                "Too many leaderboard requests."
        }
    });


/* =========================================================
   WITHDRAWAL RATE LIMIT
========================================================= */

const withdrawalLimiter =
    rateLimit({
        windowMs: 60 * 1000,

        limit: 10,

        standardHeaders: "draft-7",

        legacyHeaders: false,

        message: {
            success: false,
            error:
                "Too many withdrawal requests. Please try again later."
        }
    });


/* =========================================================
   REFERRAL RATE LIMIT
========================================================= */

const referralLimiter =
    rateLimit({
        windowMs: 60 * 1000,

        limit: 30,

        standardHeaders: "draft-7",

        legacyHeaders: false,

        message: {
            success: false,
            error:
                "Too many referral requests. Please try again later."
        }
    });


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

                status: "ok",

                database: "connected",

                environment: NODE_ENV,

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

                status: "error",

                database: "disconnected"
            });
        }
    }
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
                "Memory Card API",

            version:
                "1.0.0",

            status:
                "online"
        });
    }
);


/* =========================================================
   ADSGRAM REWARD CALLBACK
=========================================================

   IMPORTANT:

   This endpoint is PUBLIC.

   Do NOT add requireAuth.

   AdsGram calls this endpoint directly.

   Example:

   GET /api/adsgram/reward?userid=123456789

   Optional:

   GET /api/adsgram/reward?userid=123456789&adType=life

========================================================= */

app.get(
    "/api/adsgram/reward",
    adsgramLimiter,
    async (req, res) => {

        try {

            const telegramId =
                req.query?.userid ??
                req.query?.user_id ??
                null;

            const requestedAdType =
                req.query?.adType ??
                req.query?.ad_type ??
                null;

            const allowedAdTypes =
                new Set([
                    "life",
                    "double_reward",
                    "lucky_roll"
                ]);

            let adType = null;

            if (requestedAdType) {

                const normalized =
                    String(
                        requestedAdType
                    ).trim();

                if (
                    !allowedAdTypes.has(
                        normalized
                    )
                ) {

                    return res.status(400).json({
                        success: false,

                        error:
                            "INVALID_AD_TYPE"
                    });
                }

                adType = normalized;
            }

            if (
                telegramId === null ||
                telegramId === undefined ||
                String(
                    telegramId
                ).trim() === ""
            ) {

                return res.status(400).json({
                    success: false,

                    error:
                        "MISSING_USER_ID"
                });
            }

            /*
             * Important:
             *
             * confirmAdsgramReward()
             * does NOT directly give coins.
             *
             * It confirms a server-created
             * pending ad reward intent.
             */

            const result =
                await confirmAdsgramReward(
                    telegramId,
                    adType
                );

            return res
                .status(
                    result.success
                        ? 200
                        : 404
                )
                .json(result);

        } catch (error) {

            console.error(
                "AdsGram Reward URL error:",
                error
            );

            return res.status(500).json({
                success: false,

                error:
                    "AdsGram callback failed."
            });
        }
    }
);


/* =========================================================
   AUTH ROUTES
========================================================= */

app.use(
    "/api/auth",
    authLimiter,
    authRoutes
);


/* =========================================================
   GAME ROUTES
========================================================= */

app.use(
    "/api/game",
    gameLimiter,
    requireAuth,
    gameRoutes
);


/* =========================================================
   REWARD ROUTES
========================================================= */

app.use(
    "/api/rewards",
    rewardsLimiter,
    requireAuth,
    rewardsRoutes
);


/* =========================================================
   LEADERBOARD ROUTES
========================================================= */

app.use(
    "/api/leaderboard",
    leaderboardLimiter,
    requireAuth,
    leaderboardRoutes
);


/* =========================================================
   WITHDRAWAL ROUTES
========================================================= */

app.use(
    "/api/withdrawals",
    withdrawalLimiter,
    requireAuth,
    withdrawalRoutes
);


/* =========================================================
   REFERRAL ROUTES
========================================================= */

app.use(
    "/api/referrals",
    referralLimiter,
    requireAuth,
    referralRoutes
);


/* =========================================================
   404
========================================================= */

app.use(
    (req, res) => {

        return res.status(404).json({
            success: false,

            error:
                "Route not found.",

            path:
                req.originalUrl
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
            error.message?.startsWith(
                "CORS:"
            )
        ) {

            return res.status(403).json({
                success: false,

                error:
                    "Origin not allowed."
            });
        }

        return res.status(500).json({
            success: false,

            error:
                "Internal server error."
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
                "========================================"
            );

            console.log(
                "Memory Card Backend"
            );

            console.log(
                "========================================"
            );

            console.log(
                `Environment: ${NODE_ENV}`
            );

            console.log(
                `Port: ${PORT}`
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
                "========================================"
            );
        }
    );


/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

async function shutdown(signal) {

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

                console.log(
                    "Server stopped."
                );

                process.exit(0);

            } catch (error) {

                console.error(
                    "Shutdown error:",
                    error
                );

                process.exit(1);
            }
        }
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

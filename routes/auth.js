import express from "express";
import crypto from "crypto";

import pool from "../db/pool.js";

import {
    validateTelegramInitData
} from "../telegramAuth.js";

import {
    requireAuth
} from "../middleware/auth.js";


const router = express.Router();


/* =========================================================
   CONFIG
========================================================= */

const DEFAULT_REFERRAL_REWARD = 250;
const DEFAULT_SESSION_DAYS = 7;
const MAX_SESSION_DAYS = 365;


/* =========================================================
   SESSION HELPERS
========================================================= */

function generateSessionToken() {

    return crypto
        .randomBytes(48)
        .toString("hex");

}


function hashToken(token) {

    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

}


/* =========================================================
   SAFE NUMBER
========================================================= */

function safeNumber(value, fallback = 0) {

    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;

}


/* =========================================================
   REFERRAL HELPERS
========================================================= */

function getReferralCode(telegram) {

    return (
        telegram?.start_param ||
        telegram?.startParam ||
        null
    );

}


function getReferrerTelegramId(referralCode) {

    if (
        typeof referralCode !== "string"
    ) {

        return null;

    }


    const code =
        referralCode.trim();


    if (
        !code.startsWith("ref_")
    ) {

        return null;

    }


    const telegramId =
        code.substring(4).trim();


    if (
        !/^\d+$/.test(telegramId)
    ) {

        return null;

    }


    return telegramId;

}


/* =========================================================
   REFERRAL REWARD
========================================================= */

async function getReferralReward(client) {

    try {

        const result =
            await client.query(
                `
                SELECT value
                FROM app_settings
                WHERE key = 'referral'
                LIMIT 1
                `
            );


        if (
            result.rows.length > 0 &&
            result.rows[0].value
        ) {

            const settings =
                result.rows[0].value;


            const reward =
                Number(
                    settings.reward_coins
                );


            if (
                Number.isInteger(reward) &&
                reward > 0
            ) {

                return reward;

            }

        }

    } catch (error) {

        /*
         * Referral settings should never prevent
         * Telegram login from working.
         */

        console.error(
            "Failed to load referral settings:",
            error
        );

    }


    return DEFAULT_REFERRAL_REWARD;

}


/* =========================================================
   USER SERIALIZER
========================================================= */

function serializeUser(user) {

    if (!user) {

        return null;

    }


    const id =
        user.id ??
        user.user_id ??
        null;


    const telegramId =
        user.telegram_id ??
        user.telegramId ??
        null;


    const username =
        user.username ??
        null;


    const firstName =
        user.first_name ??
        user.firstName ??
        null;


    const lastName =
        user.last_name ??
        user.lastName ??
        null;


    const photoUrl =
        user.photo_url ??
        user.photoUrl ??
        null;


    const languageCode =
        user.language_code ??
        user.languageCode ??
        null;


    const isPremium =
        Boolean(
            user.is_premium ??
            user.isPremium ??
            false
        );


    const coins =
        safeNumber(
            user.coins
        );


    const todayCoins =
        safeNumber(
            user.today_coins ??
            user.todayCoins
        );


    const gamesPlayed =
        safeNumber(
            user.games_played ??
            user.gamesPlayed
        );


    const easyGames =
        safeNumber(
            user.easy_games ??
            user.easyGames
        );


    const mediumGames =
        safeNumber(
            user.medium_games ??
            user.mediumGames
        );


    const hardGames =
        safeNumber(
            user.hard_games ??
            user.hardGames
        );


    const easyLevel =
        safeNumber(
            user.easy_level ??
            user.easyLevel,
            1
        );


    const mediumLevel =
        safeNumber(
            user.medium_level ??
            user.mediumLevel,
            1
        );


    const hardLevel =
        safeNumber(
            user.hard_level ??
            user.hardLevel,
            1
        );


    const lives =
        safeNumber(
            user.lives,
            5
        );


    const dailyStreak =
        safeNumber(
            user.daily_streak ??
            user.dailyStreak
        );


    const lastDailyClaim =
        user.last_daily_claim ??
        user.lastDailyClaim ??
        null;


    const createdAt =
        user.created_at ??
        user.createdAt ??
        null;


    return {

        /* =================================================
           CAMEL CASE
        ================================================= */

        id,

        telegramId,

        username,

        firstName,

        lastName,

        photoUrl,

        languageCode,

        isPremium,

        coins,

        todayCoins,

        gamesPlayed,

        easyGames,

        mediumGames,

        hardGames,

        easyLevel,

        mediumLevel,

        hardLevel,

        lives,

        dailyStreak,

        lastDailyClaim,

        createdAt,


        /* =================================================
           SNAKE CASE COMPATIBILITY
        ================================================= */

        user_id:
            id,

        telegram_id:
            telegramId,

        first_name:
            firstName,

        last_name:
            lastName,

        photo_url:
            photoUrl,

        language_code:
            languageCode,

        is_premium:
            isPremium,

        today_coins:
            todayCoins,

        games_played:
            gamesPlayed,

        easy_games:
            easyGames,

        medium_games:
            mediumGames,

        hard_games:
            hardGames,

        easy_level:
            easyLevel,

        medium_level:
            mediumLevel,

        hard_level:
            hardLevel,

        daily_streak:
            dailyStreak,

        last_daily_claim:
            lastDailyClaim,

        created_at:
            createdAt

    };

}


/* =========================================================
   USER SELECT
========================================================= */

const USER_SELECT = `

    id,

    telegram_id,

    username,

    first_name,

    last_name,

    photo_url,

    language_code,

    is_premium,

    coins,

    today_coins,

    games_played,

    easy_games,

    medium_games,

    hard_games,

    easy_level,

    medium_level,

    hard_level,

    lives,

    daily_streak,

    last_daily_claim,

    created_at

`;


/* =========================================================
   POST /api/auth/telegram
========================================================= */

router.post(
    "/telegram",

    async (req, res) => {

        let client;


        try {

            /* =================================================
               DATABASE CONNECTION
            ================================================= */

            client =
                await pool.connect();


            /* =================================================
               READ INIT DATA
            ================================================= */

            const {
                initData
            } = req.body || {};


            if (
                typeof initData !== "string" ||
                !initData.trim()
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "initData is required"

                });

            }


            /* =================================================
               VERIFY TELEGRAM INIT DATA
            ================================================= */

            const telegram =
                validateTelegramInitData(
                    initData
                );


            const tgUser =
                telegram?.user;


            if (
                !tgUser ||
                !tgUser.id
            ) {

                return res.status(401).json({

                    success: false,

                    error:
                        "Telegram user information is missing."

                });

            }


            const telegramId =
                String(
                    tgUser.id
                );


            /* =================================================
               REFERRAL
            ================================================= */

            const referralCode =
                getReferralCode(
                    telegram
                );


            const referrerTelegramId =
                getReferrerTelegramId(
                    referralCode
                );


            /* =================================================
               START TRANSACTION
            ================================================= */

            await client.query(
                "BEGIN"
            );


            /* =================================================
               CHECK EXISTING USER
            ================================================= */

            const existingUserResult =
                await client.query(
                    `
                    SELECT
                        id,
                        telegram_id
                    FROM users
                    WHERE telegram_id = $1
                    FOR UPDATE
                    `,
                    [
                        telegramId
                    ]
                );


            const isNewUser =
                existingUserResult.rows.length === 0;


            /* =================================================
               CREATE / UPDATE USER
            ================================================= */

            const userResult =
                await client.query(
                    `
                    INSERT INTO users
                    (
                        telegram_id,
                        username,
                        first_name,
                        last_name,
                        photo_url,
                        language_code,
                        is_premium,
                        last_seen_at,
                        updated_at
                    )

                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        $7,
                        NOW(),
                        NOW()
                    )

                    ON CONFLICT (
                        telegram_id
                    )

                    DO UPDATE SET

                        username =
                            EXCLUDED.username,

                        first_name =
                            EXCLUDED.first_name,

                        last_name =
                            EXCLUDED.last_name,

                        photo_url =
                            EXCLUDED.photo_url,

                        language_code =
                            EXCLUDED.language_code,

                        is_premium =
                            EXCLUDED.is_premium,

                        last_seen_at =
                            NOW(),

                        updated_at =
                            NOW()

                    RETURNING

                        ${USER_SELECT}
                    `,

                    [

                        telegramId,

                        tgUser.username ||
                            null,

                        tgUser.first_name ||
                            null,

                        tgUser.last_name ||
                            null,

                        tgUser.photo_url ||
                            null,

                        tgUser.language_code ||
                            null,

                        Boolean(
                            tgUser.is_premium
                        )

                    ]
                );


            const user =
                userResult.rows[0];


            if (!user) {

                throw new Error(
                    "Unable to create or load user."
                );

            }


            /* =================================================
               REFERRAL PROCESSING
            ================================================= */

            let referralCreated =
                false;


            let referralReward =
                0;


            if (
                isNewUser &&
                referrerTelegramId &&
                referrerTelegramId !== telegramId
            ) {

                const configuredReward =
                    await getReferralReward(
                        client
                    );


                /* =============================================
                   FIND REFERRER
                ============================================= */

                const referrerResult =
                    await client.query(
                        `
                        SELECT
                            id,
                            telegram_id,
                            coins,
                            today_coins
                        FROM users
                        WHERE telegram_id = $1
                        FOR UPDATE
                        `,
                        [
                            referrerTelegramId
                        ]
                    );


                if (
                    referrerResult.rows.length > 0
                ) {

                    const referrer =
                        referrerResult.rows[0];


                    /* =========================================
                       CHECK DUPLICATE REFERRAL
                    ========================================= */

                    const existingReferralResult =
                        await client.query(
                            `
                            SELECT id
                            FROM referrals
                            WHERE referred_user_id = $1
                            LIMIT 1
                            `,
                            [
                                user.id
                            ]
                        );


                    if (
                        existingReferralResult
                            .rows
                            .length === 0
                    ) {

                        const balanceBefore =
                            safeNumber(
                                referrer.coins
                            );


                        const balanceAfter =
                            balanceBefore +
                            configuredReward;


                        /* =====================================
                           CREATE REFERRAL
                        ===================================== */

                        const referralResult =
                            await client.query(
                                `
                                INSERT INTO referrals
                                (
                                    referrer_user_id,
                                    referred_user_id,
                                    reward_coins,
                                    status,
                                    created_at,
                                    completed_at
                                )

                                VALUES
                                (
                                    $1,
                                    $2,
                                    $3,
                                    'completed',
                                    NOW(),
                                    NOW()
                                )

                                ON CONFLICT (
                                    referred_user_id
                                )

                                DO NOTHING

                                RETURNING id
                                `,
                                [
                                    referrer.id,
                                    user.id,
                                    configuredReward
                                ]
                            );


                        if (
                            referralResult.rows.length > 0
                        ) {

                            const referralId =
                                referralResult
                                    .rows[0]
                                    .id;


                            /* =================================
                               ADD REFERRAL REWARD
                            ================================= */

                            await client.query(
                                `
                                UPDATE users

                                SET

                                    coins =
                                        coins + $1,

                                    today_coins =
                                        today_coins + $1,

                                    updated_at =
                                        NOW()

                                WHERE id = $2
                                `,
                                [
                                    configuredReward,
                                    referrer.id
                                ]
                            );


                            /* =================================
                               RECORD TRANSACTION
                            ================================= */

                            await client.query(
                                `
                                INSERT INTO coin_transactions
                                (
                                    user_id,
                                    type,
                                    amount,
                                    balance_before,
                                    balance_after,
                                    reference_id,
                                    description
                                )

                                VALUES
                                (
                                    $1,
                                    $2,
                                    $3,
                                    $4,
                                    $5,
                                    $6,
                                    $7
                                )
                                `,
                                [

                                    referrer.id,

                                    "referral",

                                    configuredReward,

                                    balanceBefore,

                                    balanceAfter,

                                    referralId,

                                    "Referral reward for inviting a new user."

                                ]
                            );


                            referralCreated =
                                true;


                            referralReward =
                                configuredReward;

                        }

                    }

                }

            }


            /* =================================================
               REFRESH USER
            ================================================= */

            const refreshedUserResult =
                await client.query(
                    `
                    SELECT

                        ${USER_SELECT}

                    FROM users

                    WHERE id = $1

                    LIMIT 1
                    `,
                    [
                        user.id
                    ]
                );


            const finalUser =
                refreshedUserResult.rows[0];


            if (!finalUser) {

                throw new Error(
                    "Unable to load authenticated user."
                );

            }


            /* =================================================
               SESSION CONFIG
            ================================================= */

            let sessionDays =
                Number(
                    process.env.SESSION_DAYS ||
                    DEFAULT_SESSION_DAYS
                );


            if (
                !Number.isFinite(sessionDays) ||
                sessionDays <= 0
            ) {

                sessionDays =
                    DEFAULT_SESSION_DAYS;

            }


            sessionDays =
                Math.min(
                    Math.floor(sessionDays),
                    MAX_SESSION_DAYS
                );


            /* =================================================
               CREATE SESSION TOKEN
            ================================================= */

            const sessionToken =
                generateSessionToken();


            const tokenHash =
                hashToken(
                    sessionToken
                );


            /* =================================================
               INSERT SESSION
            ================================================= */

            await client.query(
                `
                INSERT INTO auth_sessions
                (
                    user_id,
                    token_hash,
                    expires_at,
                    user_agent,
                    ip_address
                )

                VALUES
                (
                    $1,
                    $2,
                    NOW() +
                        ($3 * INTERVAL '1 day'),
                    $4,
                    $5
                )
                `,
                [

                    finalUser.id,

                    tokenHash,

                    sessionDays,

                    req.headers["user-agent"] ||
                        null,

                    req.ip ||
                        null

                ]
            );


            /* =================================================
               DELETE OLD / EXPIRED SESSIONS
            ================================================= */

            await client.query(
                `
                DELETE FROM auth_sessions

                WHERE user_id = $1

                  AND expires_at < NOW()
                `,
                [
                    finalUser.id
                ]
            );


            /* =================================================
               COMMIT
            ================================================= */

            await client.query(
                "COMMIT"
            );


            /* =================================================
               SERIALIZE USER
            ================================================= */

            const serializedUser =
                serializeUser(
                    finalUser
                );


            /* =================================================
               SUCCESS
            ================================================= */

            return res.json({

                success: true,

                token:
                    sessionToken,

                accessToken:
                    sessionToken,

                tokenType:
                    "Bearer",

                expiresIn:
                    sessionDays *
                    24 *
                    60 *
                    60,

                referral: {

                    created:
                        referralCreated,

                    rewardCoins:
                        referralReward,

                    reward_coins:
                        referralReward

                },

                user:
                    serializedUser

            });


        } catch (error) {

            /* =================================================
               ROLLBACK
            ================================================= */

            if (client) {

                try {

                    await client.query(
                        "ROLLBACK"
                    );

                } catch (rollbackError) {

                    console.error(
                        "Authentication rollback error:",
                        rollbackError
                    );

                }

            }


            console.error(
                "Telegram authentication error:",
                error
            );


            /*
             * Telegram validation errors normally come from
             * validateTelegramInitData().
             */

            const statusCode =
                Number.isInteger(
                    error?.statusCode
                )
                    ? error.statusCode
                    : 401;


            return res.status(
                statusCode
            ).json({

                success: false,

                error:
                    error?.message ||
                    "Telegram authentication failed"

            });

        } finally {

            if (client) {

                client.release();

            }

        }

    }
);


/* =========================================================
   GET /api/auth/me
========================================================= */

router.get(
    "/me",

    requireAuth,

    async (req, res) => {

        try {

            const userId =
                req.user.user_id ||
                req.user.id;


            if (!userId) {

                return res.status(401).json({

                    success: false,

                    error:
                        "Authenticated user ID is missing."

                });

            }


            const result =
                await pool.query(
                    `
                    SELECT

                        ${USER_SELECT}

                    FROM users

                    WHERE id = $1

                    LIMIT 1
                    `,
                    [
                        userId
                    ]
                );


            if (
                result.rowCount === 0
            ) {

                return res.status(404).json({

                    success: false,

                    error:
                        "User not found."

                });

            }


            const user =
                serializeUser(
                    result.rows[0]
                );


            return res.json({

                success: true,

                user

            });


        } catch (error) {

            console.error(
                "Auth /me error:",
                error
            );


            return res.status(500).json({

                success: false,

                error:
                    "Unable to load user."

            });

        }

    }
);


/* =========================================================
   POST /api/auth/logout
========================================================= */

router.post(
    "/logout",

    requireAuth,

    async (req, res) => {

        try {

            const header =
                req.headers.authorization;


            if (
                typeof header !== "string" ||
                !header.startsWith("Bearer ")
            ) {

                return res.status(401).json({

                    success: false,

                    error:
                        "Authentication token is required."

                });

            }


            const token =
                header
                    .substring(7)
                    .trim();


            if (!token) {

                return res.status(401).json({

                    success: false,

                    error:
                        "Authentication token is required."

                });

            }


            const tokenHash =
                hashToken(
                    token
                );


            await pool.query(
                `
                DELETE FROM auth_sessions

                WHERE token_hash = $1
                `,
                [
                    tokenHash
                ]
            );


            return res.json({

                success: true,

                message:
                    "Logged out successfully."

            });


        } catch (error) {

            console.error(
                "Logout error:",
                error
            );


            return res.status(500).json({

                success: false,

                error:
                    "Logout failed."

            });

        }

    }
);


/* =========================================================
   EXPORT
========================================================= */

export default router;

import express from "express";
import crypto from "crypto";

import pool from "../db/pool.js";

import {
    validateTelegramInitData
} from "../services/telegram.js";

import {
    requireAuth
} from "../middleware/auth.js";

const router = express.Router();


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
   REFERRAL HELPERS
========================================================= */

const REFERRAL_REWARD = 250;


/*
Telegram referral links will look like:

https://t.me/YOUR_BOT?startapp=ref_123456789

or

https://t.me/YOUR_BOT?start=ref_123456789

The Telegram WebApp initData can contain start_param.
*/

function getReferralCode(telegram) {

    return (
        telegram?.start_param ||
        telegram?.startParam ||
        null
    );

}


/*
Expected referral code:

ref_123456789

where 123456789 is the referrer's
Telegram ID.
*/

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

    if (!/^\d+$/.test(telegramId)) {
        return null;
    }

    return telegramId;

}


/* =========================================================
   POST /api/auth/telegram
========================================================= */

router.post(
    "/telegram",
    async (req, res) => {

        const client =
            await pool.connect();

        try {

            const {
                initData
            } = req.body || {};


            if (!initData) {

                return res.status(400).json({
                    success: false,
                    error:
                        "initData is required"
                });

            }


            /*
            -------------------------------------------------
            VERIFY TELEGRAM INIT DATA
            -------------------------------------------------
            */

            const telegram =
                validateTelegramInitData(
                    initData
                );


            const tgUser =
                telegram.user;


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


            /*
            -------------------------------------------------
            GET REFERRAL INFORMATION
            -------------------------------------------------
            */

            const referralCode =
                getReferralCode(
                    telegram
                );

            const referrerTelegramId =
                getReferrerTelegramId(
                    referralCode
                );


            await client.query(
                "BEGIN"
            );


            /*
            -------------------------------------------------
            CHECK WHETHER THIS TELEGRAM USER ALREADY EXISTS
            -------------------------------------------------
            */

            const existingUserResult =
                await client.query(
                    `
                    SELECT
                        id,
                        telegram_id,
                        coins
                    FROM users
                    WHERE telegram_id = $1
                    FOR UPDATE
                    `,
                    [
                        String(tgUser.id)
                    ]
                );


            const isNewUser =
                existingUserResult
                    .rows
                    .length === 0;


            /*
            -------------------------------------------------
            CREATE OR UPDATE TELEGRAM USER
            -------------------------------------------------
            */

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
                        last_seen_at
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
                        NOW()
                    )

                    ON CONFLICT (telegram_id)

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
                            NOW()

                    RETURNING
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
                    `,
                    [
                        String(tgUser.id),

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


            /* =================================================
               PROCESS REFERRAL
               
               Only NEW users can trigger referral rewards.
            ================================================= */

            let referralReward = 0;
            let referralCreated = false;


            if (
                isNewUser &&
                referrerTelegramId &&
                referrerTelegramId !==
                    String(tgUser.id)
            ) {

                /*
                Find the referrer.
                */

                const referrerResult =
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
                            referrerTelegramId
                        ]
                    );


                if (
                    referrerResult.rows.length > 0
                ) {

                    const referrer =
                        referrerResult
                            .rows[0];


                    /*
                    Make sure this user hasn't
                    already been referred.
                    */

                    const existingReferralResult =
                        await client.query(
                            `
                            SELECT id
                            FROM referrals
                            WHERE referred_user_id = $1
                            LIMIT 1
                            `,
                            [user.id]
                        );


                    if (
                        existingReferralResult
                            .rows
                            .length === 0
                    ) {

                        /*
                        Create referral record.
                        */

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
                            `,
                            [
                                referrer.id,
                                user.id,
                                REFERRAL_REWARD
                            ]
                        );


                        /*
                        Give referrer +250 coins.
                        */

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
                                REFERRAL_REWARD,
                                referrer.id
                            ]
                        );


                        referralReward =
                            REFERRAL_REWARD;

                        referralCreated =
                            true;

                    }

                }

            }


            /*
            -------------------------------------------------
            CREATE SERVER-SIDE SESSION
            -------------------------------------------------
            */

            const sessionToken =
                generateSessionToken();


            const tokenHash =
                hashToken(
                    sessionToken
                );


            const sessionDays =
                Number(
                    process.env.SESSION_DAYS ||
                    30
                );


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
                    user.id,

                    tokenHash,

                    sessionDays,

                    req.headers[
                        "user-agent"
                    ] || null,

                    req.ip || null
                ]
            );


            /*
            -------------------------------------------------
            DELETE EXPIRED SESSIONS
            -------------------------------------------------
            */

            await client.query(
                `
                DELETE FROM auth_sessions
                WHERE user_id = $1
                  AND expires_at < NOW()
                `,
                [user.id]
            );


            await client.query(
                "COMMIT"
            );


            /*
            -------------------------------------------------
            IMPORTANT:
            If this user received something else during
            authentication in the future, the response
            can still be extended here.
            -------------------------------------------------
            */

            return res.json({

                success: true,

                token:
                    sessionToken,

                expiresIn:
                    sessionDays *
                    24 *
                    60 *
                    60,

                referral: {

                    created:
                        referralCreated,

                    rewardCoins:
                        referralReward

                },

                user: {

                    id:
                        user.id,

                    telegramId:
                        user.telegram_id,

                    username:
                        user.username,

                    firstName:
                        user.first_name,

                    lastName:
                        user.last_name,

                    photoUrl:
                        user.photo_url,

                    coins:
                        Number(
                            user.coins
                        ),

                    todayCoins:
                        Number(
                            user.today_coins
                        ),

                    gamesPlayed:
                        user.games_played,

                    easyGames:
                        user.easy_games,

                    mediumGames:
                        user.medium_games,

                    hardGames:
                        user.hard_games,

                    easyLevel:
                        user.easy_level,

                    mediumLevel:
                        user.medium_level,

                    hardLevel:
                        user.hard_level,

                    lives:
                        user.lives,

                    dailyStreak:
                        user.daily_streak,

                    lastDailyClaim:
                        user.last_daily_claim
                }

            });


        } catch (error) {

            try {
                await client.query(
                    "ROLLBACK"
                );
            } catch {
                // Ignore rollback errors
            }


            console.error(
                "Telegram authentication error:",
                error
            );


            return res.status(401).json({

                success: false,

                error:
                    error.message ||
                    "Telegram authentication failed"

            });


        } finally {

            client.release();

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

        return res.json({

            success: true,

            user: {

                id:
                    req.user.user_id,

                telegramId:
                    req.user.telegram_id,

                username:
                    req.user.username,

                firstName:
                    req.user.first_name,

                lastName:
                    req.user.last_name,

                photoUrl:
                    req.user.photo_url,

                coins:
                    Number(
                        req.user.coins
                    ),

                todayCoins:
                    Number(
                        req.user.today_coins
                    ),

                gamesPlayed:
                    req.user.games_played,

                easyGames:
                    req.user.easy_games,

                mediumGames:
                    req.user.medium_games,

                hardGames:
                    req.user.hard_games,

                easyLevel:
                    req.user.easy_level,

                mediumLevel:
                    req.user.medium_level,

                hardLevel:
                    req.user.hard_level,

                lives:
                    req.user.lives,

                dailyStreak:
                    req.user.daily_streak,

                lastDailyClaim:
                    req.user.last_daily_claim
            }

        });

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
                !header ||
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
                hashToken(token);


            await pool.query(
                `
                DELETE FROM auth_sessions
                WHERE token_hash = $1
                `,
                [tokenHash]
            );


            return res.json({

                success: true

            });

        } catch (error) {

            console.error(
                "Logout error:",
                error
            );


            return res.status(500).json({

                success: false,

                error:
                    "Logout failed"

            });

        }

    }
);


export default router;

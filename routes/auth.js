import express from "express";

import crypto from "crypto";

import pool from "../db/pool.js";

import {
    validateTelegramInitData
} from "../services/telegram.js";

const router =
    express.Router();


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


/*
============================================================
POST /api/auth/telegram
============================================================
*/

router.post(
    "/telegram",
    async (req, res) => {

        const client =
            await pool.connect();


        try {

            const {
                initData
            } = req.body;


            if (!initData) {

                return res.status(400).json({
                    success: false,
                    error:
                        "initData is required"
                });

            }


            /*
            Verify directly against
            Telegram's signed data.
            */

            const telegram =
                validateTelegramInitData(
                    initData
                );


            const tgUser =
                telegram.user;


            await client.query("BEGIN");


            /*
            Create or update Telegram user.
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


            /*
            Create server-side session.
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
            Remove old expired sessions.
            */

            await client.query(
                `
                DELETE FROM auth_sessions
                WHERE user_id = $1
                  AND expires_at < NOW()
                `,
                [user.id]
            );


            await client.query("COMMIT");


            return res.json({

                success: true,

                token: sessionToken,

                expiresIn:
                    sessionDays *
                    24 *
                    60 *
                    60,

                user: {

                    id: user.id,

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
                        Number(user.coins),

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

            await client.query(
                "ROLLBACK"
            );


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


/*
============================================================
GET /api/auth/me
============================================================
*/

import {
    requireAuth
} from "../middleware/auth.js";


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


/*
============================================================
POST /api/auth/logout
============================================================
*/

router.post(
    "/logout",
    requireAuth,
    async (req, res) => {

        try {

            const header =
                req.headers.authorization;

            const token =
                header
                    .substring(7)
                    .trim();


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

            console.error(error);

            return res.status(500).json({

                success: false,

                error:
                    "Logout failed"

            });

        }

    }
);


export default router;

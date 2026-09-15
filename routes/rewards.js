import express from "express";

import {
    createAdRewardIntent,
    claimDailyBonus,
    luckyRoll,
    claimAdLife,
    consumeDoubleGameRewardAd,
    getRewardStatus
} from "../services/rewards.js";

import pool from "../db/pool.js";

const router = express.Router();


/*
============================================================
HELPER
============================================================
*/

function getUserId(req) {

    return req.user?.user_id || null;

}


/*
============================================================
POST /api/rewards/ad-intent

Creates a short-lived server-side AdsGram reward intent.

Supported:
- life
- double_reward
- lucky_roll

For double_reward:
gameSessionId is REQUIRED.
============================================================
*/

router.post(
    "/ad-intent",
    async (req, res) => {

        try {

            const userId = getUserId(req);

            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error: "Authentication required."
                });

            }


            const adType =
                String(req.body?.adType || "")
                    .trim()
                    .toLowerCase();


            const allowedTypes = [
                "life",
                "double_reward",
                "lucky_roll"
            ];


            if (!allowedTypes.includes(adType)) {

                return res.status(400).json({
                    success: false,
                    error: "INVALID_AD_TYPE"
                });

            }


            const metadata =
                req.body?.metadata &&
                typeof req.body.metadata === "object" &&
                !Array.isArray(req.body.metadata)
                    ? req.body.metadata
                    : {};


            /*
            ------------------------------------------------
            Double Reward MUST be connected to a game session
            ------------------------------------------------
            */

            if (adType === "double_reward") {

                const gameSessionId =
                    String(
                        metadata.gameSessionId ||
                        req.body?.gameSessionId ||
                        ""
                    ).trim();


                if (!gameSessionId) {

                    return res.status(400).json({
                        success: false,
                        error: "GAME_SESSION_ID_REQUIRED"
                    });

                }


                metadata.gameSessionId =
                    gameSessionId;

            }


            const result =
                await createAdRewardIntent(
                    userId,
                    adType,
                    metadata
                );


            return res.status(201).json(result);

        } catch (error) {

            console.error(
                "AdsGram intent route error:",
                error
            );


            if (
                error.message === "USER_NOT_FOUND"
            ) {

                return res.status(404).json({
                    success: false,
                    error: "User not found."
                });

            }


            if (
                error.message === "USER_BLOCKED"
            ) {

                return res.status(403).json({
                    success: false,
                    error: "USER_BLOCKED"
                });

            }


            if (
                error.message === "GAME_SESSION_ID_REQUIRED"
            ) {

                return res.status(400).json({
                    success: false,
                    error: "GAME_SESSION_ID_REQUIRED"
                });

            }


            if (
                error.message === "INVALID_GAME_SESSION_ID"
            ) {

                return res.status(400).json({
                    success: false,
                    error: "INVALID_GAME_SESSION_ID"
                });

            }


            return res.status(500).json({
                success: false,
                error:
                    "Unable to create advertisement intent."
            });

        }

    }
);


/*
============================================================
POST /api/rewards/daily

Claim Daily Bonus.

The server determines:
- reward amount
- date
- streak
- balance

The client cannot choose the reward.
============================================================
*/

router.post(
    "/daily",
    async (req, res) => {

        try {

            const userId = getUserId(req);

            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error: "Authentication required."
                });

            }


            const result =
                await claimDailyBonus(userId);


            if (
                result.success === false &&
                result.error === "ALREADY_CLAIMED"
            ) {

                return res.status(409).json(result);

            }


            return res.status(200).json(result);

        } catch (error) {

            console.error(
                "Daily bonus route error:",
                error
            );


            if (
                error.message === "USER_NOT_FOUND"
            ) {

                return res.status(404).json({
                    success: false,
                    error: "User not found."
                });

            }


            if (
                error.message === "USER_BLOCKED"
            ) {

                return res.status(403).json({
                    success: false,
                    error: "USER_BLOCKED"
                });

            }


            if (
                error.message ===
                "DAILY_BONUS_DISABLED"
            ) {

                return res.status(503).json({
                    success: false,
                    error:
                        "Daily bonus is temporarily unavailable."
                });

            }


            return res.status(500).json({
                success: false,
                error:
                    "Unable to claim daily bonus."
            });

        }

    }
);


/*
============================================================
POST /api/rewards/lucky-roll

Lucky Roll.

The frontend MUST NOT provide:
- adCompleted
- reward
- coins
- rollNumber
- balance
- payout

The server:
1. Checks cooldown
2. Consumes verified AdsGram reward
3. Generates random number
4. Calculates reward
5. Updates balance
============================================================
*/

router.post(
    "/lucky-roll",
    async (req, res) => {

        try {

            const userId = getUserId(req);

            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error: "Authentication required."
                });

            }


            const result =
                await luckyRoll(userId);


            if (
                result.success === false &&
                result.error === "AD_REQUIRED"
            ) {

                return res.status(403).json(result);

            }


            if (
                result.success === false &&
                result.error === "COOLDOWN"
            ) {

                return res.status(429).json(result);

            }


            return res.status(200).json(result);

        } catch (error) {

            console.error(
                "Lucky roll route error:",
                error
            );


            if (
                error.message === "USER_NOT_FOUND"
            ) {

                return res.status(404).json({
                    success: false,
                    error: "User not found."
                });

            }


            if (
                error.message === "USER_BLOCKED"
            ) {

                return res.status(403).json({
                    success: false,
                    error: "USER_BLOCKED"
                });

            }


            if (
                error.message ===
                "INVALID_LUCKY_REWARD"
            ) {

                return res.status(500).json({
                    success: false,
                    error:
                        "Lucky Roll configuration error."
                });

            }


            return res.status(500).json({
                success: false,
                error:
                    "Unable to perform Lucky Roll."
            });

        }

    }
);


/*
============================================================
POST /api/rewards/life

Watch verified AdsGram rewarded ad → +1 Life.

The server only grants the life when a verified,
unused advertisement reward exists.
============================================================
*/

router.post(
    "/life",
    async (req, res) => {

        try {

            const userId = getUserId(req);

            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error: "Authentication required."
                });

            }


            const result =
                await claimAdLife(userId);


            if (
                result.success === false &&
                result.error === "AD_REQUIRED"
            ) {

                return res.status(403).json(result);

            }


            if (
                result.success === false &&
                result.error === "MAX_LIVES"
            ) {

                return res.status(409).json(result);

            }


            return res.status(200).json(result);

        } catch (error) {

            console.error(
                "Ad life route error:",
                error
            );


            if (
                error.message === "USER_NOT_FOUND"
            ) {

                return res.status(404).json({
                    success: false,
                    error: "User not found."
                });

            }


            if (
                error.message === "USER_BLOCKED"
            ) {

                return res.status(403).json({
                    success: false,
                    error: "USER_BLOCKED"
                });

            }


            return res.status(500).json({
                success: false,
                error:
                    "Unable to claim life."
            });

        }

    }
);


/*
============================================================
POST /api/rewards/double-game-reward

Consumes a VERIFIED AdsGram reward for a specific
completed game session.

REQUEST:

{
    "gameSessionId": "UUID"
}

IMPORTANT:
The gameSessionId comes from the server when the game
starts.

The server verifies:
- authenticated user
- valid session
- session belongs to user
- verified AdsGram reward
- reward intent is tied to this session
- ad has not already been consumed

The client cannot choose the reward amount.
============================================================
*/

router.post(
    "/double-game-reward",
    async (req, res) => {

        const client =
            await pool.connect();


        try {

            const userId = getUserId(req);

            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error: "Authentication required."
                });

            }


            const gameSessionId =
                String(
                    req.body?.gameSessionId || ""
                ).trim();


            if (!gameSessionId) {

                return res.status(400).json({
                    success: false,
                    error:
                        "GAME_SESSION_ID_REQUIRED"
                });

            }


            /*
            ------------------------------------------------
            Validate UUID format before database query.
            ------------------------------------------------
            */

            const UUID_REGEX =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


            if (!UUID_REGEX.test(gameSessionId)) {

                return res.status(400).json({
                    success: false,
                    error:
                        "INVALID_GAME_SESSION_ID"
                });

            }


            /*
            ------------------------------------------------
            Verify the game session belongs to this user.
            ------------------------------------------------
            */

            const sessionResult =
                await client.query(
                    `
                    SELECT
                        id,
                        user_id,
                        difficulty,
                        status,
                        reward_coins
                    FROM game_sessions
                    WHERE id = $1
                      AND user_id = $2
                    LIMIT 1
                    `,
                    [
                        gameSessionId,
                        userId
                    ]
                );


            if (
                sessionResult.rowCount === 0
            ) {

                return res.status(404).json({
                    success: false,
                    error:
                        "GAME_SESSION_NOT_FOUND"
                });

            }


            const session =
                sessionResult.rows[0];


            /*
            ------------------------------------------------
            Only completed games can receive Double Reward.
            ------------------------------------------------
            */

            if (
                session.status !== "completed"
            ) {

                return res.status(409).json({
                    success: false,
                    error:
                        "GAME_SESSION_NOT_COMPLETED"
                });

            }


            /*
            ------------------------------------------------
            Consume the verified AdsGram reward.
            ------------------------------------------------
            */

            const result =
                await consumeDoubleGameRewardAd(
                    client,
                    userId,
                    gameSessionId
                );


            if (
                result.success === false &&
                result.error === "AD_REQUIRED"
            ) {

                return res.status(403).json(result);

            }


            return res.status(200).json(result);

        } catch (error) {

            console.error(
                "Double reward route error:",
                error
            );


            if (
                error.message === "USER_NOT_FOUND"
            ) {

                return res.status(404).json({
                    success: false,
                    error: "User not found."
                });

            }


            if (
                error.message === "USER_BLOCKED"
            ) {

                return res.status(403).json({
                    success: false,
                    error: "USER_BLOCKED"
                });

            }


            if (
                error.message ===
                "INVALID_GAME_SESSION_ID"
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "INVALID_GAME_SESSION_ID"
                });

            }


            return res.status(500).json({
                success: false,
                error:
                    "Unable to verify double reward advertisement."
            });

        } finally {

            client.release();

        }

    }
);


/*
============================================================
GET /api/rewards/status

Returns:
- balance
- today's coins
- daily bonus
- daily claim status
- streak
- Lucky Roll status
- Lucky Roll cooldown
- next roll time
- lives
- verified advertisement counts
============================================================
*/

router.get(
    "/status",
    async (req, res) => {

        try {

            const userId = getUserId(req);

            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error: "Authentication required."
                });

            }


            const result =
                await getRewardStatus(userId);


            return res.status(200).json(result);

        } catch (error) {

            console.error(
                "Reward status route error:",
                error
            );


            if (
                error.message === "USER_NOT_FOUND"
            ) {

                return res.status(404).json({
                    success: false,
                    error: "User not found."
                });

            }


            if (
                error.message === "USER_BLOCKED"
            ) {

                return res.status(403).json({
                    success: false,
                    error: "USER_BLOCKED"
                });

            }


            return res.status(500).json({
                success: false,
                error:
                    "Unable to load reward status."
            });

        }

    }
);


export default router;

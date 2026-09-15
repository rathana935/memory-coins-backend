import express from "express";

import {
    createAdRewardIntent,
    claimDailyBonus,
    luckyRoll,
    claimAdLife,
    consumeDoubleGameRewardAd,
    getRewardStatus
} from "../services/rewards.js";

const router = express.Router();


/*
============================================================
POST /api/rewards/ad-intent

Creates a short-lived server-side AdsGram reward intent.

The frontend requests this BEFORE showing an ad.

Supported ad types:
- life
- double_reward
- lucky_roll

IMPORTANT:
The client does NOT receive permission to directly award
coins or lives.

The AdsGram Reward URL must later confirm the intent.
============================================================
*/

router.post(
    "/ad-intent",
    async (req, res) => {

        try {

            const userId =
                req.user?.user_id;

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
                typeof req.body.metadata === "object"
                    ? req.body.metadata
                    : {};


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

IMPORTANT:
- Client cannot choose reward amount.
- Server calculates reward.
- Authentication is required.
============================================================
*/

router.post(
    "/daily",
    async (req, res) => {

        try {

            const userId =
                req.user?.user_id;

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

IMPORTANT SECURITY RULE
------------------------------------------------------------
The frontend MUST NOT send:

- adCompleted
- reward
- coins
- rollNumber
- balance
- payout

The server checks whether a VERIFIED AdsGram reward
is available for the user.

The server generates the random number and calculates
the reward.
============================================================
*/

router.post(
    "/lucky-roll",
    async (req, res) => {

        try {

            const userId =
                req.user?.user_id;

            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error: "Authentication required."
                });

            }


            const result =
                await luckyRoll(userId);


            /*
            ------------------------------------------------
            Verified advertisement required
            ------------------------------------------------
            */

            if (
                result.success === false &&
                result.error === "AD_REQUIRED"
            ) {

                return res.status(403).json(result);

            }


            /*
            ------------------------------------------------
            Cooldown
            ------------------------------------------------
            */

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

Watch AdsGram rewarded ad → +1 Life.

The server only grants the life when a verified,
unused AdsGram reward exists.
============================================================
*/

router.post(
    "/life",
    async (req, res) => {

        try {

            const userId =
                req.user?.user_id;

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

Consumes a VERIFIED AdsGram reward for the
Double Reward feature.

IMPORTANT:
This endpoint should eventually be connected directly
to the completed game session/result so the same game
cannot be doubled more than once.

The service must remain server-authoritative.
============================================================
*/

router.post(
    "/double-game-reward",
    async (req, res) => {

        try {

            const userId =
                req.user?.user_id;

            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error: "Authentication required."
                });

            }


            const result =
                await consumeDoubleGameRewardAd(
                    userId
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


            return res.status(500).json({
                success: false,
                error:
                    "Unable to verify double reward advertisement."
            });

        }

    }
);


/*
============================================================
GET /api/rewards/status

Returns:

- balance
- today's coins
- daily bonus amount
- daily bonus claimed status
- streak
- Lucky Roll availability
- Lucky Roll cooldown
- remaining seconds
- next roll time
- lives
- verified advertisement counts
============================================================
*/

router.get(
    "/status",
    async (req, res) => {

        try {

            const userId =
                req.user?.user_id;

            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error: "Authentication required."
                });

            }


            const result =
                await getRewardStatus(
                    userId
                );


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


            return res.status(500).json({
                success: false,
                error:
                    "Unable to load reward status."
            });

        }

    }
);


export default router;

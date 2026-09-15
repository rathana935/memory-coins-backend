import express from "express";

import {
    claimDailyBonus,
    luckyRoll,
    getRewardStatus
} from "../services/rewards.js";

const router = express.Router();


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


            /*
            ------------------------------------------------
            Already claimed today
            ------------------------------------------------
            */

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


            /*
            ------------------------------------------------
            Known errors
            ------------------------------------------------
            */

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

Lucky Roll currently requires:

{
    "adCompleted": true
}

IMPORTANT SECURITY NOTE
------------------------------------------------------------
This boolean is ONLY a temporary frontend signal.

It does NOT prove that AdsGram was actually watched.

The production version must replace this with a
server-verified AdsGram reward.

The client MUST NOT send:
- rollNumber
- reward
- coins
- balance
- payout
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


            /*
            ------------------------------------------------
            ONLY ACCEPT BOOLEAN TRUE
            ------------------------------------------------

            This prevents values such as:

            "true"
            1
            "1"

            from being accepted.

            However, this is NOT AdsGram verification.
            ------------------------------------------------
            */

            const adCompleted =
                req.body?.adCompleted === true;


            /*
            ------------------------------------------------
            Perform Lucky Roll
            ------------------------------------------------
            */

            const result =
                await luckyRoll(
                    userId,
                    adCompleted
                );


            /*
            ------------------------------------------------
            Advertisement required
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

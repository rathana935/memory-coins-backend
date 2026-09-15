import express from "express";

import {
    createAdRewardIntent,
    claimDailyBonus,
    luckyRoll,
    claimAdLife,
    claimDoubleGameReward,
    getRewardStatus
} from "../services/rewards.js";

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
UUID VALIDATOR
============================================================
*/

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


function isValidUUID(value) {

    return UUID_REGEX.test(
        String(value || "").trim()
    );

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

            const userId =
                getUserId(req);


            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error: "Authentication required."
                });

            }


            const adType =
                String(
                    req.body?.adType || ""
                )
                .trim()
                .toLowerCase();


            const allowedTypes = [
                "life",
                "double_reward",
                "lucky_roll"
            ];


            if (
                !allowedTypes.includes(adType)
            ) {

                return res.status(400).json({
                    success: false,
                    error: "INVALID_AD_TYPE"
                });

            }


            const metadata =
                req.body?.metadata &&
                typeof req.body.metadata === "object" &&
                !Array.isArray(req.body.metadata)
                    ? {
                        ...req.body.metadata
                    }
                    : {};


            /*
            ------------------------------------------------
            Double Reward requires a game session.
            ------------------------------------------------
            */

            if (
                adType === "double_reward"
            ) {

                const gameSessionId =
                    String(
                        metadata.gameSessionId ||
                        req.body?.gameSessionId ||
                        ""
                    )
                    .trim();


                if (!gameSessionId) {

                    return res.status(400).json({
                        success: false,
                        error:
                            "GAME_SESSION_ID_REQUIRED"
                    });

                }


                if (
                    !isValidUUID(
                        gameSessionId
                    )
                ) {

                    return res.status(400).json({
                        success: false,
                        error:
                            "INVALID_GAME_SESSION_ID"
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


            return res
                .status(201)
                .json(result);


        } catch (error) {

            console.error(
                "AdsGram intent route error:",
                error
            );


            switch (error.code || error.message) {

                case "USER_NOT_FOUND":

                    return res.status(404).json({
                        success: false,
                        error: "User not found."
                    });


                case "USER_BLOCKED":

                    return res.status(403).json({
                        success: false,
                        error: "USER_BLOCKED"
                    });


                case "GAME_SESSION_REQUIRED":

                    return res.status(400).json({
                        success: false,
                        error:
                            "GAME_SESSION_ID_REQUIRED"
                    });


                case "INVALID_GAME_SESSION":

                case "INVALID_GAME_SESSION_ID":

                    return res.status(400).json({
                        success: false,
                        error:
                            "INVALID_GAME_SESSION_ID"
                    });


                case "GAME_SESSION_NOT_FOUND":

                    return res.status(404).json({
                        success: false,
                        error:
                            "GAME_SESSION_NOT_FOUND"
                    });


                case "GAME_NOT_COMPLETED":

                    return res.status(409).json({
                        success: false,
                        error:
                            "GAME_SESSION_NOT_COMPLETED"
                    });


                default:

                    return res.status(500).json({
                        success: false,
                        error:
                            "Unable to create advertisement intent."
                    });

            }

        }

    }
);


/*
============================================================
POST /api/rewards/daily

Claim Daily Bonus.

Server controls:
- reward amount
- date
- streak
- balance
============================================================
*/

router.post(
    "/daily",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);


            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error: "Authentication required."
                });

            }


            const result =
                await claimDailyBonus(
                    userId
                );


            if (
                result.success === false &&
                result.error === "ALREADY_CLAIMED"
            ) {

                return res
                    .status(409)
                    .json(result);

            }


            return res
                .status(200)
                .json(result);


        } catch (error) {

            console.error(
                "Daily bonus route error:",
                error
            );


            switch (error.code || error.message) {

                case "USER_NOT_FOUND":

                    return res.status(404).json({
                        success: false,
                        error: "User not found."
                    });


                case "USER_BLOCKED":

                    return res.status(403).json({
                        success: false,
                        error: "USER_BLOCKED"
                    });


                case "DAILY_BONUS_DISABLED":

                    return res.status(503).json({
                        success: false,
                        error:
                            "Daily bonus is temporarily unavailable."
                    });


                default:

                    return res.status(500).json({
                        success: false,
                        error:
                            "Unable to claim daily bonus."
                    });

            }

        }

    }
);


/*
============================================================
POST /api/rewards/lucky-roll

Lucky Roll.

Client MUST NOT send:
- reward
- coins
- rollNumber
- payout
- adCompleted

Server:
1. Checks cooldown
2. Consumes verified AdsGram ad
3. Generates random number
4. Calculates reward
5. Updates balance
============================================================
*/

router.post(
    "/lucky-roll",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);


            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error: "Authentication required."
                });

            }


            const result =
                await luckyRoll(
                    userId
                );


            if (
                result.success === false &&
                result.error === "COOLDOWN"
            ) {

                return res
                    .status(429)
                    .json(result);

            }


            if (
                result.success === false &&
                (
                    result.error ===
                    "AD_REQUIRED" ||
                    result.error ===
                    "VERIFIED_AD_REQUIRED"
                )
            ) {

                return res
                    .status(403)
                    .json(result);

            }


            return res
                .status(200)
                .json(result);


        } catch (error) {

            console.error(
                "Lucky roll route error:",
                error
            );


            switch (error.code || error.message) {

                case "USER_NOT_FOUND":

                    return res.status(404).json({
                        success: false,
                        error: "User not found."
                    });


                case "USER_BLOCKED":

                    return res.status(403).json({
                        success: false,
                        error: "USER_BLOCKED"
                    });


                case "VERIFIED_AD_REQUIRED":

                case "AD_REQUIRED":

                    return res.status(403).json({
                        success: false,
                        error:
                            "VERIFIED_AD_REQUIRED"
                    });


                case "INVALID_LUCKY_REWARD":

                    return res.status(500).json({
                        success: false,
                        error:
                            "Lucky Roll configuration error."
                    });


                default:

                    return res.status(500).json({
                        success: false,
                        error:
                            "Unable to perform Lucky Roll."
                    });

            }

        }

    }
);


/*
============================================================
POST /api/rewards/life

Watch verified AdsGram rewarded ad → +1 Life.

The server verifies the ad before granting the life.
============================================================
*/

router.post(
    "/life",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);


            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error: "Authentication required."
                });

            }


            const result =
                await claimAdLife(
                    userId
                );


            if (
                result.success === false &&
                result.error === "MAX_LIVES"
            ) {

                return res
                    .status(409)
                    .json(result);

            }


            if (
                result.success === false &&
                (
                    result.error ===
                    "AD_REQUIRED" ||
                    result.error ===
                    "VERIFIED_AD_REQUIRED"
                )
            ) {

                return res
                    .status(403)
                    .json(result);

            }


            return res
                .status(200)
                .json(result);


        } catch (error) {

            console.error(
                "Ad life route error:",
                error
            );


            switch (error.code || error.message) {

                case "USER_NOT_FOUND":

                    return res.status(404).json({
                        success: false,
                        error: "User not found."
                    });


                case "USER_BLOCKED":

                    return res.status(403).json({
                        success: false,
                        error: "USER_BLOCKED"
                    });


                case "VERIFIED_AD_REQUIRED":

                case "AD_REQUIRED":

                    return res.status(403).json({
                        success: false,
                        error:
                            "VERIFIED_AD_REQUIRED"
                    });


                case "MAX_LIVES":

                    return res.status(409).json({
                        success: false,
                        error: "MAX_LIVES"
                    });


                default:

                    return res.status(500).json({
                        success: false,
                        error:
                            "Unable to claim life."
                    });

            }

        }

    }
);


/*
============================================================
POST /api/rewards/double-game-reward

Watch AdsGram → DOUBLE completed game reward.

REQUEST:

{
    "gameSessionId": "UUID"
}

IMPORTANT:
The server determines the actual reward from the
completed game session.

Example:

Easy:
    Base = 10
    Double = +10
    Total = 20

Medium:
    Base = 12
    Double = +12
    Total = 24

Hard:
    Base = 15
    Double = +15
    Total = 30

The client cannot choose the reward amount.
============================================================
*/

router.post(
    "/double-game-reward",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);


            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error: "Authentication required."
                });

            }


            const gameSessionId =
                String(
                    req.body?.gameSessionId || ""
                )
                .trim();


            if (!gameSessionId) {

                return res.status(400).json({
                    success: false,
                    error:
                        "GAME_SESSION_ID_REQUIRED"
                });

            }


            if (
                !isValidUUID(
                    gameSessionId
                )
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "INVALID_GAME_SESSION_ID"
                });

            }


            /*
            ------------------------------------------------
            IMPORTANT

            Do NOT directly call:

                consumeDoubleGameRewardAd()

            here.

            That only consumes the ad.

            We need:

                claimDoubleGameReward()

            because it:

            1. verifies the completed session
            2. verifies the AdsGram reward
            3. consumes the ad
            4. calculates the server-side reward
            5. adds the additional reward
            6. records coin transaction
            ------------------------------------------------
            */

            const result =
                await claimDoubleGameReward(
                    userId,
                    gameSessionId
                );


            return res
                .status(200)
                .json(result);


        } catch (error) {

            console.error(
                "Double reward route error:",
                error
            );


            switch (error.code || error.message) {

                case "USER_NOT_FOUND":

                    return res.status(404).json({
                        success: false,
                        error: "User not found."
                    });


                case "USER_BLOCKED":

                    return res.status(403).json({
                        success: false,
                        error: "USER_BLOCKED"
                    });


                case "GAME_SESSION_REQUIRED":

                    return res.status(400).json({
                        success: false,
                        error:
                            "GAME_SESSION_ID_REQUIRED"
                    });


                case "INVALID_GAME_SESSION":

                case "INVALID_GAME_SESSION_ID":

                    return res.status(400).json({
                        success: false,
                        error:
                            "INVALID_GAME_SESSION_ID"
                    });


                case "GAME_SESSION_NOT_FOUND":

                    return res.status(404).json({
                        success: false,
                        error:
                            "GAME_SESSION_NOT_FOUND"
                    });


                case "GAME_NOT_COMPLETED":

                    return res.status(409).json({
                        success: false,
                        error:
                            "GAME_SESSION_NOT_COMPLETED"
                    });


                case "VERIFIED_AD_REQUIRED":

                case "AD_REQUIRED":

                    return res.status(403).json({
                        success: false,
                        error:
                            "VERIFIED_AD_REQUIRED"
                    });


                case "AD_ALREADY_CONSUMED":

                    return res.status(409).json({
                        success: false,
                        error:
                            "DOUBLE_REWARD_ALREADY_USED"
                    });


                case "INVALID_GAME_REWARD":

                    return res.status(500).json({
                        success: false,
                        error:
                            "Invalid server game reward."
                    });


                default:

                    return res.status(500).json({
                        success: false,
                        error:
                            "Unable to apply double game reward."
                    });

            }

        }

    }
);


/*
============================================================
GET /api/rewards/status

Returns:
- balance
- today's coins
- lives
- daily bonus
- daily claim
- streak
- Lucky Roll status
- Lucky Roll cooldown
- next roll
- verified AdsGram rewards
============================================================
*/

router.get(
    "/status",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);


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


            return res
                .status(200)
                .json(result);


        } catch (error) {

            console.error(
                "Reward status route error:",
                error
            );


            switch (error.code || error.message) {

                case "USER_NOT_FOUND":

                    return res.status(404).json({
                        success: false,
                        error: "User not found."
                    });


                case "USER_BLOCKED":

                    return res.status(403).json({
                        success: false,
                        error: "USER_BLOCKED"
                    });


                default:

                    return res.status(500).json({
                        success: false,
                        error:
                            "Unable to load reward status."
                    });

            }

        }

    }
);


export default router;

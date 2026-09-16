import express from "express";

import {
    createAdRewardIntent,
    claimAdLife,
    claimDailyBonus,
    claimDoubleGameReward,
    getRewardStatus
} from "../services/rewards.js";

import { requireAuth } from "../middleware/auth.js";

const router = express.Router();


/* =========================================================
   AUTHENTICATION
========================================================= */

router.use(requireAuth);


/* =========================================================
   UUID VALIDATION
========================================================= */

function isValidUUID(value) {
    return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            value
        )
    );
}


/* =========================================================
   USER ID HELPER
========================================================= */

function getUserId(req) {
    return (
        req.user?.id ||
        req.user?.user_id ||
        null
    );
}


/* =========================================================
   ERROR HELPER
========================================================= */

function handleError(res, error) {

    console.error(
        "Rewards API error:",
        error
    );

    const statusMap = {

        USER_NOT_FOUND: 404,

        INVALID_USER_ID: 400,

        INVALID_AD_TYPE: 400,

        GAME_SESSION_REQUIRED: 400,

        GAME_SESSION_NOT_FOUND: 404,

        GAME_SESSION_FORBIDDEN: 403,

        INVALID_GAME_SESSION: 400,

        GAME_NOT_COMPLETED: 400,

        INVALID_GAME_REWARD: 400,

        ALREADY_CLAIMED: 409,

        AD_ALREADY_PENDING: 409,

        MAX_LIVES: 409,

        NO_PENDING_AD: 409,

        AD_ALREADY_PROCESSED: 409,

        NO_VERIFIED_AD: 409,

        AD_ALREADY_CONSUMED: 409,

        COIN_BALANCE_OVERFLOW: 409,

        USER_UPDATE_FAILED: 500,

        INVALID_GAME_ID: 400,

        INVALID_GAME_LEVEL: 400,

        INVALID_GAME_DIFFICULTY: 400,

        INVALID_STORED_AD_TYPE: 500

    };

    const status =
        statusMap[error.code] || 500;

    return res
        .status(status)
        .json({

            success: false,

            code:
                error.code ||
                "INTERNAL_ERROR",

            message:
                error.message ||
                "Something went wrong."

        });
}


/* =========================================================
   CREATE ADSGRAM AD INTENT
=========================================================

POST /api/rewards/ad-intent

Life:

{
    "adType": "life"
}

Double reward:

{
    "adType": "double_reward",
    "gameSessionId": "UUID"
}

The client NEVER supplies the reward amount.

========================================================= */

router.post(
    "/ad-intent",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);

            if (!userId) {

                return res
                    .status(401)
                    .json({
                        success: false,
                        code:
                            "AUTH_REQUIRED",
                        message:
                            "Authentication required."
                    });
            }


            const adType =
                typeof req.body?.adType ===
                "string"
                    ? req.body.adType.trim()
                    : "";


            const gameSessionId =
                typeof req.body?.gameSessionId ===
                "string"
                    ? req.body.gameSessionId.trim()
                    : null;


            /* -----------------------------------------
               VALIDATE AD TYPE
            ----------------------------------------- */

            if (
                adType !== "life" &&
                adType !== "double_reward"
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        code:
                            "INVALID_AD_TYPE",

                        message:
                            "Invalid ad type."

                    });
            }


            /* -----------------------------------------
               DOUBLE REWARD REQUIRES GAME SESSION
            ----------------------------------------- */

            if (
                adType ===
                "double_reward"
            ) {

                if (!gameSessionId) {

                    return res
                        .status(400)
                        .json({

                            success: false,

                            code:
                                "GAME_SESSION_REQUIRED",

                            message:
                                "Game session ID is required."

                        });
                }


                if (
                    !isValidUUID(
                        gameSessionId
                    )
                ) {

                    return res
                        .status(400)
                        .json({

                            success: false,

                            code:
                                "INVALID_GAME_SESSION",

                            message:
                                "Invalid game session ID."

                        });
                }
            }


            /* -----------------------------------------
               LIFE DOES NOT ACCEPT A GAME SESSION
            ----------------------------------------- */

            const normalizedGameSessionId =
                adType ===
                "double_reward"
                    ? gameSessionId
                    : null;


            /* -----------------------------------------
               CREATE SERVER-SIDE INTENT
            ----------------------------------------- */

            const result =
                await createAdRewardIntent({

                    userId,

                    adType,

                    gameSessionId:
                        normalizedGameSessionId

                });


            return res.json({

                success: true,

                intent: {

                    id:
                        result.id,

                    adType:
                        result.ad_type,

                    status:
                        result.status,

                    gameSessionId:
                        result.metadata
                            ?.gameSessionId ||
                        null,

                    blockId:
                        result.blockId ||
                        undefined

                }

            });

        } catch (error) {

            return handleError(
                res,
                error
            );
        }
    }
);


/* =========================================================
   CLAIM +1 LIFE
=========================================================

POST /api/rewards/life

The AdsGram Reward URL confirms the ad first.

This endpoint then consumes that confirmed reward.

========================================================= */

router.post(
    "/life",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);

            if (!userId) {

                return res
                    .status(401)
                    .json({

                        success: false,

                        code:
                            "AUTH_REQUIRED",

                        message:
                            "Authentication required."

                    });
            }


            const result =
                await claimAdLife(
                    userId
                );


            return res.json(
                result
            );

        } catch (error) {

            return handleError(
                res,
                error
            );
        }
    }
);


/* =========================================================
   DAILY BONUS
=========================================================

POST /api/rewards/daily

========================================================= */

router.post(
    "/daily",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);

            if (!userId) {

                return res
                    .status(401)
                    .json({

                        success: false,

                        code:
                            "AUTH_REQUIRED",

                        message:
                            "Authentication required."

                    });
            }


            const result =
                await claimDailyBonus(
                    userId
                );


            return res.json(
                result
            );

        } catch (error) {

            return handleError(
                res,
                error
            );
        }
    }
);


/* =========================================================
   DOUBLE GAME REWARD
=========================================================

POST /api/rewards/double-game-reward

Body:

{
    "gameSessionId": "UUID"
}

The server verifies:

1. Game belongs to the authenticated user.
2. Game is completed.
3. AdsGram reward is confirmed.
4. Reward belongs to this exact game.
5. Reward has not already been consumed.
6. Original server-side game reward is used.

========================================================= */

router.post(
    "/double-game-reward",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);

            if (!userId) {

                return res
                    .status(401)
                    .json({

                        success: false,

                        code:
                            "AUTH_REQUIRED",

                        message:
                            "Authentication required."

                    });
            }


            const gameSessionId =
                typeof req.body?.gameSessionId ===
                "string"
                    ? req.body.gameSessionId.trim()
                    : "";


            if (!gameSessionId) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        code:
                            "GAME_SESSION_REQUIRED",

                        message:
                            "Game session ID is required."

                    });
            }


            if (
                !isValidUUID(
                    gameSessionId
                )
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        code:
                            "INVALID_GAME_SESSION",

                        message:
                            "Invalid game session ID."

                    });
            }


            const result =
                await claimDoubleGameReward(
                    userId,
                    gameSessionId
                );


            return res.json(
                result
            );

        } catch (error) {

            return handleError(
                res,
                error
            );
        }
    }
);


/* =========================================================
   REWARD STATUS
=========================================================

GET /api/rewards/status

========================================================= */

router.get(
    "/status",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);

            if (!userId) {

                return res
                    .status(401)
                    .json({

                        success: false,

                        code:
                            "AUTH_REQUIRED",

                        message:
                            "Authentication required."

                    });
            }


            const result =
                await getRewardStatus(
                    userId
                );


            return res.json({

                success: true,

                ...result

            });

        } catch (error) {

            return handleError(
                res,
                error
            );
        }
    }
);


/* =========================================================
   EXPORT
========================================================= */

export default router;

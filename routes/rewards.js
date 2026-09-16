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

router.use(
    requireAuth
);


/* =========================================================
   ERROR HELPER
========================================================= */

function handleError(
    res,
    error
) {

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

        GAME_NOT_COMPLETED: 400,

        INVALID_GAME_SESSION: 400,

        INVALID_GAME_REWARD: 400,

        ALREADY_CLAIMED: 409,

        MAX_LIVES: 409,

        NO_PENDING_AD: 409,

        AD_ALREADY_PROCESSED: 409,

        NO_VERIFIED_AD: 409,

        AD_ALREADY_CONSUMED: 409

    };


    const status =
        statusMap[
            error.code
        ] || 500;


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

========================================================= */

router.post(
    "/ad-intent",
    async (req, res) => {

        try {

            const {
                adType,
                gameSessionId
            } = req.body;


            const result =
                await createAdRewardIntent({

                    userId:
                        req.user.user_id,

                    adType,

                    gameSessionId:
                        gameSessionId ||
                        null

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
                        null

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

This endpoint consumes a confirmed AdsGram life
reward and gives exactly +1 life.

========================================================= */

router.post(
    "/life",
    async (req, res) => {

        try {

            const result =
                await claimAdLife(
                    req.user.user_id
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
========================================================= */

router.post(
    "/daily",
    async (req, res) => {

        try {

            const result =
                await claimDailyBonus(
                    req.user.user_id
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

========================================================= */

router.post(
    "/double-game-reward",
    async (req, res) => {

        try {

            const {
                gameSessionId
            } = req.body;


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


            const result =
                await claimDoubleGameReward(

                    req.user.user_id,

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
========================================================= */

router.get(
    "/status",
    async (req, res) => {

        try {

            const result =
                await getRewardStatus(
                    req.user.user_id
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

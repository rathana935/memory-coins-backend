import express from "express";

import {
    createAdRewardIntent,
    claimAdLife,
    claimDailyBonus,
    luckyRoll,
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

        ALREADY_CLAIMED: 409,

        MAX_LIVES: 409,

        NO_PENDING_AD: 409,

        AD_ALREADY_PROCESSED: 409,

        NO_VERIFIED_AD: 409,

        AD_ALREADY_CONSUMED: 409,

        LUCKY_ROLL_COOLDOWN: 429,

        INVALID_GAME_REWARD: 400

    };


    const status =
        statusMap[error.code] || 500;


    const response = {
        success: false,
        code:
            error.code ||
            "INTERNAL_ERROR",
        message:
            error.message ||
            "Something went wrong."
    };


    if (
        error.code ===
        "LUCKY_ROLL_COOLDOWN"
    ) {

        response.remainingSeconds =
            Number(
                error.remainingSeconds || 0
            );

    }


    return res
        .status(status)
        .json(response);

}


/* =========================================================
   CREATE ADSGRAM AD INTENT
=========================================================

POST /api/rewards/ad-intent

Body:

{
    "adType": "life"
}

or:

{
    "adType": "double_reward",
    "gameSessionId": "UUID"
}

or:

{
    "adType": "lucky_roll"
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

The ad must already be verified by the
AdsGram Reward URL.

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
=========================================================

POST /api/rewards/daily

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
   LUCKY ROLL
=========================================================

POST /api/rewards/lucky-roll

The user must have a verified AdsGram
lucky_roll reward.

========================================================= */

router.post(
    "/lucky-roll",
    async (req, res) => {

        try {

            const result =
                await luckyRoll(
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

The server verifies:

1. User owns game session
2. Game is completed
3. Game reward is valid
4. AdsGram reward is verified
5. Verified ad belongs to this game
6. Ad has not already been consumed

========================================================= */

router.post(
    "/double-game-reward",
    async (req, res) => {

        try {

            const {
                gameSessionId
            } = req.body;


            if (!gameSessionId) {

                return res.status(400).json({

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
=========================================================

GET /api/rewards/status

Returns:

- coins
- lives
- max lives
- daily bonus status
- verified AdsGram rewards

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


export default router;

import express from "express";

import {
claimDailyBonus,
luckyRoll,
getRewardStatus
} from "../services/rewards.js";

const router =
express.Router();

/*

POST /api/rewards/daily

Claim the daily bonus.

No reward amount is accepted from the browser.

The service calculates the reward from
the server/database configuration.

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

                error:
                    "Authentication required."

            });

        }


        const result =
            await claimDailyBonus(
                userId
            );


        /*
        ------------------------------------------------
        Already claimed
        ------------------------------------------------
        */

        if (
            result.success === false &&
            result.error ===
                "ALREADY_CLAIMED"
        ) {

            return res.status(409).json(
                result
            );

        }


        return res.json(
            result
        );


    } catch (error) {

        console.error(
            "Daily bonus route error:",
            error
        );


        return res.status(500).json({

            success: false,

            error:
                error.message ||
                "Unable to claim daily bonus."

        });

    }

}

);

/*

POST /api/rewards/lucky-roll

Lucky Roll requires:

{
"adCompleted": true
}

IMPORTANT:

The client is NOT allowed to send:

- rollNumber
- reward
- coins

The server generates the roll number and
calculates the reward.

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

                error:
                    "Authentication required."

            });

        }


        /*
        ------------------------------------------------
        Read ad status
        ------------------------------------------------

        This is only the frontend signal for now.

        Production AdsGram verification will be
        added separately so the server can verify
        an actual rewarded-ad completion.
        ------------------------------------------------
        */

        const adCompleted =
            req.body?.adCompleted === true;


        const result =
            await luckyRoll(
                userId,
                adCompleted
            );


        /*
        ------------------------------------------------
        Ad required
        ------------------------------------------------
        */

        if (
            result.success === false &&
            result.error ===
                "AD_REQUIRED"
        ) {

            return res.status(403).json(
                result
            );

        }


        /*
        ------------------------------------------------
        Cooldown
        ------------------------------------------------
        */

        if (
            result.success === false &&
            result.error ===
                "COOLDOWN"
        ) {

            return res.status(429).json(
                result
            );

        }


        return res.json(
            result
        );


    } catch (error) {

        console.error(
            "Lucky roll route error:",
            error
        );


        return res.status(500).json({

            success: false,

            error:
                error.message ||
                "Unable to perform Lucky Roll."

        });

    }

}

);

/*

GET /api/rewards/status

Returns:

- current balance
- today's coins
- daily bonus status
- daily streak
- Lucky Roll availability
- Lucky Roll cooldown
- next Lucky Roll time

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

                error:
                    "Authentication required."

            });

        }


        const result =
            await getRewardStatus(
                userId
            );


        return res.json(
            result
        );


    } catch (error) {

        console.error(
            "Reward status route error:",
            error
        );


        return res.status(500).json({

            success: false,

            error:
                error.message ||
                "Unable to load reward status."

        });

    }

}

);

export default router;

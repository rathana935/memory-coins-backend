import express from "express";

import pool from "../db/pool.js";


const router = express.Router();


/* =========================================================
   CONFIG
========================================================= */

const DEFAULT_REFERRAL_REWARD = 250;

const TELEGRAM_BOT_USERNAME =
    String(
        process.env.TELEGRAM_BOT_USERNAME || ""
    )
        .trim()
        .replace(/^@/, "");


/* =========================================================
   USER ID HELPER
========================================================= */

function getUserId(req) {

    return (
        req.user?.user_id ||
        req.user?.id ||
        null
    );

}


/* =========================================================
   TELEGRAM ID HELPER
========================================================= */

function getTelegramId(req) {

    return (
        req.user?.telegram_id ||
        req.user?.telegramId ||
        null
    );

}


/* =========================================================
   GET REFERRAL REWARD CONFIG
========================================================= */

async function getReferralReward() {

    try {

        const result =
            await pool.query(
                `
                SELECT value

                FROM app_settings

                WHERE key = 'referral'

                LIMIT 1
                `
            );


        if (
            result.rows.length > 0 &&
            result.rows[0].value
        ) {

            const settings =
                result.rows[0].value;


            const reward =
                Number(
                    settings.reward_coins
                );


            if (
                Number.isInteger(reward) &&
                reward > 0
            ) {

                return reward;

            }

        }

    } catch (error) {

        console.error(
            "Referral settings error:",
            error
        );

    }


    return DEFAULT_REFERRAL_REWARD;

}


/* =========================================================
   BUILD TELEGRAM REFERRAL LINK
========================================================= */

function buildReferralLink(telegramId) {

    if (
        !TELEGRAM_BOT_USERNAME ||
        !telegramId
    ) {

        return null;

    }


    return (
        `https://t.me/${TELEGRAM_BOT_USERNAME}` +
        `?startapp=ref_${telegramId}`
    );

}


/* =========================================================
   GET REFERRAL INFORMATION

   GET /api/referrals
========================================================= */

router.get(
    "/",

    async (req, res) => {

        try {

            /* =================================================
               USER
            ================================================= */

            const userId =
                getUserId(req);


            const telegramId =
                getTelegramId(req);


            if (!userId) {

                return res.status(401).json({

                    success: false,

                    error:
                        "Authenticated user ID is missing."

                });

            }


            if (!telegramId) {

                return res.status(401).json({

                    success: false,

                    error:
                        "Telegram user ID is missing."

                });

            }


            /* =================================================
               REFERRAL REWARD
            ================================================= */

            const referralReward =
                await getReferralReward();


            /* =================================================
               REFERRAL STATISTICS
            ================================================= */

            const statsResult =
                await pool.query(
                    `
                    SELECT

                        COUNT(*)::INTEGER
                            AS referral_count,

                        COALESCE(
                            SUM(reward_coins),
                            0
                        )::BIGINT
                            AS reward_coins

                    FROM referrals

                    WHERE
                        referrer_user_id = $1

                        AND status = 'completed'
                    `,
                    [
                        userId
                    ]
                );


            const stats =
                statsResult.rows[0];


            /* =================================================
               REFERRAL LINK
            ================================================= */

            const referralLink =
                buildReferralLink(
                    telegramId
                );


            /* =================================================
               REFERRAL HISTORY
            ================================================= */

            const referralsResult =
                await pool.query(
                    `
                    SELECT

                        r.id,

                        r.reward_coins,

                        r.status,

                        r.created_at,

                        r.completed_at,

                        u.telegram_id,

                        u.username,

                        u.first_name

                    FROM referrals r

                    INNER JOIN users u

                        ON u.id =
                           r.referred_user_id

                    WHERE
                        r.referrer_user_id = $1

                    ORDER BY
                        r.created_at DESC

                    LIMIT 100
                    `,
                    [
                        userId
                    ]
                );


            /* =================================================
               RESPONSE
            ================================================= */

            return res.json({

                success: true,

                referral: {

                    link:
                        referralLink,

                    rewardPerInvite:
                        referralReward,

                    reward_per_invite:
                        referralReward,

                    count:
                        Number(
                            stats.referral_count
                        ),

                    totalEarned:
                        Number(
                            stats.reward_coins
                        ),

                    total_earned:
                        Number(
                            stats.reward_coins
                        )

                },

                referrals:
                    referralsResult.rows.map(
                        referral => ({

                            id:
                                referral.id,

                            username:
                                referral.username,

                            firstName:
                                referral.first_name,

                            first_name:
                                referral.first_name,

                            rewardCoins:
                                Number(
                                    referral.reward_coins
                                ),

                            reward_coins:
                                Number(
                                    referral.reward_coins
                                ),

                            status:
                                referral.status,

                            createdAt:
                                referral.created_at,

                            created_at:
                                referral.created_at,

                            completedAt:
                                referral.completed_at,

                            completed_at:
                                referral.completed_at

                        })
                    )

            });

        } catch (error) {

            console.error(
                "Get referral information error:",
                error
            );


            return res.status(500).json({

                success: false,

                error:
                    "Failed to load referral information."

            });

        }

    }
);


/* =========================================================
   GET REFERRAL STATISTICS ONLY

   GET /api/referrals/stats
========================================================= */

router.get(
    "/stats",

    async (req, res) => {

        try {

            const userId =
                getUserId(req);


            if (!userId) {

                return res.status(401).json({

                    success: false,

                    error:
                        "Authenticated user ID is missing."

                });

            }


            const referralReward =
                await getReferralReward();


            const result =
                await pool.query(
                    `
                    SELECT

                        COUNT(*)::INTEGER
                            AS referral_count,

                        COALESCE(
                            SUM(reward_coins),
                            0
                        )::BIGINT
                            AS reward_coins

                    FROM referrals

                    WHERE
                        referrer_user_id = $1

                        AND status = 'completed'
                    `,
                    [
                        userId
                    ]
                );


            const row =
                result.rows[0];


            const count =
                Number(
                    row.referral_count
                );


            const totalEarned =
                Number(
                    row.reward_coins
                );


            return res.json({

                success: true,

                count,

                totalEarned,

                rewardPerInvite:
                    referralReward,


                /* Compatibility */

                referral_count:
                    count,

                total_earned:
                    totalEarned,

                reward_per_invite:
                    referralReward

            });

        } catch (error) {

            console.error(
                "Get referral stats error:",
                error
            );


            return res.status(500).json({

                success: false,

                error:
                    "Failed to load referral statistics."

            });

        }

    }
);


export default router;

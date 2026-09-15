import express from "express";

import pool from "../db/pool.js";

import {
    requireAuth
} from "../middleware/auth.js";

const router = express.Router();


/* =========================================================
   CONFIG
========================================================= */

const REFERRAL_REWARD = 250;


/*
Change this to your actual Telegram bot username.

Example:

const TELEGRAM_BOT_USERNAME = "MemoryCoinsBot";

Do NOT include @.
*/

const TELEGRAM_BOT_USERNAME =
    process.env.TELEGRAM_BOT_USERNAME ||
    "YOUR_BOT_USERNAME";


/* =========================================================
   GET REFERRAL INFORMATION

   GET /api/referrals
========================================================= */

router.get(
    "/",
    requireAuth,
    async (req, res) => {

        try {

            const userId =
                req.user.user_id;


            /* ---------------------------------------------
               Get referral statistics
            --------------------------------------------- */

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

                    WHERE referrer_user_id = $1

                      AND status = 'completed'
                    `,
                    [
                        userId
                    ]
                );


            const stats =
                statsResult.rows[0];


            /* ---------------------------------------------
               Build Telegram referral link
            --------------------------------------------- */

            const telegramId =
                String(
                    req.user.telegram_id
                );


            const referralLink =
                `https://t.me/${TELEGRAM_BOT_USERNAME}?startapp=ref_${telegramId}`;


            /* ---------------------------------------------
               Get referral history
            --------------------------------------------- */

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


            return res.json({

                success: true,

                referral: {

                    link:
                        referralLink,

                    rewardPerInvite:
                        REFERRAL_REWARD,

                    count:
                        Number(
                            stats.referral_count
                        ),

                    totalEarned:
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

                            rewardCoins:
                                Number(
                                    referral.reward_coins
                                ),

                            status:
                                referral.status,

                            createdAt:
                                referral.created_at,

                            completedAt:
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
    requireAuth,
    async (req, res) => {

        try {

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

                    WHERE referrer_user_id = $1

                      AND status = 'completed'
                    `,
                    [
                        req.user.user_id
                    ]
                );


            const row =
                result.rows[0];


            return res.json({

                success: true,

                count:
                    Number(
                        row.referral_count
                    ),

                totalEarned:
                    Number(
                        row.reward_coins
                    ),

                rewardPerInvite:
                    REFERRAL_REWARD

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

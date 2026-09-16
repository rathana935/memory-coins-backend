import crypto from "crypto";
import pool from "../db/pool.js";


/* =========================================================
   CONFIG
========================================================= */

const ADSGRAM_BLOCK_ID =
    String(
        process.env.ADSGRAM_BLOCK_ID || "48045"
    );

const ADSGRAM_PENDING_MAX_SECONDS =
    15 * 60;

const MAX_LIVES = 5;

const LIFE_REWARD = 1;

const AD_TYPES = [
    "life",
    "double_reward"
];


/* =========================================================
   HELPERS
========================================================= */

function createError(
    message,
    code
) {
    const error = new Error(message);
    error.code = code;
    return error;
}


async function getUserById(
    client,
    userId
) {

    const result =
        await client.query(
            `
            SELECT *
            FROM users
            WHERE id = $1
            FOR UPDATE
            `,
            [userId]
        );


    if (!result.rows[0]) {

        throw createError(
            "User not found.",
            "USER_NOT_FOUND"
        );

    }


    return result.rows[0];
}


async function getUserByTelegramId(
    client,
    telegramId
) {

    const result =
        await client.query(
            `
            SELECT *
            FROM users
            WHERE telegram_id = $1
            FOR UPDATE
            `,
            [telegramId]
        );


    if (!result.rows[0]) {

        throw createError(
            "User not found.",
            "USER_NOT_FOUND"
        );

    }


    return result.rows[0];
}


/* =========================================================
   CREATE ADSGRAM AD INTENT
=========================================================

POST /api/rewards/ad-intent

Allowed:

{
    "adType": "life"
}

OR:

{
    "adType": "double_reward",
    "gameSessionId": "UUID"
}

The client cannot specify the reward amount.
========================================================= */

export async function createAdRewardIntent({
    userId,
    adType,
    gameSessionId = null
}) {

    if (!userId) {

        throw createError(
            "User ID is required.",
            "INVALID_USER_ID"
        );

    }


    if (!AD_TYPES.includes(adType)) {

        throw createError(
            "Invalid ad type.",
            "INVALID_AD_TYPE"
        );

    }


    if (
        adType === "double_reward" &&
        !gameSessionId
    ) {

        throw createError(
            "Game session ID is required.",
            "GAME_SESSION_REQUIRED"
        );

    }


    const client =
        await pool.connect();


    try {

        await client.query("BEGIN");


        const user =
            await getUserById(
                client,
                userId
            );


        if (
            adType === "double_reward"
        ) {

            const game =
                await client.query(
                    `
                    SELECT *
                    FROM game_sessions
                    WHERE id = $1
                      AND user_id = $2
                    FOR UPDATE
                    `,
                    [
                        gameSessionId,
                        userId
                    ]
                );


            if (!game.rows[0]) {

                throw createError(
                    "Game session not found.",
                    "GAME_SESSION_NOT_FOUND"
                );

            }


            if (
                game.rows[0].status !== "completed"
            ) {

                throw createError(
                    "Game must be completed first.",
                    "GAME_NOT_COMPLETED"
                );

            }


            /*
             * Only one pending/confirmed double reward
             * may exist for a game session.
             */

            const existing =
                await client.query(
                    `
                    SELECT id
                    FROM ad_rewards
                    WHERE user_id = $1
                      AND provider = 'adsgram'
                      AND ad_type = 'double_reward'
                      AND metadata->>'gameSessionId' = $2
                      AND status IN (
                          'pending',
                          'confirmed'
                      )
                    LIMIT 1
                    `,
                    [
                        userId,
                        gameSessionId
                    ]
                );


            if (existing.rows[0]) {

                throw createError(
                    "Double reward was already created or claimed.",
                    "ALREADY_CLAIMED"
                );

            }

        }


        /*
         * For a life ad, do not create another intent
         * while the user already has a pending life ad.
         */

        if (
            adType === "life"
        ) {

            const existing =
                await client.query(
                    `
                    SELECT id
                    FROM ad_rewards
                    WHERE user_id = $1
                      AND provider = 'adsgram'
                      AND ad_type = 'life'
                      AND status = 'pending'
                      AND created_at >=
                          NOW() -
                          ($2 * INTERVAL '1 second')
                    LIMIT 1
                    `,
                    [
                        userId,
                        ADSGRAM_PENDING_MAX_SECONDS
                    ]
                );


            if (existing.rows[0]) {

                throw createError(
                    "A life ad is already pending.",
                    "ALREADY_CLAIMED"
                );

            }

        }


        const metadata = {

            gameSessionId:
                gameSessionId || null

        };


        /*
         * reward_coins is zero for the life reward.
         * Double reward uses the game reward later.
         */

        const inserted =
            await client.query(
                `
                INSERT INTO ad_rewards
                (
                    user_id,
                    provider,
                    ad_type,
                    reward_coins,
                    status,
                    metadata
                )
                VALUES
                (
                    $1,
                    'adsgram',
                    $2,
                    0,
                    'pending',
                    $3::jsonb
                )
                RETURNING *
                `,
                [
                    user.id,
                    adType,
                    JSON.stringify(metadata)
                ]
            );


        await client.query("COMMIT");


        return inserted.rows[0];

    } catch (error) {

        await client.query("ROLLBACK");

        throw error;

    } finally {

        client.release();

    }
}


/* =========================================================
   CLAIM +1 LIFE
=========================================================

This consumes a confirmed AdsGram "life" reward.

The client cannot tell the server how many lives to add.
The server always adds exactly ONE.

Maximum = 5.
========================================================= */

export async function claimAdLife(
    userId
) {

    if (!userId) {

        throw createError(
            "User ID is required.",
            "INVALID_USER_ID"
        );

    }


    const client =
        await pool.connect();


    try {

        await client.query("BEGIN");


        const user =
            await getUserById(
                client,
                userId
            );


        if (user.lives >= MAX_LIVES) {

            throw createError(
                "Lives are already full.",
                "MAX_LIVES"
            );

        }


        /*
         * Find the newest confirmed life reward that
         * has not yet been consumed.
         */

        const rewardResult =
            await client.query(
                `
                SELECT *
                FROM ad_rewards
                WHERE user_id = $1
                  AND provider = 'adsgram'
                  AND ad_type = 'life'
                  AND status = 'confirmed'
                  AND consumed_at IS NULL
                ORDER BY confirmed_at DESC
                LIMIT 1
                FOR UPDATE
                `,
                [userId]
            );


        if (!rewardResult.rows[0]) {

            throw createError(
                "No verified AdsGram life reward.",
                "NO_VERIFIED_AD"
            );

        }


        const reward =
            rewardResult.rows[0];


        /*
         * Add exactly ONE life.
         */

        const updatedUser =
            await client.query(
                `
                UPDATE users
                SET
                    lives = LEAST(lives + 1, $2),
                    updated_at = NOW()
                WHERE id = $1
                RETURNING *
                `,
                [
                    userId,
                    MAX_LIVES
                ]
            );


        /*
         * Mark the reward consumed.
         */

        await client.query(
            `
            UPDATE ad_rewards
            SET
                consumed_at = NOW()
            WHERE id = $1
              AND consumed_at IS NULL
            `,
            [reward.id]
        );


        await client.query("COMMIT");


        return {

            success: true,

            reward: "life",

            addedLives: 1,

            lives:
                updatedUser.rows[0].lives,

            maxLives:
                MAX_LIVES

        };

    } catch (error) {

        await client.query("ROLLBACK");

        throw error;

    } finally {

        client.release();

    }
}


/* =========================================================
   ADSGRAM CALLBACK
=========================================================

AdsGram calls:

GET /api/adsgram/reward?userid=[userId]

The callback confirms the newest pending intent.

For "life", the actual +1 life is then immediately
applied server-side.

For "double_reward", confirmation is kept until the
game reward endpoint consumes it.
========================================================= */

export async function confirmAdsgramReward({
    telegramId
}) {

    if (!telegramId) {

        throw createError(
            "Missing Telegram user ID.",
            "USER_NOT_FOUND"
        );

    }


    const client =
        await pool.connect();


    try {

        await client.query("BEGIN");


        const user =
            await getUserByTelegramId(
                client,
                telegramId
            );


        const pending =
            await client.query(
                `
                SELECT *
                FROM ad_rewards
                WHERE user_id = $1
                  AND provider = 'adsgram'
                  AND status = 'pending'
                  AND created_at >=
                      NOW() -
                      ($2 * INTERVAL '1 second')
                ORDER BY created_at DESC
                LIMIT 1
                FOR UPDATE
                `,
                [
                    user.id,
                    ADSGRAM_PENDING_MAX_SECONDS
                ]
            );


        if (!pending.rows[0]) {

            throw createError(
                "No pending ad reward.",
                "NO_PENDING_AD"
            );

        }


        const reward =
            pending.rows[0];


        const adType =
            reward.ad_type;


        if (
            !AD_TYPES.includes(adType)
        ) {

            throw createError(
                "Invalid stored ad type.",
                "INVALID_AD_TYPE"
            );

        }


        const externalRewardId =
            `adsgram:${ADSGRAM_BLOCK_ID}:${reward.id}`;


        /*
         * Confirm exactly once.
         */

        const updated =
            await client.query(
                `
                UPDATE ad_rewards
                SET
                    status = 'confirmed',
                    external_reward_id = $2,
                    confirmed_at = NOW()
                WHERE id = $1
                  AND status = 'pending'
                RETURNING *
                `,
                [
                    reward.id,
                    externalRewardId
                ]
            );


        if (!updated.rows[0]) {

            throw createError(
                "Ad reward was already processed.",
                "AD_ALREADY_PROCESSED"
            );

        }


        /*
         * LIFE REWARD
         *
         * AdsGram callback itself grants the life.
         * No second client claim is required.
         */

        if (
            adType === "life"
        ) {

            if (user.lives >= MAX_LIVES) {

                /*
                 * Keep the confirmed reward available.
                 * The user can consume it later if they
                 * have room for a life.
                 */

                await client.query("COMMIT");

                return {

                    success: true,

                    reward: updated.rows[0],

                    rewardType: "life",

                    addedLives: 0,

                    lives: user.lives,

                    maxLives: MAX_LIVES,

                    message:
                        "Ad confirmed. Lives are already full."

                };

            }


            const updatedUser =
                await client.query(
                    `
                    UPDATE users
                    SET
                        lives = LEAST(lives + 1, $2),
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING lives
                    `,
                    [
                        user.id,
                        MAX_LIVES
                    ]
                );


            await client.query(
                `
                UPDATE ad_rewards
                SET
                    consumed_at = NOW()
                WHERE id = $1
                  AND consumed_at IS NULL
                `,
                [reward.id]
            );


            await client.query("COMMIT");


            return {

                success: true,

                reward: updated.rows[0],

                rewardType: "life",

                addedLives: 1,

                lives:
                    updatedUser.rows[0].lives,

                maxLives:
                    MAX_LIVES

            };

        }


        /*
         * DOUBLE REWARD
         *
         * Confirmation is enough here.
         * The game reward endpoint will consume it.
         */

        await client.query("COMMIT");


        return {

            success: true,

            reward: updated.rows[0],

            rewardType: adType

        };

    } catch (error) {

        await client.query("ROLLBACK");

        throw error;

    } finally {

        client.release();

    }
}


/* =========================================================
   DAILY BONUS
========================================================= */

export async function claimDailyBonus(
    userId
) {

    const client =
        await pool.connect();


    try {

        await client.query("BEGIN");


        const user =
            await getUserById(
                client,
                userId
            );


        const today =
            new Date()
                .toISOString()
                .slice(0, 10);


        if (
            user.last_daily_claim &&
            String(user.last_daily_claim)
                .slice(0, 10) === today
        ) {

            throw createError(
                "Daily bonus already claimed.",
                "ALREADY_CLAIMED"
            );

        }


        const rewardCoins = 100;


        const claim =
            await client.query(
                `
                INSERT INTO daily_bonus_claims
                (
                    user_id,
                    claim_date,
                    day_number,
                    reward_coins
                )
                VALUES
                (
                    $1,
                    $2,
                    1,
                    $3
                )
                ON CONFLICT
                (
                    user_id,
                    claim_date
                )
                DO NOTHING
                RETURNING *
                `,
                [
                    userId,
                    today,
                    rewardCoins
                ]
            );


        if (!claim.rows[0]) {

            throw createError(
                "Daily bonus already claimed.",
                "ALREADY_CLAIMED"
            );

        }


        const before =
            Number(user.coins);


        const after =
            before + rewardCoins;


        await client.query(
            `
            UPDATE users
            SET
                coins = $2,
                today_coins = today_coins + $3,
                last_daily_claim = $4,
                updated_at = NOW()
            WHERE id = $1
            `,
            [
                userId,
                after,
                rewardCoins,
                today
            ]
        );


        await client.query(
            `
            INSERT INTO coin_transactions
            (
                user_id,
                type,
                amount,
                balance_before,
                balance_after,
                reference_id,
                description
            )
            VALUES
            (
                $1,
                'daily_bonus',
                $2,
                $3,
                $4,
                $5,
                'Daily bonus'
            )
            `,
            [
                userId,
                rewardCoins,
                before,
                after,
                claim.rows[0].id
            ]
        );


        await client.query("COMMIT");


        return {

            success: true,

            rewardCoins,

            coins: after

        };

    } catch (error) {

        await client.query("ROLLBACK");

        throw error;

    } finally {

        client.release();

    }
}


/* =========================================================
   DOUBLE GAME REWARD
========================================================= */

export async function claimDoubleGameReward(
    userId,
    gameSessionId
) {

    if (!gameSessionId) {

        throw createError(
            "Game session ID is required.",
            "GAME_SESSION_REQUIRED"
        );

    }


    const client =
        await pool.connect();


    try {

        await client.query("BEGIN");


        const user =
            await getUserById(
                client,
                userId
            );


        const gameResult =
            await client.query(
                `
                SELECT *
                FROM game_sessions
                WHERE id = $1
                  AND user_id = $2
                FOR UPDATE
                `,
                [
                    gameSessionId,
                    userId
                ]
            );


        if (!gameResult.rows[0]) {

            throw createError(
                "Game session not found.",
                "GAME_SESSION_NOT_FOUND"
            );

        }


        const game =
            gameResult.rows[0];


        if (
            game.status !== "completed"
        ) {

            throw createError(
                "Game is not completed.",
                "GAME_NOT_COMPLETED"
            );

        }


        /*
         * Find the confirmed double-reward ad
         * for this exact game.
         */

        const rewardResult =
            await client.query(
                `
                SELECT *
                FROM ad_rewards
                WHERE user_id = $1
                  AND provider = 'adsgram'
                  AND ad_type = 'double_reward'
                  AND status = 'confirmed'
                  AND consumed_at IS NULL
                  AND metadata->>'gameSessionId' = $2
                ORDER BY confirmed_at DESC
                LIMIT 1
                FOR UPDATE
                `,
                [
                    userId,
                    gameSessionId
                ]
            );


        if (!rewardResult.rows[0]) {

            throw createError(
                "No verified double-reward ad.",
                "NO_VERIFIED_AD"
            );

        }


        const adReward =
            rewardResult.rows[0];


        /*
         * Make sure this game has not already been
         * doubled.
         */

        const previous =
            await client.query(
                `
                SELECT id
                FROM coin_transactions
                WHERE user_id = $1
                  AND type = 'double_game_reward'
                  AND reference_id = $2
                LIMIT 1
                `,
                [
                    userId,
                    gameSessionId
                ]
            );


        if (previous.rows[0]) {

            throw createError(
                "Double reward was already claimed.",
                "ALREADY_CLAIMED"
            );

        }


        const baseReward =
            Number(game.reward_coins);


        if (
            !Number.isFinite(baseReward) ||
            baseReward < 0
        ) {

            throw createError(
                "Invalid game reward.",
                "INVALID_GAME_REWARD"
            );

        }


        const before =
            Number(user.coins);


        const doubleReward =
            baseReward;


        const after =
            before + doubleReward;


        await client.query(
            `
            UPDATE users
            SET
                coins = $2,
                today_coins = today_coins + $3,
                updated_at = NOW()
            WHERE id = $1
            `,
            [
                userId,
                after,
                doubleReward
            ]
        );


        await client.query(
            `
            INSERT INTO coin_transactions
            (
                user_id,
                type,
                amount,
                balance_before,
                balance_after,
                reference_id,
                description
            )
            VALUES
            (
                $1,
                'double_game_reward',
                $2,
                $3,
                $4,
                $5,
                'AdsGram double game reward'
            )
            `,
            [
                userId,
                doubleReward,
                before,
                after,
                gameSessionId
            ]
        );


        await client.query(
            `
            UPDATE ad_rewards
            SET
                consumed_at = NOW()
            WHERE id = $1
              AND consumed_at IS NULL
            `,
            [adReward.id]
        );


        await client.query("COMMIT");


        return {

            success: true,

            gameSessionId,

            baseReward,

            bonusReward:
                doubleReward,

            totalFromAd:
                doubleReward,

            coins: after

        };

    } catch (error) {

        await client.query("ROLLBACK");

        throw error;

    } finally {

        client.release();

    }
}


/* =========================================================
   REWARD STATUS
========================================================= */

export async function getRewardStatus(
    userId
) {

    const client =
        await pool.connect();


    try {

        const user =
            await getUserById(
                client,
                userId
            );


        const pending =
            await client.query(
                `
                SELECT
                    id,
                    ad_type,
                    status,
                    metadata,
                    created_at,
                    confirmed_at,
                    consumed_at
                FROM ad_rewards
                WHERE user_id = $1
                  AND provider = 'adsgram'
                  AND status IN (
                      'pending',
                      'confirmed'
                  )
                ORDER BY created_at DESC
                LIMIT 20
                `,
                [userId]
            );


        return {

            lives:
                user.lives,

            maxLives:
                MAX_LIVES,

            pendingAds:
                pending.rows

        };

    } finally {

        client.release();

    }
}


/* =========================================================
   EXPORT CONFIG
========================================================= */

export {
    AD_TYPES,
    ADSGRAM_BLOCK_ID,
    MAX_LIVES
};

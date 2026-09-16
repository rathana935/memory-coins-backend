import pool from "../db/pool.js";


/* =========================================================
   CONFIG
========================================================= */

const ADSGRAM_BLOCK_ID =
    String(
        process.env.ADSGRAM_BLOCK_ID || "48148"
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
   ERROR HELPER
========================================================= */

function createError(
    message,
    code
) {
    const error = new Error(message);
    error.code = code;
    return error;
}


/* =========================================================
   USER HELPERS
========================================================= */

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


        /* -----------------------------------------
           LOCK USER
        ----------------------------------------- */

        const user =
            await getUserById(
                client,
                userId
            );


        /* -----------------------------------------
           ONLY ONE PENDING ADSGRAM INTENT
           PER USER
           
           The AdsGram Reward URL identifies the
           user, so allowing multiple pending ads
           could cause the callback to confirm the
           wrong intent.
        ----------------------------------------- */

        const pendingResult =
            await client.query(
                `
                SELECT id
                FROM ad_rewards
                WHERE user_id = $1
                  AND provider = 'adsgram'
                  AND status = 'pending'
                  AND created_at >=
                      NOW() -
                      ($2 * INTERVAL '1 second')
                LIMIT 1
                FOR UPDATE
                `,
                [
                    userId,
                    ADSGRAM_PENDING_MAX_SECONDS
                ]
            );


        if (pendingResult.rows[0]) {

            throw createError(
                "An AdsGram reward is already pending.",
                "AD_ALREADY_PENDING"
            );

        }


        /* -----------------------------------------
           DOUBLE REWARD VALIDATION
        ----------------------------------------- */

        if (
            adType === "double_reward"
        ) {

            const gameResult =
                await client.query(
                    `
                    SELECT
                        id,
                        user_id,
                        difficulty,
                        level,
                        reward,
                        completed_at
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


            /*
             * IMPORTANT:
             *
             * game_sessions uses completed_at.
             * It does NOT use status='completed'.
             */

            if (!game.completed_at) {

                throw createError(
                    "Game must be completed first.",
                    "GAME_NOT_COMPLETED"
                );

            }


            /* -------------------------------------
               PREVENT SECOND DOUBLE REWARD
            ------------------------------------- */

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


        /* -----------------------------------------
           LIFE AD
        ----------------------------------------- */

        if (
            adType === "life"
        ) {

            /*
             * Do not waste an ad when lives are
             * already full.
             */

            if (
                Number(user.lives) >=
                MAX_LIVES
            ) {

                throw createError(
                    "Lives are already full.",
                    "MAX_LIVES"
                );

            }

        }


        /* -----------------------------------------
           METADATA
        ----------------------------------------- */

        const metadata = {

            gameSessionId:
                gameSessionId || null

        };


        /* -----------------------------------------
           INSERT PENDING REWARD
        ----------------------------------------- */

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

POST /api/rewards/life

The AdsGram callback ONLY confirms the reward.

This endpoint consumes the confirmed reward and gives
exactly +1 life.

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


        /* -----------------------------------------
           CHECK MAX LIVES
        ----------------------------------------- */

        if (
            Number(user.lives) >=
            MAX_LIVES
        ) {

            throw createError(
                "Lives are already full.",
                "MAX_LIVES"
            );

        }


        /* -----------------------------------------
           FIND CONFIRMED LIFE REWARD
        ----------------------------------------- */

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


        /* -----------------------------------------
           ADD EXACTLY ONE LIFE
        ----------------------------------------- */

        const updatedUser =
            await client.query(
                `
                UPDATE users
                SET
                    lives = LEAST(
                        lives + $2,
                        $3
                    ),
                    updated_at = NOW()
                WHERE id = $1
                RETURNING lives
                `,
                [
                    userId,
                    LIFE_REWARD,
                    MAX_LIVES
                ]
            );


        if (!updatedUser.rows[0]) {

            throw createError(
                "Unable to update lives.",
                "USER_UPDATE_FAILED"
            );

        }


        /* -----------------------------------------
           CONSUME ADSGRAM REWARD
        ----------------------------------------- */

        const consumed =
            await client.query(
                `
                UPDATE ad_rewards
                SET
                    consumed_at = NOW()
                WHERE id = $1
                  AND status = 'confirmed'
                  AND consumed_at IS NULL
                RETURNING id
                `,
                [reward.id]
            );


        if (!consumed.rows[0]) {

            throw createError(
                "Ad reward was already consumed.",
                "AD_ALREADY_CONSUMED"
            );

        }


        await client.query("COMMIT");


        return {

            success: true,

            reward: "life",

            addedLives:
                LIFE_REWARD,

            lives:
                Number(
                    updatedUser.rows[0].lives
                ),

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

GET /api/adsgram/reward?userid=[userId]

The callback:

1. Finds the user's pending AdsGram intent.
2. Confirms it.
3. Does NOT directly give the life.
4. The authenticated /life endpoint consumes it.

For double_reward, the reward remains confirmed until
the exact game session consumes it.

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


        /* -----------------------------------------
           FIND PENDING ADSGRAM INTENT
        ----------------------------------------- */

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


        /* -----------------------------------------
           INTERNAL REWARD ID
        ----------------------------------------- */

        const externalRewardId =
            `adsgram:${ADSGRAM_BLOCK_ID}:${reward.id}`;


        /* -----------------------------------------
           CONFIRM EXACTLY ONCE
        ----------------------------------------- */

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


        await client.query("COMMIT");


        /* -----------------------------------------
           IMPORTANT
           
           No coins or lives are added here.
           
           The authenticated client must consume
           the confirmed reward through:
           
           /api/rewards/life
           
           or:
           
           /api/rewards/double-game-reward
        ----------------------------------------- */

        return {

            success: true,

            reward: {

                id:
                    updated.rows[0].id,

                adType:
                    updated.rows[0].ad_type,

                status:
                    updated.rows[0].status,

                confirmedAt:
                    updated.rows[0].confirmed_at

            },

            rewardType:
                adType,

            message:
                "AdsGram reward confirmed."

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


        const today =
            new Date()
                .toISOString()
                .slice(0, 10);


        if (
            user.last_daily_claim &&
            String(
                user.last_daily_claim
            ).slice(0, 10) === today
        ) {

            throw createError(
                "Daily bonus already claimed.",
                "ALREADY_CLAIMED"
            );

        }


        const rewardCoins = 100;


        /* -----------------------------------------
           CREATE DAILY CLAIM
        ----------------------------------------- */

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


        /* -----------------------------------------
           UPDATE USER
        ----------------------------------------- */

        await client.query(
            `
            UPDATE users
            SET
                coins = $2,
                today_coins =
                    today_coins + $3,
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


        /* -----------------------------------------
           TRANSACTION LOG
        ----------------------------------------- */

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

            coins:
                after

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
=========================================================

The player receives the ORIGINAL game reward one more time.

Example:

Game reward = 10 coins

Normal completion:
+10

AdsGram double reward:
+10

Total earned from that game:
20

The client cannot specify the amount.

========================================================= */

export async function claimDoubleGameReward(
    userId,
    gameSessionId
) {

    if (!userId) {

        throw createError(
            "User ID is required.",
            "INVALID_USER_ID"
        );

    }


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


        /* -----------------------------------------
           GET EXACT GAME SESSION
        ----------------------------------------- */

        const gameResult =
            await client.query(
                `
                SELECT
                    id,
                    user_id,
                    difficulty,
                    level,
                    reward,
                    completed_at
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


        /* -----------------------------------------
           IMPORTANT:
           
           game_sessions uses completed_at,
           NOT status.
        ----------------------------------------- */

        if (!game.completed_at) {

            throw createError(
                "Game is not completed.",
                "GAME_NOT_COMPLETED"
            );

        }


        /* -----------------------------------------
           FIND CONFIRMED ADSGRAM REWARD
           FOR THIS EXACT GAME
        ----------------------------------------- */

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


        /* -----------------------------------------
           PREVENT DOUBLE CLAIM
        ----------------------------------------- */

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


        /* -----------------------------------------
           USE SERVER GAME REWARD
           
           IMPORTANT:
           game_sessions column = reward
           
           NOT reward_coins.
        ----------------------------------------- */

        const baseReward =
            Number(game.reward);


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


        /*
         * Double reward means adding the same
         * original reward one more time.
         */

        const bonusReward =
            baseReward;


        const after =
            before + bonusReward;


        /* -----------------------------------------
           UPDATE COINS
        ----------------------------------------- */

        await client.query(
            `
            UPDATE users
            SET
                coins = $2,
                today_coins =
                    today_coins + $3,
                updated_at = NOW()
            WHERE id = $1
            `,
            [
                userId,
                after,
                bonusReward
            ]
        );


        /* -----------------------------------------
           TRANSACTION LOG
        ----------------------------------------- */

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
                bonusReward,
                before,
                after,
                gameSessionId
            ]
        );


        /* -----------------------------------------
           CONSUME ADSGRAM REWARD
        ----------------------------------------- */

        const consumed =
            await client.query(
                `
                UPDATE ad_rewards
                SET
                    consumed_at = NOW()
                WHERE id = $1
                  AND status = 'confirmed'
                  AND consumed_at IS NULL
                RETURNING id
                `,
                [adReward.id]
            );


        if (!consumed.rows[0]) {

            throw createError(
                "Ad reward was already consumed.",
                "AD_ALREADY_CONSUMED"
            );

        }


        await client.query("COMMIT");


        return {

            success: true,

            gameSessionId,

            baseReward,

            bonusReward,

            totalFromAd:
                bonusReward,

            coins:
                after

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

    if (!userId) {

        throw createError(
            "User ID is required.",
            "INVALID_USER_ID"
        );

    }


    const client =
        await pool.connect();


    try {

        const user =
            await getUserById(
                client,
                userId
            );


        const rewards =
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
                Number(user.lives),

            maxLives:
                MAX_LIVES,

            pendingAds:
                rewards.rows

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

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

const DAILY_BONUS_REWARD = 100;

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
    const error =
        new Error(message);

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
        await client.query(
            "BEGIN"
        );


        /* -----------------------------------------
           LOCK USER
        ----------------------------------------- */

        const user =
            await getUserById(
                client,
                userId
            );


        /* -----------------------------------------
           CLEAN UP OLD PENDING INTENTS
           
           Old pending intents are no longer valid
           after the configured timeout.
        ----------------------------------------- */

        await client.query(
            `
            UPDATE ad_rewards
            SET
                status = 'rejected',
                metadata =
                    COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object(
                        'reason',
                        'expired'
                    )
            WHERE user_id = $1
              AND provider = 'adsgram'
              AND status = 'pending'
              AND created_at <
                  NOW() -
                  ($2 * INTERVAL '1 second')
            `,
            [
                userId,
                ADSGRAM_PENDING_MAX_SECONDS
            ]
        );


        /* -----------------------------------------
           ONLY ONE ACTIVE ADSGRAM INTENT
           PER USER
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

        let game = null;


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


            game =
                gameResult.rows[0];


            /* -------------------------------------
               GAME MUST BE COMPLETED
            ------------------------------------- */

            if (!game.completed_at) {
                throw createError(
                    "Game must be completed first.",
                    "GAME_NOT_COMPLETED"
                );
            }


            /* -------------------------------------
               IMPORTANT:
               
               A GAME SESSION CAN ONLY RECEIVE
               ONE DOUBLE REWARD EVER.
               
               Check ALL states:
               pending
               confirmed
               consumed
               rejected
               
               We intentionally block pending,
               confirmed AND consumed.
            ------------------------------------- */

            const existing =
                await client.query(
                    `
                    SELECT
                        id,
                        status
                    FROM ad_rewards
                    WHERE user_id = $1
                      AND provider = 'adsgram'
                      AND ad_type = 'double_reward'
                      AND metadata->>'gameSessionId' = $2
                    LIMIT 1
                    FOR UPDATE
                    `,
                    [
                        userId,
                        gameSessionId
                    ]
                );


            if (existing.rows[0]) {

                const existingReward =
                    existing.rows[0];


                if (
                    existingReward.status ===
                    "rejected"
                ) {
                    /*
                     * A rejected intent is allowed
                     * to be retried.
                     */
                } else {
                    throw createError(
                        "Double reward was already created or claimed for this game.",
                        "ALREADY_CLAIMED"
                    );
                }
            }
        }


        /* -----------------------------------------
           LIFE AD VALIDATION
        ----------------------------------------- */

        if (
            adType === "life"
        ) {
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
                gameSessionId || null,

            blockId:
                ADSGRAM_BLOCK_ID
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
                    JSON.stringify(
                        metadata
                    )
                ]
            );


        await client.query(
            "COMMIT"
        );


        return {
            ...inserted.rows[0],
            blockId:
                ADSGRAM_BLOCK_ID
        };

    } catch (error) {

        await client.query(
            "ROLLBACK"
        );

        throw error;

    } finally {

        client.release();

    }
}


/* =========================================================
   CLAIM +1 LIFE
=========================================================

POST /api/rewards/life

AdsGram callback confirms the reward.

This function consumes the confirmed reward and
gives exactly +1 life.

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
        await client.query(
            "BEGIN"
        );


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
           CONSUME REWARD
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


        await client.query(
            "COMMIT"
        );


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

        await client.query(
            "ROLLBACK"
        );

        throw error;

    } finally {

        client.release();

    }
}


/* =========================================================
   ADSGRAM REWARD URL CALLBACK
=========================================================

GET /api/adsgram/reward?userid=[userId]

AdsGram sends the Telegram user ID.

This callback:

1. Finds pending intent.
2. Confirms exactly one intent.
3. Does NOT directly give coins/lives.
4. The authenticated app consumes the confirmed reward.

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
        await client.query(
            "BEGIN"
        );


        const user =
            await getUserByTelegramId(
                client,
                telegramId
            );


        /* -----------------------------------------
           EXPIRE OLD PENDING REWARDS
        ----------------------------------------- */

        await client.query(
            `
            UPDATE ad_rewards
            SET
                status = 'rejected',
                metadata =
                    COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object(
                        'reason',
                        'expired'
                    )
            WHERE user_id = $1
              AND provider = 'adsgram'
              AND status = 'pending'
              AND created_at <
                  NOW() -
                  ($2 * INTERVAL '1 second')
            `,
            [
                user.id,
                ADSGRAM_PENDING_MAX_SECONDS
            ]
        );


        /* -----------------------------------------
           FIND ACTIVE PENDING INTENT
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
           EXTRA VALIDATION FOR DOUBLE REWARD
        ----------------------------------------- */

        if (
            adType ===
            "double_reward"
        ) {
            const gameSessionId =
                reward.metadata?.gameSessionId;


            if (!gameSessionId) {
                throw createError(
                    "Double reward game session is missing.",
                    "INVALID_GAME_SESSION"
                );
            }


            const gameResult =
                await client.query(
                    `
                    SELECT
                        id,
                        completed_at
                    FROM game_sessions
                    WHERE id = $1
                      AND user_id = $2
                    FOR UPDATE
                    `,
                    [
                        gameSessionId,
                        user.id
                    ]
                );


            if (!gameResult.rows[0]) {
                throw createError(
                    "Game session not found.",
                    "GAME_SESSION_NOT_FOUND"
                );
            }


            if (
                !gameResult.rows[0]
                    .completed_at
            ) {
                throw createError(
                    "Game is not completed.",
                    "GAME_NOT_COMPLETED"
                );
            }
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


        await client.query(
            "COMMIT"
        );


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
                    updated.rows[0]
                        .confirmed_at
            },

            rewardType:
                adType,

            message:
                "AdsGram reward confirmed."
        };

    } catch (error) {

        await client.query(
            "ROLLBACK"
        );

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
        await client.query(
            "BEGIN"
        );


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


        const rewardCoins =
            DAILY_BONUS_REWARD;


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


        await client.query(
            "COMMIT"
        );


        return {
            success: true,

            rewardCoins,

            coins:
                after
        };

    } catch (error) {

        await client.query(
            "ROLLBACK"
        );

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

Game reward = 10

Normal game:
+10

AdsGram:
+10

Total:
20

The client NEVER supplies the reward amount.

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
        await client.query(
            "BEGIN"
        );


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


        if (!game.completed_at) {
            throw createError(
                "Game is not completed.",
                "GAME_NOT_COMPLETED"
            );
        }


        /* -----------------------------------------
           FIND CONFIRMED REWARD
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
           SECONDARY PROTECTION
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
                FOR UPDATE
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
           SERVER-CONTROLLED REWARD
        ----------------------------------------- */

        const baseReward =
            Number(game.reward);


        if (
            !Number.isSafeInteger(
                baseReward
            ) ||
            baseReward <= 0
        ) {
            throw createError(
                "Invalid game reward.",
                "INVALID_GAME_REWARD"
            );
        }


        const before =
            Number(user.coins);


        const bonusReward =
            baseReward;


        const after =
            before + bonusReward;


        if (
            !Number.isSafeInteger(
                after
            )
        ) {
            throw createError(
                "Coin balance overflow.",
                "COIN_BALANCE_OVERFLOW"
            );
        }


        /* -----------------------------------------
           UPDATE COINS
        ----------------------------------------- */

        const updatedUser =
            await client.query(
                `
                UPDATE users
                SET
                    coins = $2,
                    today_coins =
                        today_coins + $3,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING coins
                `,
                [
                    userId,
                    after,
                    bonusReward
                ]
            );


        if (!updatedUser.rows[0]) {
            throw createError(
                "Unable to update coins.",
                "USER_UPDATE_FAILED"
            );
        }


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


        await client.query(
            "COMMIT"
        );


        return {
            success: true,

            gameSessionId,

            baseReward,

            bonusReward,

            totalFromAd:
                bonusReward,

            coins:
                Number(
                    updatedUser.rows[0]
                        .coins
                )
        };

    } catch (error) {

        await client.query(
            "ROLLBACK"
        );

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


        /* -------------------------------------------------
           FRONTEND-COMPATIBLE REWARD STATUS

           The Mini App needs the authoritative wallet balance,
           daily-claim state, life recovery timestamp, and a
           quick indication that AdsGram has confirmed an ad.

           These values are derived from PostgreSQL only; the
           client cannot supply or modify them.
        ------------------------------------------------- */

        const verifiedAds = {
            life: 0,
            double_reward: 0
        };

        for (const reward of rewards.rows) {
            if (
                reward.status === "confirmed" &&
                reward.consumed_at == null &&
                Object.prototype.hasOwnProperty.call(
                    verifiedAds,
                    reward.ad_type
                )
            ) {
                verifiedAds[reward.ad_type] += 1;
            }
        }

        const today =
            new Date()
                .toISOString()
                .slice(0, 10);

        const dailyClaimed =
            Boolean(
                user.last_daily_claim &&
                String(user.last_daily_claim).slice(0, 10) === today
            );

        return {
            balance:
                Number(user.coins || 0),

            coins:
                Number(user.coins || 0),

            lives:
                Number(user.lives),

            maxLives:
                MAX_LIVES,

            lastLifeAt:
                user.last_life_at || null,

            last_life_at:
                user.last_life_at || null,

            dailyClaimed,

            daily_claimed:
                dailyClaimed,

            verifiedAds,

            verified_ads:
                verifiedAds,

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

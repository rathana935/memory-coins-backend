import crypto from "crypto";
import pool from "../db/pool.js";

/*
=========================================================
MEMORY CARD / MEMORY COINS
REWARDS SERVICE
=========================================================

DAILY BONUS
- Default: 100 coins
- Once per Cambodia calendar day
- Daily streak
- Server-side transaction

LUCKY ROLL
- 1 roll every 5 minutes
- Number: 1 - 99,999
- Reward calculated server-side
- Exact payout table:
    1 - 89,999       = +5
    90,000 - 94,999  = +8
    95,000 - 99,499  = +12
    99,500 - 99,996  = +18
    99,997 - 99,998  = +82
    99,999            = +10,000

ADS
- Provider: AdsGram
- Server-created ad intent
- AdsGram Reward URL confirmation
- Confirmed rewards are consumed only once
- Client NEVER decides whether an ad was completed

AD TYPES
- life
- double_reward
- lucky_roll

LIFE REWARD
- +1 life
- Maximum 5 lives

DOUBLE REWARD
- Used for a completed game reward
- Actual game-result integration is handled by game service
- This service only verifies/consumes the AdsGram reward

SECURITY
- Browser NEVER chooses reward amount
- Browser NEVER chooses Lucky Roll number
- Browser NEVER confirms an ad
- User balance is locked with FOR UPDATE
- Coin changes happen inside transactions
=========================================================
*/


/* =========================================================
   DEFAULT CONFIG
========================================================= */

const DEFAULT_DAILY_BONUS = 100;

const DEFAULT_LUCKY_COOLDOWN_SECONDS = 300;

const DEFAULT_LUCKY_MIN = 1;

const DEFAULT_LUCKY_MAX = 99999;

const MAX_LIVES = 5;

/*
Ads must be confirmed shortly after an intent is created.
*/
const AD_INTENT_TTL_SECONDS = 10 * 60;


/* =========================================================
   HELPERS
========================================================= */

function getPhnomPenhDate() {

    return new Intl.DateTimeFormat(
        "en-CA",
        {
            timeZone: "Asia/Phnom_Penh",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }
    ).format(new Date());
}


/* =========================================================
   LOAD APP SETTING
========================================================= */

async function getSetting(client, key) {

    const result = await client.query(
        `
        SELECT value
        FROM app_settings
        WHERE key = $1
        LIMIT 1
        `,
        [key]
    );

    if (result.rowCount === 0) {
        return null;
    }

    return result.rows[0].value;
}


/* =========================================================
   DAILY BONUS CONFIG
========================================================= */

async function getDailyBonusAmount(client) {

    const economy = await getSetting(
        client,
        "economy"
    );

    const value =
        economy?.daily_bonus;

    const reward = Number(value);

    if (
        Number.isFinite(reward) &&
        Number.isSafeInteger(reward) &&
        reward > 0
    ) {
        return reward;
    }

    return DEFAULT_DAILY_BONUS;
}


/* =========================================================
   DEFAULT LUCKY REWARDS
========================================================= */

function getDefaultLuckyRewards() {

    return {
        default: 5,
        "90000": 8,
        "95000": 12,
        "99500": 18,
        "99997": 82,
        "99999": 10000
    };
}


/* =========================================================
   LUCKY ROLL CONFIG
========================================================= */

async function getLuckyRollConfig(client) {

    const setting = await getSetting(
        client,
        "lucky_roll"
    );

    const defaults =
        getDefaultLuckyRewards();


    const cooldownRaw =
        Number(
            setting?.cooldown_seconds ??
            DEFAULT_LUCKY_COOLDOWN_SECONDS
        );


    const minimumRaw =
        Number(
            setting?.minimum ??
            DEFAULT_LUCKY_MIN
        );


    const maximumRaw =
        Number(
            setting?.maximum ??
            DEFAULT_LUCKY_MAX
        );


    const cooldownSeconds =
        Number.isSafeInteger(cooldownRaw) &&
        cooldownRaw > 0
            ? cooldownRaw
            : DEFAULT_LUCKY_COOLDOWN_SECONDS;


    let minimum =
        Number.isSafeInteger(minimumRaw)
            ? minimumRaw
            : DEFAULT_LUCKY_MIN;


    let maximum =
        Number.isSafeInteger(maximumRaw)
            ? maximumRaw
            : DEFAULT_LUCKY_MAX;


    minimum = Math.max(
        DEFAULT_LUCKY_MIN,
        Math.min(
            DEFAULT_LUCKY_MAX,
            minimum
        )
    );


    maximum = Math.max(
        DEFAULT_LUCKY_MIN,
        Math.min(
            DEFAULT_LUCKY_MAX,
            maximum
        )
    );


    if (minimum > maximum) {

        minimum =
            DEFAULT_LUCKY_MIN;

        maximum =
            DEFAULT_LUCKY_MAX;
    }


    const rewards =
        setting?.rewards &&
        typeof setting.rewards === "object"
            ? {
                ...defaults,
                ...setting.rewards
            }
            : defaults;


    return {
        cooldownSeconds,
        minimum,
        maximum,
        rewards
    };
}


/* =========================================================
   CALCULATE LUCKY ROLL REWARD
========================================================= */

function calculateLuckyReward(
    rollNumber,
    rewards
) {

    const number =
        Number(rollNumber);


    if (number === 99999) {

        return safeReward(
            rewards?.["99999"],
            10000
        );
    }


    if (number >= 99997) {

        return safeReward(
            rewards?.["99997"],
            82
        );
    }


    if (number >= 99500) {

        return safeReward(
            rewards?.["99500"],
            18
        );
    }


    if (number >= 95000) {

        return safeReward(
            rewards?.["95000"],
            12
        );
    }


    if (number >= 90000) {

        return safeReward(
            rewards?.["90000"],
            8
        );
    }


    return safeReward(
        rewards?.default,
        5
    );
}


/* =========================================================
   SAFE REWARD
========================================================= */

function safeReward(
    value,
    fallback
) {

    const number =
        Number(value);


    if (
        Number.isSafeInteger(number) &&
        number >= 0
    ) {
        return number;
    }


    return fallback;
}


/* =========================================================
   VALIDATE AD TYPE
========================================================= */

function validateAdType(adType) {

    const allowed = new Set([
        "life",
        "double_reward",
        "lucky_roll"
    ]);


    if (!allowed.has(adType)) {

        const error =
            new Error("INVALID_AD_TYPE");

        error.code =
            "INVALID_AD_TYPE";

        throw error;
    }


    return adType;
}


/* =========================================================
   CREATE ADSGRAM AD INTENT
=========================================================

The frontend calls this BEFORE opening AdsGram.

The intent is stored on the server.

The browser cannot simply send:
    adCompleted: true

and receive a reward.
========================================================= */

export async function createAdRewardIntent(
    userId,
    adType,
    metadata = {}
) {

    validateAdType(adType);


    const client =
        await pool.connect();


    try {

        await client.query(
            "BEGIN"
        );


        const userResult =
            await client.query(
                `
                SELECT
                    id,
                    telegram_id,
                    is_blocked
                FROM users
                WHERE id = $1
                FOR UPDATE
                `,
                [userId]
            );


        if (userResult.rowCount === 0) {

            throw new Error(
                "USER_NOT_FOUND"
            );
        }


        const user =
            userResult.rows[0];


        if (user.is_blocked) {

            throw new Error(
                "USER_BLOCKED"
            );
        }


        /*
        Prevent many unused intents for the same ad type.
        */

        const existingResult =
            await client.query(
                `
                SELECT
                    id,
                    metadata,
                    created_at
                FROM ad_rewards
                WHERE
                    user_id = $1
                    AND provider = 'adsgram'
                    AND ad_type = $2
                    AND status = 'pending'
                    AND consumed_at IS NULL
                    AND created_at >= NOW() -
                        ($3 * INTERVAL '1 second')
                ORDER BY created_at DESC
                LIMIT 1
                `,
                [
                    userId,
                    adType,
                    AD_INTENT_TTL_SECONDS
                ]
            );


        if (existingResult.rowCount > 0) {

            const existing =
                existingResult.rows[0];


            await client.query(
                "COMMIT"
            );


            return {
                success: true,
                reused: true,
                intentId:
                    existing.id,
                adType,
                provider:
                    "adsgram",
                expiresAt:
                    new Date(
                        new Date(
                            existing.created_at
                        ).getTime() +
                        AD_INTENT_TTL_SECONDS *
                        1000
                    )
            };
        }


        const intentId =
            crypto.randomUUID();


        const safeMetadata =
            metadata &&
            typeof metadata === "object"
                ? metadata
                : {};


        const intentMetadata = {
            ...safeMetadata,
            intentId,
            createdBy:
                "memory-card-backend",
            createdAt:
                new Date().toISOString()
        };


        await client.query(
            `
            INSERT INTO ad_rewards
            (
                id,
                user_id,
                provider,
                ad_type,
                external_reward_id,
                reward_coins,
                status,
                metadata,
                created_at
            )
            VALUES
            (
                $1,
                $2,
                'adsgram',
                $3,
                NULL,
                0,
                'pending',
                $4::jsonb,
                NOW()
            )
            `,
            [
                intentId,
                userId,
                adType,
                JSON.stringify(
                    intentMetadata
                )
            ]
        );


        await client.query(
            "COMMIT"
        );


        return {
            success: true,
            reused: false,
            intentId,
            adType,
            provider:
                "adsgram",
            expiresAt:
                new Date(
                    Date.now() +
                    AD_INTENT_TTL_SECONDS *
                    1000
                )
        };


    } catch (error) {

        try {
            await client.query(
                "ROLLBACK"
            );
        } catch {
            // Ignore rollback errors.
        }

        throw error;

    } finally {

        client.release();
    }
}


/* =========================================================
   CONFIRM ADSGRAM REWARD
=========================================================

AdsGram Reward URL sends the Telegram ID.

Example:

GET /api/adsgram/reward?userid=123456789

We then match that Telegram account to a short-lived
server-created pending ad intent.

IMPORTANT:
The client is never allowed to call this function.
========================================================= */

export async function confirmAdsgramReward(
    telegramId,
    adType = null
) {

    const normalizedTelegramId =
        String(telegramId ?? "").trim();


    if (
        !/^-?\d+$/.test(
            normalizedTelegramId
        )
    ) {

        const error =
            new Error(
                "INVALID_TELEGRAM_ID"
            );

        error.code =
            "INVALID_TELEGRAM_ID";

        throw error;
    }


    if (adType !== null) {
        validateAdType(adType);
    }


    const client =
        await pool.connect();


    try {

        await client.query(
            "BEGIN"
        );


        const userResult =
            await client.query(
                `
                SELECT
                    id,
                    telegram_id,
                    is_blocked
                FROM users
                WHERE telegram_id = $1
                FOR UPDATE
                `,
                [normalizedTelegramId]
            );


        if (userResult.rowCount === 0) {

            await client.query(
                "ROLLBACK"
            );

            return {
                success: false,
                error:
                    "USER_NOT_FOUND"
            };
        }


        const user =
            userResult.rows[0];


        if (user.is_blocked) {

            await client.query(
                "ROLLBACK"
            );

            return {
                success: false,
                error:
                    "USER_BLOCKED"
            };
        }


        const params = [
            user.id,
            AD_INTENT_TTL_SECONDS
        ];


        let typeCondition = "";


        if (adType) {

            params.push(adType);

            typeCondition =
                "AND ad_type = $3";
        }


        /*
        Find the oldest still-pending intent.

        We intentionally do not immediately grant coins.
        We only mark the ad reward as confirmed.

        The actual reward is consumed by a protected API.
        */

        const intentResult =
            await client.query(
                `
                SELECT
                    id,
                    ad_type,
                    metadata,
                    created_at
                FROM ad_rewards
                WHERE
                    user_id = $1
                    AND provider = 'adsgram'
                    AND status = 'pending'
                    AND consumed_at IS NULL
                    AND created_at >= NOW() -
                        ($2 * INTERVAL '1 second')
                    ${typeCondition}
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
                `,
                params
            );


        if (intentResult.rowCount === 0) {

            await client.query(
                "ROLLBACK"
            );

            return {
                success: false,
                error:
                    "NO_PENDING_AD"
            };
        }


        const intent =
            intentResult.rows[0];


        const externalRewardId =
            `adsgram:${normalizedTelegramId}:${intent.id}`;


        const updatedResult =
            await client.query(
                `
                UPDATE ad_rewards
                SET
                    status = 'confirmed',
                    external_reward_id = $1,
                    reward_coins = 0,
                    confirmed_at = NOW(),
                    metadata =
                        metadata ||
                        $2::jsonb
                WHERE
                    id = $3
                    AND status = 'pending'
                RETURNING
                    id,
                    user_id,
                    ad_type,
                    status,
                    confirmed_at
                `,
                [
                    externalRewardId,
                    JSON.stringify({
                        confirmedBy:
                            "adsgram_reward_url",
                        telegramId:
                            normalizedTelegramId
                    }),
                    intent.id
                ]
            );


        if (
            updatedResult.rowCount === 0
        ) {

            throw new Error(
                "AD_CONFIRMATION_FAILED"
            );
        }


        await client.query(
            "COMMIT"
        );


        const confirmed =
            updatedResult.rows[0];


        return {
            success: true,
            confirmed: true,
            rewardId:
                confirmed.id,
            userId:
                confirmed.user_id,
            adType:
                confirmed.ad_type,
            status:
                confirmed.status,
            confirmedAt:
                confirmed.confirmed_at
        };


    } catch (error) {

        try {
            await client.query(
                "ROLLBACK"
            );
        } catch {
            // Ignore rollback errors.
        }

        throw error;

    } finally {

        client.release();
    }
}


/* =========================================================
   CONSUME VERIFIED AD
=========================================================

This function is intentionally exported.

Routes can use it to verify that a confirmed AdsGram
reward exists before granting the actual game reward.
========================================================= */

export async function consumeVerifiedAd(
    client,
    userId,
    adType
) {

    validateAdType(adType);


    const result =
        await client.query(
            `
            SELECT
                id,
                ad_type,
                status,
                confirmed_at,
                metadata
            FROM ad_rewards
            WHERE
                user_id = $1
                AND provider = 'adsgram'
                AND ad_type = $2
                AND status = 'confirmed'
                AND consumed_at IS NULL
                AND confirmed_at >= NOW() -
                    ($3 * INTERVAL '1 second')
            ORDER BY confirmed_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            `,
            [
                userId,
                adType,
                AD_INTENT_TTL_SECONDS
            ]
        );


    if (result.rowCount === 0) {

        const error =
            new Error(
                "VERIFIED_AD_REQUIRED"
            );

        error.code =
            "VERIFIED_AD_REQUIRED";

        throw error;
    }


    const ad =
        result.rows[0];


    const consumedResult =
        await client.query(
            `
            UPDATE ad_rewards
            SET
                consumed_at = NOW(),
                metadata =
                    metadata ||
                    $1::jsonb
            WHERE
                id = $2
                AND status = 'confirmed'
                AND consumed_at IS NULL
            RETURNING
                id,
                ad_type,
                consumed_at
            `,
            [
                JSON.stringify({
                    consumedBy:
                        "memory-card-backend"
                }),
                ad.id
            ]
        );


    if (
        consumedResult.rowCount === 0
    ) {

        const error =
            new Error(
                "AD_ALREADY_CONSUMED"
            );

        error.code =
            "AD_ALREADY_CONSUMED";

        throw error;
    }


    return {
        success: true,
        rewardId:
            consumedResult.rows[0].id,
        adType:
            consumedResult.rows[0].ad_type,
        consumedAt:
            consumedResult.rows[0].consumed_at
    };
}


/* =========================================================
   GIVE ONE EXTRA LIFE
========================================================= */

export async function claimAdLife(
    userId
) {

    const client =
        await pool.connect();


    try {

        await client.query(
            "BEGIN"
        );


        const userResult =
            await client.query(
                `
                SELECT
                    id,
                    coins,
                    lives
                FROM users
                WHERE id = $1
                FOR UPDATE
                `,
                [userId]
            );


        if (userResult.rowCount === 0) {

            throw new Error(
                "USER_NOT_FOUND"
            );
        }


        const user =
            userResult.rows[0];


        const currentLives =
            Math.max(
                0,
                Math.min(
                    MAX_LIVES,
                    Number(user.lives)
                )
            );


        /*
        Important:
        Do not consume the ad if the user already has
        maximum lives.
        */

        if (
            currentLives >= MAX_LIVES
        ) {

            await client.query(
                "ROLLBACK"
            );

            return {
                success: false,
                error:
                    "MAX_LIVES",
                message:
                    "You already have the maximum number of lives.",
                lives:
                    MAX_LIVES
            };
        }


        const ad =
            await consumeVerifiedAd(
                client,
                userId,
                "life"
            );


        const newLives =
            currentLives + 1;


        const updateResult =
            await client.query(
                `
                UPDATE users
                SET
                    lives = $1,
                    last_life_at =
                        CASE
                            WHEN $1 >= $2
                            THEN NULL
                            ELSE last_life_at
                        END,
                    updated_at = NOW()
                WHERE id = $3
                RETURNING
                    lives,
                    last_life_at
                `,
                [
                    newLives,
                    MAX_LIVES,
                    userId
                ]
            );


        if (
            updateResult.rowCount === 0
        ) {

            throw new Error(
                "USER_UPDATE_FAILED"
            );
        }


        await client.query(
            "COMMIT"
        );


        return {
            success: true,
            reward:
                1,
            lives:
                Number(
                    updateResult.rows[0].lives
                ),
            lastLifeAt:
                updateResult.rows[0].last_life_at,
            adRewardId:
                ad.rewardId
        };


    } catch (error) {

        try {
            await client.query(
                "ROLLBACK"
            );
        } catch {
            // Ignore rollback errors.
        }

        throw error;

    } finally {

        client.release();
    }
}


/* =========================================================
   VERIFY DOUBLE GAME REWARD AD
=========================================================

This does NOT directly modify the game balance.

The game service should call this inside its own transaction
when it is ready to apply a 2x game reward.

For now this safely consumes one verified double_reward ad.
========================================================= */

export async function consumeDoubleGameRewardAd(
    client,
    userId
) {

    return consumeVerifiedAd(
        client,
        userId,
        "double_reward"
    );
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

        await client.query(
            "BEGIN"
        );


        const userResult =
            await client.query(
                `
                SELECT
                    id,
                    coins,
                    today_coins,
                    daily_streak,
                    last_daily_claim
                FROM users
                WHERE id = $1
                FOR UPDATE
                `,
                [userId]
            );


        if (userResult.rowCount === 0) {

            throw new Error(
                "USER_NOT_FOUND"
            );
        }


        const user =
            userResult.rows[0];


        const today =
            getPhnomPenhDate();


        if (
            user.last_daily_claim &&
            String(
                user.last_daily_claim
            ) === today
        ) {

            await client.query(
                "ROLLBACK"
            );


            return {
                success: false,
                error:
                    "ALREADY_CLAIMED",
                message:
                    "Daily bonus has already been claimed today.",
                coins:
                    Number(user.coins),
                streak:
                    Number(user.daily_streak),
                claimDate:
                    today
            };
        }


        const reward =
            await getDailyBonusAmount(
                client
            );


        if (reward <= 0) {

            throw new Error(
                "DAILY_BONUS_DISABLED"
            );
        }


        let newStreak = 1;


        if (user.last_daily_claim) {

            const previousDate =
                new Date(
                    `${String(
                        user.last_daily_claim
                    )}T00:00:00+07:00`
                );


            const currentDate =
                new Date(
                    `${today}T00:00:00+07:00`
                );


            const difference =
                Math.floor(
                    (
                        currentDate.getTime() -
                        previousDate.getTime()
                    ) /
                    86400000
                );


            if (difference === 1) {

                newStreak =
                    Math.min(
                        7,
                        Number(
                            user.daily_streak
                        ) + 1
                    );
            }
        }


        const balanceBefore =
            Number(user.coins);


        const balanceAfter =
            balanceBefore + reward;


        const claimResult =
            await client.query(
                `
                INSERT INTO daily_bonus_claims
                (
                    user_id,
                    claim_date,
                    day_number,
                    reward_coins,
                    created_at
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    $4,
                    NOW()
                )
                RETURNING
                    id,
                    claim_date,
                    day_number,
                    reward_coins,
                    created_at
                `,
                [
                    userId,
                    today,
                    newStreak,
                    reward
                ]
            );


        const claim =
            claimResult.rows[0];


        const userUpdate =
            await client.query(
                `
                UPDATE users
                SET
                    coins = coins + $1,
                    today_coins = today_coins + $1,
                    daily_streak = $2,
                    last_daily_claim = $3,
                    updated_at = NOW()
                WHERE id = $4
                RETURNING
                    coins,
                    today_coins,
                    daily_streak,
                    last_daily_claim
                `,
                [
                    reward,
                    newStreak,
                    today,
                    userId
                ]
            );


        if (
            userUpdate.rowCount === 0
        ) {

            throw new Error(
                "USER_UPDATE_FAILED"
            );
        }


        const updatedUser =
            userUpdate.rows[0];


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
                description,
                created_at
            )
            VALUES
            (
                $1,
                'daily_bonus',
                $2,
                $3,
                $4,
                $5,
                $6,
                NOW()
            )
            `,
            [
                userId,
                reward,
                balanceBefore,
                balanceAfter,
                claim.id,
                `Daily bonus day ${newStreak}`
            ]
        );


        await client.query(
            "COMMIT"
        );


        return {
            success: true,
            reward,
            balance:
                Number(
                    updatedUser.coins
                ),
            todayCoins:
                Number(
                    updatedUser.today_coins
                ),
            streak:
                Number(
                    updatedUser.daily_streak
                ),
            claimDate:
                String(
                    updatedUser.last_daily_claim
                ),
            dayNumber:
                newStreak
        };


    } catch (error) {

        try {
            await client.query(
                "ROLLBACK"
            );
        } catch {
            // Ignore rollback errors.
        }

        throw error;

    } finally {

        client.release();
    }
}


/* =========================================================
   LUCKY ROLL
========================================================= */

export async function luckyRoll(
    userId
) {

    const client =
        await pool.connect();


    try {

        await client.query(
            "BEGIN"
        );


        const userResult =
            await client.query(
                `
                SELECT
                    id,
                    coins,
                    today_coins
                FROM users
                WHERE id = $1
                FOR UPDATE
                `,
                [userId]
            );


        if (userResult.rowCount === 0) {

            throw new Error(
                "USER_NOT_FOUND"
            );
        }


        const user =
            userResult.rows[0];


        const config =
            await getLuckyRollConfig(
                client
            );


        const {
            cooldownSeconds,
            minimum,
            maximum,
            rewards
        } = config;


        /* -------------------------------------------------
           CHECK COOLDOWN FIRST
        ------------------------------------------------- */

        const lastRollResult =
            await client.query(
                `
                SELECT
                    id,
                    roll_number,
                    reward_coins,
                    rolled_at
                FROM lucky_rolls
                WHERE user_id = $1
                ORDER BY rolled_at DESC
                LIMIT 1
                `,
                [userId]
            );


        let nextRollAt = null;


        if (
            lastRollResult.rowCount > 0
        ) {

            const lastRoll =
                lastRollResult.rows[0];


            const lastRollTime =
                new Date(
                    lastRoll.rolled_at
                ).getTime();


            const nextTime =
                lastRollTime +
                cooldownSeconds * 1000;


            const now =
                Date.now();


            if (now < nextTime) {

                nextRollAt =
                    new Date(nextTime);


                const remainingSeconds =
                    Math.ceil(
                        (
                            nextTime -
                            now
                        ) /
                        1000
                    );


                await client.query(
                    "ROLLBACK"
                );


                return {
                    success: false,
                    error:
                        "COOLDOWN",
                    message:
                        "Lucky Roll is still on cooldown.",
                    remainingSeconds,
                    nextRollAt
                };
            }
        }


        /*
        Only now consume the verified AdsGram reward.

        This prevents an ad from being lost because the
        Lucky Roll is still on cooldown.
        */

        const ad =
            await consumeVerifiedAd(
                client,
                userId,
                "lucky_roll"
            );


        /* -------------------------------------------------
           SERVER RANDOM
        ------------------------------------------------- */

        const rollNumber =
            crypto.randomInt(
                minimum,
                maximum + 1
            );


        const reward =
            calculateLuckyReward(
                rollNumber,
                rewards
            );


        if (
            !Number.isSafeInteger(reward) ||
            reward < 0
        ) {

            throw new Error(
                "INVALID_LUCKY_REWARD"
            );
        }


        const balanceBefore =
            Number(user.coins);


        const balanceAfter =
            balanceBefore + reward;


        const rollResult =
            await client.query(
                `
                INSERT INTO lucky_rolls
                (
                    user_id,
                    roll_number,
                    reward_coins,
                    ad_required,
                    ad_completed,
                    rolled_at
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    TRUE,
                    TRUE,
                    NOW()
                )
                RETURNING
                    id,
                    roll_number,
                    reward_coins,
                    ad_required,
                    ad_completed,
                    rolled_at
                `,
                [
                    userId,
                    rollNumber,
                    reward
                ]
            );


        const roll =
            rollResult.rows[0];


        const updatedResult =
            await client.query(
                `
                UPDATE users
                SET
                    coins = coins + $1,
                    today_coins = today_coins + $1,
                    updated_at = NOW()
                WHERE id = $2
                RETURNING
                    coins,
                    today_coins
                `,
                [
                    reward,
                    userId
                ]
            );


        if (
            updatedResult.rowCount === 0
        ) {

            throw new Error(
                "USER_UPDATE_FAILED"
            );
        }


        const updatedUser =
            updatedResult.rows[0];


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
                description,
                created_at
            )
            VALUES
            (
                $1,
                'lucky_roll',
                $2,
                $3,
                $4,
                $5,
                $6,
                NOW()
            )
            `,
            [
                userId,
                reward,
                balanceBefore,
                Number(
                    updatedUser.coins
                ),
                roll.id,
                `Lucky Roll ${rollNumber}`
            ]
        );


        /*
        Store which verified ad was consumed.
        */

        await client.query(
            `
            UPDATE ad_rewards
            SET
                metadata =
                    metadata ||
                    $1::jsonb
            WHERE id = $2
            `,
            [
                JSON.stringify({
                    appliedTo:
                        "lucky_roll",
                    luckyRollId:
                        roll.id
                }),
                ad.rewardId
            ]
        );


        await client.query(
            "COMMIT"
        );


        const nextRoll =
            new Date(
                new Date(
                    roll.rolled_at
                ).getTime() +
                cooldownSeconds * 1000
            );


        return {
            success: true,

            roll: {
                id:
                    roll.id,

                number:
                    Number(
                        roll.roll_number
                    ),

                reward:
                    Number(
                        roll.reward_coins
                    ),

                rolledAt:
                    roll.rolled_at
            },

            balance:
                Number(
                    updatedUser.coins
                ),

            todayCoins:
                Number(
                    updatedUser.today_coins
                ),

            cooldownSeconds,

            nextRollAt:

                nextRoll
        };


    } catch (error) {

        try {
            await client.query(
                "ROLLBACK"
            );
        } catch {
            // Ignore rollback errors.
        }

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

        const today =
            getPhnomPenhDate();


        const userResult =
            await client.query(
                `
                SELECT
                    coins,
                    today_coins,
                    daily_streak,
                    last_daily_claim,
                    lives
                FROM users
                WHERE id = $1
                LIMIT 1
                `,
                [userId]
            );


        if (userResult.rowCount === 0) {

            throw new Error(
                "USER_NOT_FOUND"
            );
        }


        const user =
            userResult.rows[0];


        const dailyClaimed =
            Boolean(
                user.last_daily_claim &&
                String(
                    user.last_daily_claim
                ) === today
            );


        const luckyResult =
            await client.query(
                `
                SELECT
                    rolled_at
                FROM lucky_rolls
                WHERE user_id = $1
                ORDER BY rolled_at DESC
                LIMIT 1
                `,
                [userId]
            );


        const config =
            await getLuckyRollConfig(
                client
            );


        const cooldownSeconds =
            config.cooldownSeconds;


        let luckyAvailable = true;

        let nextRollAt = null;

        let remainingSeconds = 0;


        if (
            luckyResult.rowCount > 0
        ) {

            const lastRollAt =
                new Date(
                    luckyResult.rows[0].rolled_at
                ).getTime();


            const nextTime =
                lastRollAt +
                cooldownSeconds * 1000;


            const remaining =
                nextTime -
                Date.now();


            if (remaining > 0) {

                luckyAvailable =
                    false;

                remainingSeconds =
                    Math.ceil(
                        remaining / 1000
                    );

                nextRollAt =
                    new Date(
                        nextTime
                    );
            }
        }


        /*
        Check whether a verified ad is waiting.

        This is useful for frontend status/debugging.
        */

        const verifiedAdsResult =
            await client.query(
                `
                SELECT
                    ad_type,
                    COUNT(*)::int AS count
                FROM ad_rewards
                WHERE
                    user_id = $1
                    AND provider = 'adsgram'
                    AND status = 'confirmed'
                    AND consumed_at IS NULL
                    AND confirmed_at >= NOW() -
                        ($2 * INTERVAL '1 second')
                GROUP BY ad_type
                `,
                [
                    userId,
                    AD_INTENT_TTL_SECONDS
                ]
            );


        const verifiedAds = {
            life: 0,
            double_reward: 0,
            lucky_roll: 0
        };


        for (
            const row
            of verifiedAdsResult.rows
        ) {

            if (
                Object.prototype.hasOwnProperty.call(
                    verifiedAds,
                    row.ad_type
                )
            ) {

                verifiedAds[
                    row.ad_type
                ] =
                    Number(row.count);
            }
        }


        return {
            success: true,

            balance:
                Number(user.coins),

            todayCoins:
                Number(user.today_coins),

            lives:
                Number(user.lives),

            dailyBonus: {

                reward:
                    await getDailyBonusAmount(
                        client
                    ),

                claimed:
                    dailyClaimed,

                streak:
                    Number(
                        user.daily_streak
                    )
            },

            luckyRoll: {

                available:
                    luckyAvailable,

                cooldownSeconds,

                remainingSeconds,

                nextRollAt
            },

            ads: {

                verified:
                    verifiedAds
            }
        };


    } finally {

        client.release();
    }
}

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
- Server controlled

LUCKY ROLL
- One roll every 5 minutes
- Number: 1 - 99,999
- Server generates number
- Server calculates reward

LUCKY PAYOUT
1 - 89,999       = +5
90,000 - 94,999  = +8
95,000 - 99,499  = +12
99,500 - 99,996  = +18
99,997 - 99,998  = +82
99,999            = +10,000

ADS
- Provider: AdsGram
- Server creates ad intent
- AdsGram Reward URL confirms intent
- Confirmation does not directly give coins
- Confirmed ad can be consumed only once

AD TYPES
- life
- double_reward
- lucky_roll

LIFE
- Maximum 5
- Ad gives +1 life

DOUBLE REWARD
- Must belong to a completed game session
- Same ad can only be consumed once
- Server gives additional base reward
- Client cannot choose reward amount

SECURITY
- Server controls all rewards
- Server controls Lucky Roll number
- Server controls balance
- User rows are locked during balance changes
- Transactions protect multi-step operations
=========================================================
*/


/*
=========================================================
CONFIG
=========================================================
*/

const DEFAULT_DAILY_BONUS = 100;

const DEFAULT_LUCKY_COOLDOWN_SECONDS = 300;

const DEFAULT_LUCKY_MIN = 1;

const DEFAULT_LUCKY_MAX = 99999;

const MAX_LIVES = 5;

const AD_INTENT_TTL_SECONDS = 10 * 60;


/*
=========================================================
GAME REWARDS
=========================================================
*/

const GAME_REWARDS = {
    easy: 10,
    medium: 12,
    hard: 15
};


/*
=========================================================
AD TYPES
=========================================================
*/

const ALLOWED_AD_TYPES = new Set([
    "life",
    "double_reward",
    "lucky_roll"
]);


/*
=========================================================
CAMBODIA DATE
=========================================================
*/

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


/*
=========================================================
APP SETTINGS
=========================================================
*/

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


/*
=========================================================
LOCK USER
=========================================================
*/

async function lockUser(client, userId) {

    const result = await client.query(
        `
        SELECT
            id,
            telegram_id,
            coins,
            today_coins,
            lives,
            daily_streak,
            last_daily_claim,
            last_life_at,
            is_blocked
        FROM users
        WHERE id = $1
        FOR UPDATE
        `,
        [userId]
    );

    if (result.rowCount === 0) {

        const error =
            new Error("USER_NOT_FOUND");

        error.code = "USER_NOT_FOUND";

        throw error;
    }

    const user = result.rows[0];

    if (user.is_blocked) {

        const error =
            new Error("USER_BLOCKED");

        error.code = "USER_BLOCKED";

        throw error;
    }

    return user;
}


/*
=========================================================
DAILY BONUS
=========================================================
*/

async function getDailyBonusAmount(client) {

    const economy =
        await getSetting(
            client,
            "economy"
        );

    const reward =
        Number(
            economy?.daily_bonus
        );

    if (
        Number.isSafeInteger(reward) &&
        reward > 0
    ) {
        return reward;
    }

    return DEFAULT_DAILY_BONUS;
}


/*
=========================================================
LUCKY CONFIG
=========================================================
*/

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


async function getLuckyRollConfig(client) {

    const setting =
        await getSetting(
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

    minimum =
        Math.max(
            DEFAULT_LUCKY_MIN,
            Math.min(
                DEFAULT_LUCKY_MAX,
                minimum
            )
        );

    maximum =
        Math.max(
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
        typeof setting.rewards === "object" &&
        !Array.isArray(setting.rewards)
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


/*
=========================================================
SAFE REWARD
=========================================================
*/

function safeReward(value, fallback) {

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


/*
=========================================================
LUCKY REWARD
=========================================================
*/

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


/*
=========================================================
VALIDATE AD TYPE
=========================================================
*/

function validateAdType(adType) {

    if (!ALLOWED_AD_TYPES.has(adType)) {

        const error =
            new Error("INVALID_AD_TYPE");

        error.code =
            "INVALID_AD_TYPE";

        throw error;
    }

    return adType;
}


/*
=========================================================
VALIDATE UUID
=========================================================
*/

function validateGameSessionId(gameSessionId) {

    if (
        gameSessionId === null ||
        gameSessionId === undefined
    ) {
        return null;
    }

    if (
        typeof gameSessionId !== "string"
    ) {

        const error =
            new Error(
                "INVALID_GAME_SESSION"
            );

        error.code =
            "INVALID_GAME_SESSION";

        throw error;
    }

    const value =
        gameSessionId.trim();

    if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(value)
    ) {

        const error =
            new Error(
                "INVALID_GAME_SESSION"
            );

        error.code =
            "INVALID_GAME_SESSION";

        throw error;
    }

    return value;
}


/*
=========================================================
CREATE ADSGRAM AD INTENT
=========================================================
*/

export async function createAdRewardIntent(
    userId,
    adType,
    metadata = {}
) {

    validateAdType(adType);

    const safeMetadata =
        metadata &&
        typeof metadata === "object" &&
        !Array.isArray(metadata)
            ? metadata
            : {};

    let gameSessionId = null;

    if (adType === "double_reward") {

        gameSessionId =
            validateGameSessionId(
                safeMetadata.gameSessionId
            );

        if (!gameSessionId) {

            const error =
                new Error(
                    "GAME_SESSION_REQUIRED"
                );

            error.code =
                "GAME_SESSION_REQUIRED";

            throw error;
        }
    }

    const client =
        await pool.connect();

    try {

        await client.query("BEGIN");

        await lockUser(
            client,
            userId
        );


        /*
        For Double Reward, verify that the game
        session exists and belongs to this user.
        */

        if (adType === "double_reward") {

            const sessionResult =
                await client.query(
                    `
                    SELECT
                        id,
                        status,
                        user_id
                    FROM game_sessions
                    WHERE
                        id = $1
                        AND user_id = $2
                    LIMIT 1
                    `,
                    [
                        gameSessionId,
                        userId
                    ]
                );

            if (
                sessionResult.rowCount === 0
            ) {

                const error =
                    new Error(
                        "GAME_SESSION_NOT_FOUND"
                    );

                error.code =
                    "GAME_SESSION_NOT_FOUND";

                throw error;
            }

            /*
            Double Reward must only be created
            for a completed game.
            */

            if (
                sessionResult.rows[0].status !==
                "completed"
            ) {

                const error =
                    new Error(
                        "GAME_NOT_COMPLETED"
                    );

                error.code =
                    "GAME_NOT_COMPLETED";

                throw error;
            }
        }


        const params = [
            userId,
            adType,
            AD_INTENT_TTL_SECONDS
        ];

        let sessionCondition = "";

        if (
            adType === "double_reward"
        ) {

            params.push(
                gameSessionId
            );

            sessionCondition = `
                AND metadata->>'gameSessionId' = $4
            `;
        }


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
                    ${sessionCondition}
                ORDER BY created_at DESC
                LIMIT 1
                `,
                params
            );


        if (
            existingResult.rowCount > 0
        ) {

            const existing =
                existingResult.rows[0];

            await client.query("COMMIT");

            return {
                success: true,
                reused: true,
                intentId: existing.id,
                adType,
                provider: "adsgram",
                gameSessionId:
                    adType === "double_reward"
                        ? gameSessionId
                        : null,
                expiresAt:
                    new Date(
                        new Date(
                            existing.created_at
                        ).getTime() +
                        AD_INTENT_TTL_SECONDS * 1000
                    )
            };
        }


        const intentId =
            crypto.randomUUID();


        const intentMetadata = {
            ...safeMetadata,

            intentId,

            createdBy:
                "memory-card-backend",

            createdAt:
                new Date().toISOString()
        };


        if (
            adType === "double_reward"
        ) {

            intentMetadata.gameSessionId =
                gameSessionId;
        }


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


        await client.query("COMMIT");


        return {
            success: true,
            reused: false,
            intentId,
            adType,
            provider: "adsgram",
            gameSessionId:
                adType === "double_reward"
                    ? gameSessionId
                    : null,
            expiresAt:
                new Date(
                    Date.now() +
                    AD_INTENT_TTL_SECONDS * 1000
                )
        };


    } catch (error) {

        try {
            await client.query("ROLLBACK");
        } catch {}

        throw error;

    } finally {

        client.release();

    }

}


/*
=========================================================
CONFIRM ADSGRAM REWARD
=========================================================

Reward URL confirms an EXISTING intent.

It does not create a reward from nothing.
=========================================================
*/

export async function confirmAdsgramReward(
    telegramId,
    adType = null
) {

    const normalizedTelegramId =
        String(
            telegramId ?? ""
        ).trim();

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

        await client.query("BEGIN");


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
                [
                    normalizedTelegramId
                ]
            );


        if (
            userResult.rowCount === 0
        ) {

            await client.query("ROLLBACK");

            return {
                success: false,
                error: "USER_NOT_FOUND"
            };
        }


        const user =
            userResult.rows[0];


        if (user.is_blocked) {

            await client.query("ROLLBACK");

            return {
                success: false,
                error: "USER_BLOCKED"
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


        if (
            intentResult.rowCount === 0
        ) {

            await client.query("ROLLBACK");

            return {
                success: false,
                error: "NO_PENDING_AD"
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
                    AND consumed_at IS NULL

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


        await client.query("COMMIT");


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
            await client.query("ROLLBACK");
        } catch {}

        throw error;

    } finally {

        client.release();

    }

}


/*
=========================================================
CONSUME VERIFIED AD
=========================================================
*/

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
                confirmed_at
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


    if (
        result.rowCount === 0
    ) {

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


/*
=========================================================
CLAIM AD LIFE
=========================================================
*/

export async function claimAdLife(
    userId
) {

    const client =
        await pool.connect();

    try {

        await client.query("BEGIN");


        /*
        First lock the user.
        */

        let user =
            await lockUser(
                client,
                userId
            );


        /*
        Recover naturally available lives first.

        This prevents stale life values.
        */

        const currentLives =
            Math.max(
                0,
                Math.min(
                    MAX_LIVES,
                    Number(user.lives)
                )
            );


        if (
            currentLives >= MAX_LIVES
        ) {

            await client.query("ROLLBACK");

            return {
                success: false,
                error: "MAX_LIVES",
                message:
                    "You already have the maximum number of lives.",
                lives: MAX_LIVES
            };
        }


        /*
        Consume verified ad.
        */

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


        await client.query("COMMIT");


        return {
            success: true,

            reward: 1,

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
            await client.query("ROLLBACK");
        } catch {}

        throw error;

    } finally {

        client.release();

    }

}


/*
=========================================================
CLAIM DAILY BONUS
=========================================================
*/

export async function claimDailyBonus(
    userId
) {

    const client =
        await pool.connect();

    try {

        await client.query("BEGIN");


        const user =
            await lockUser(
                client,
                userId
            );


        const today =
            getPhnomPenhDate();


        const lastClaim =
            user.last_daily_claim
                ? String(
                    user.last_daily_claim
                )
                : null;


        if (
            lastClaim === today
        ) {

            await client.query("ROLLBACK");

            return {
                success: false,
                error: "ALREADY_CLAIMED",
                message:
                    "Daily bonus has already been claimed today.",
                coins:
                    Number(user.coins),
                streak:
                    Number(user.daily_streak),
                claimDate: today
            };
        }


        const reward =
            await getDailyBonusAmount(
                client
            );


        let newStreak = 1;


        if (lastClaim) {

            const previousDate =
                new Date(
                    `${lastClaim}T00:00:00+07:00`
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


            if (
                difference === 1
            ) {

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
                    id
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
                    coins =
                        coins + $1,

                    today_coins =
                        today_coins + $1,

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


        const updated =
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
                Number(updated.coins),
                claim.id,
                `Daily bonus day ${newStreak}`
            ]
        );


        await client.query("COMMIT");


        return {
            success: true,

            reward,

            balance:
                Number(
                    updated.coins
                ),

            todayCoins:
                Number(
                    updated.today_coins
                ),

            streak:
                Number(
                    updated.daily_streak
                ),

            claimDate:
                String(
                    updated.last_daily_claim
                ),

            dayNumber:
                newStreak
        };


    } catch (error) {

        try {
            await client.query("ROLLBACK");
        } catch {}

        throw error;

    } finally {

        client.release();

    }

}


/*
=========================================================
LUCKY ROLL
=========================================================
*/

export async function luckyRoll(
    userId
) {

    const client =
        await pool.connect();

    try {

        await client.query("BEGIN");


        const user =
            await lockUser(
                client,
                userId
            );


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


        const lastRollResult =
            await client.query(
                `
                SELECT
                    id,
                    rolled_at
                FROM lucky_rolls
                WHERE user_id = $1
                ORDER BY rolled_at DESC
                LIMIT 1
                `,
                [userId]
            );


        if (
            lastRollResult.rowCount > 0
        ) {

            const lastRollAt =
                new Date(
                    lastRollResult.rows[0].rolled_at
                ).getTime();

            const nextTime =
                lastRollAt +
                cooldownSeconds * 1000;

            const now =
                Date.now();


            if (
                now < nextTime
            ) {

                const remainingSeconds =
                    Math.ceil(
                        (
                            nextTime - now
                        ) / 1000
                    );


                await client.query("ROLLBACK");


                return {
                    success: false,

                    error: "COOLDOWN",

                    message:
                        "Lucky Roll is still on cooldown.",

                    remainingSeconds,

                    nextRollAt:
                        new Date(nextTime)
                };
            }
        }


        /*
        Verified ad is consumed only after cooldown
        succeeds.
        */

        const ad =
            await consumeVerifiedAd(
                client,
                userId,
                "lucky_roll"
            );


        /*
        Server-side random number.
        */

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
                    coins =
                        coins + $1,

                    today_coins =
                        today_coins + $1,

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


        const updated =
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
                Number(updated.coins),
                roll.id,
                `Lucky Roll ${rollNumber}`
            ]
        );


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
                    appliedTo: "lucky_roll",
                    luckyRollId: roll.id
                }),
                ad.rewardId
            ]
        );


        await client.query("COMMIT");


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
                id: roll.id,

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
                    updated.coins
                ),

            todayCoins:
                Number(
                    updated.today_coins
                ),

            cooldownSeconds,

            nextRollAt:
                nextRoll
        };


    } catch (error) {

        try {
            await client.query("ROLLBACK");
        } catch {}

        throw error;

    } finally {

        client.release();

    }

}


/*
=========================================================
CONSUME DOUBLE REWARD AD
=========================================================

This function ONLY consumes the verified ad.

It does NOT change the user's balance.

Use claimDoubleGameReward() below when the actual
additional reward should be granted.
=========================================================
*/

export async function consumeDoubleGameRewardAd(
    client,
    userId,
    gameSessionId
) {

    const normalizedGameSessionId =
        validateGameSessionId(
            gameSessionId
        );


    if (!normalizedGameSessionId) {

        const error =
            new Error(
                "GAME_SESSION_REQUIRED"
            );

        error.code =
            "GAME_SESSION_REQUIRED";

        throw error;
    }


    /*
    Lock and verify the game session.

    It MUST already be completed.
    */

    const sessionResult =
        await client.query(
            `
            SELECT
                id,
                user_id,
                difficulty,
                level,
                reward_coins,
                status
            FROM game_sessions
            WHERE
                id = $1
                AND user_id = $2
            FOR UPDATE
            `,
            [
                normalizedGameSessionId,
                userId
            ]
        );


    if (
        sessionResult.rowCount === 0
    ) {

        const error =
            new Error(
                "GAME_SESSION_NOT_FOUND"
            );

        error.code =
            "GAME_SESSION_NOT_FOUND";

        throw error;
    }


    const session =
        sessionResult.rows[0];


    if (
        session.status !== "completed"
    ) {

        const error =
            new Error(
                "GAME_NOT_COMPLETED"
            );

        error.code =
            "GAME_NOT_COMPLETED";

        throw error;
    }


    /*
    Server validates the reward again.
    */

    const expectedReward =
        GAME_REWARDS[
            session.difficulty
        ];


    const sessionReward =
        Number(
            session.reward_coins
        );


    if (
        !expectedReward ||
        sessionReward !== expectedReward
    ) {

        const error =
            new Error(
                "INVALID_GAME_REWARD"
            );

        error.code =
            "INVALID_GAME_REWARD";

        throw error;
    }


    /*
    Find confirmed ad tied to THIS game.
    */

    const adResult =
        await client.query(
            `
            SELECT
                id,
                ad_type,
                confirmed_at
            FROM ad_rewards
            WHERE
                user_id = $1
                AND provider = 'adsgram'
                AND ad_type = 'double_reward'
                AND status = 'confirmed'
                AND consumed_at IS NULL
                AND confirmed_at >= NOW() -
                    ($2 * INTERVAL '1 second')
                AND metadata->>'gameSessionId' = $3
            ORDER BY confirmed_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            `,
            [
                userId,
                AD_INTENT_TTL_SECONDS,
                normalizedGameSessionId
            ]
        );


    if (
        adResult.rowCount === 0
    ) {

        const error =
            new Error(
                "VERIFIED_AD_REQUIRED"
            );

        error.code =
            "VERIFIED_AD_REQUIRED";

        throw error;
    }


    const ad =
        adResult.rows[0];


    /*
    Consume the ad atomically.
    */

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
                consumed_at
            `,
            [
                JSON.stringify({
                    consumedBy:
                        "double_game_reward",

                    gameSessionId:
                        normalizedGameSessionId
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

        gameSessionId:
            normalizedGameSessionId,

        additionalReward:
            expectedReward,

        consumedAt:
            consumedResult.rows[0].consumed_at
    };

}


/*
=========================================================
CLAIM DOUBLE GAME REWARD
=========================================================

Normal game:
    +10

Watch verified ad:
    +10 additional

Final:
    +20

The additional reward is calculated ONLY from the
server-side game session.

Client cannot submit:
    reward = 1000
    multiplier = 999
=========================================================
*/

export async function claimDoubleGameReward(
    userId,
    gameSessionId
) {

    const normalizedGameSessionId =
        validateGameSessionId(
            gameSessionId
        );


    if (!normalizedGameSessionId) {

        const error =
            new Error(
                "GAME_SESSION_REQUIRED"
            );

        error.code =
            "GAME_SESSION_REQUIRED";

        throw error;
    }


    const client =
        await pool.connect();

    try {

        await client.query("BEGIN");


        const user =
            await lockUser(
                client,
                userId
            );


        /*
        Consume and validate the ad.
        */

        const ad =
            await consumeDoubleGameRewardAd(
                client,
                userId,
                normalizedGameSessionId
            );


        const balanceBefore =
            Number(user.coins);


        if (
            !Number.isSafeInteger(balanceBefore) ||
            balanceBefore < 0
        ) {

            throw new Error(
                "INVALID_USER_BALANCE"
            );
        }


        const additionalReward =
            Number(
                ad.additionalReward
            );


        const balanceAfter =
            balanceBefore +
            additionalReward;


        /*
        Add ONLY the additional base reward.
        */

        const updateResult =
            await client.query(
                `
                UPDATE users
                SET
                    coins =
                        coins + $1,

                    today_coins =
                        today_coins + $1,

                    updated_at = NOW()

                WHERE id = $2

                RETURNING
                    coins,
                    today_coins,
                    lives,
                    games_played
                `,
                [
                    additionalReward,
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


        const updated =
            updateResult.rows[0];


        /*
        Record the additional reward.
        */

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
                'double_game_reward',
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

                additionalReward,

                balanceBefore,

                Number(
                    updated.coins
                ),

                normalizedGameSessionId,

                `Double reward for ${normalizedGameSessionId}`
            ]
        );


        await client.query("COMMIT");


        return {
            success: true,

            reward:
                additionalReward,

            baseReward:
                additionalReward,

            multiplier:
                2,

            additionalReward,

            gameSessionId:
                normalizedGameSessionId,

            balance:
                Number(
                    updated.coins
                ),

            todayCoins:
                Number(
                    updated.today_coins
                ),

            lives:
                Number(
                    updated.lives
                ),

            gamesPlayed:
                Number(
                    updated.games_played
                ),

            adRewardId:
                ad.rewardId
        };


    } catch (error) {

        try {
            await client.query("ROLLBACK");
        } catch {}

        throw error;

    } finally {

        client.release();

    }

}


/*
=========================================================
REWARD STATUS
=========================================================
*/

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
                    lives,
                    is_blocked
                FROM users
                WHERE id = $1
                LIMIT 1
                `,
                [userId]
            );


        if (
            userResult.rowCount === 0
        ) {

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


            if (
                remaining > 0
            ) {

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
                    Number(
                        row.count
                    );
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

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

SECURITY
- Browser NEVER chooses reward
- Browser NEVER chooses roll number
- User balance is locked with FOR UPDATE
- Coin changes happen inside transactions

IMPORTANT
---------------------------------------------------------
The current adCompleted parameter is only a temporary
server-side gate.

It is NOT proof that an AdsGram ad was actually watched.

Before production, this must be replaced with real
server-side AdsGram reward verification.
=========================================================
*/


/* =========================================================
   DEFAULT CONFIG
========================================================= */

const DEFAULT_DAILY_BONUS = 100;

const DEFAULT_LUCKY_COOLDOWN_SECONDS = 300;

const DEFAULT_LUCKY_MIN = 1;

const DEFAULT_LUCKY_MAX = 99999;


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

    const defaults = getDefaultLuckyRewards();

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


    /*
    ---------------------------------------------------------
    FORCE SAFE LUCKY RANGE
    ---------------------------------------------------------
    */

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


    /*
    If configuration is reversed,
    use the complete valid range.
    */

    if (minimum > maximum) {
        minimum = DEFAULT_LUCKY_MIN;
        maximum = DEFAULT_LUCKY_MAX;
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

    const number = Number(
        rollNumber
    );


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
   SAFE REWARD VALUE
========================================================= */

function safeReward(
    value,
    fallback
) {

    const number = Number(value);

    if (
        Number.isSafeInteger(number) &&
        number >= 0
    ) {
        return number;
    }

    return fallback;
}


/* =========================================================
   DAILY BONUS
========================================================= */

export async function claimDailyBonus(
    userId
) {

    const client = await pool.connect();

    try {

        await client.query("BEGIN");


        /* -------------------------------------------------
           LOCK USER
        ------------------------------------------------- */

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


        /* -------------------------------------------------
           TODAY IN CAMBODIA
        ------------------------------------------------- */

        const today =
            getPhnomPenhDate();


        /* -------------------------------------------------
           ALREADY CLAIMED
        ------------------------------------------------- */

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
                error: "ALREADY_CLAIMED",
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


        /* -------------------------------------------------
           GET REWARD
        ------------------------------------------------- */

        const reward =
            await getDailyBonusAmount(
                client
            );


        if (reward <= 0) {
            throw new Error(
                "DAILY_BONUS_DISABLED"
            );
        }


        /* -------------------------------------------------
           CALCULATE STREAK
        ------------------------------------------------- */

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


        /* -------------------------------------------------
           BALANCES
        ------------------------------------------------- */

        const balanceBefore =
            Number(user.coins);

        const balanceAfter =
            balanceBefore + reward;


        /* -------------------------------------------------
           CLAIM RECORD
        ------------------------------------------------- */

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


        /* -------------------------------------------------
           UPDATE USER
        ------------------------------------------------- */

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


        if (userUpdate.rowCount === 0) {
            throw new Error(
                "USER_UPDATE_FAILED"
            );
        }


        const updatedUser =
            userUpdate.rows[0];


        /* -------------------------------------------------
           COIN TRANSACTION
        ------------------------------------------------- */

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


        await client.query("COMMIT");


        return {
            success: true,
            reward,
            balance:
                Number(updatedUser.coins),
            todayCoins:
                Number(updatedUser.today_coins),
            streak:
                Number(updatedUser.daily_streak),
            claimDate:
                String(
                    updatedUser.last_daily_claim
                ),
            dayNumber:
                newStreak
        };


    } catch (error) {

        try {
            await client.query("ROLLBACK");
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
    userId,
    adCompleted
) {

    const client = await pool.connect();

    try {

        await client.query("BEGIN");


        /* -------------------------------------------------
           TEMPORARY AD GATE
        -------------------------------------------------

        IMPORTANT:
        This does NOT verify AdsGram.

        It only keeps the existing API contract working.

        Production must replace this with a verified
        server-side ad reward.
        ------------------------------------------------- */

        if (adCompleted !== true) {

            await client.query(
                "ROLLBACK"
            );

            return {
                success: false,
                error: "AD_REQUIRED",
                message:
                    "You must complete the rewarded ad before Lucky Roll."
            };
        }


        /* -------------------------------------------------
           LOCK USER
        ------------------------------------------------- */

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


        /* -------------------------------------------------
           LOAD CONFIG
        ------------------------------------------------- */

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
           LAST ROLL
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
                            nextTime - now
                        ) / 1000
                    );


                await client.query(
                    "ROLLBACK"
                );


                return {
                    success: false,
                    error: "COOLDOWN",
                    message:
                        "Lucky Roll is still on cooldown.",
                    remainingSeconds,
                    nextRollAt
                };
            }
        }


        /* -------------------------------------------------
           SERVER-SIDE RANDOM NUMBER
        ------------------------------------------------- */

        const rollNumber =
            crypto.randomInt(
                minimum,
                maximum + 1
            );


        /* -------------------------------------------------
           SERVER-SIDE REWARD
        ------------------------------------------------- */

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


        /* -------------------------------------------------
           BALANCES
        ------------------------------------------------- */

        const balanceBefore =
            Number(user.coins);

        const balanceAfter =
            balanceBefore + reward;


        /* -------------------------------------------------
           SAVE ROLL
        ------------------------------------------------- */

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


        /* -------------------------------------------------
           UPDATE USER
        ------------------------------------------------- */

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


        if (updatedResult.rowCount === 0) {
            throw new Error(
                "USER_UPDATE_FAILED"
            );
        }


        const updatedUser =
            updatedResult.rows[0];


        /* -------------------------------------------------
           COIN TRANSACTION
        ------------------------------------------------- */

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

    const client = await pool.connect();

    try {

        const today =
            getPhnomPenhDate();


        /* -------------------------------------------------
           USER
        ------------------------------------------------- */

        const userResult =
            await client.query(
                `
                SELECT
                    coins,
                    today_coins,
                    daily_streak,
                    last_daily_claim
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


        /* -------------------------------------------------
           DAILY STATUS
        ------------------------------------------------- */

        const dailyClaimed =
            Boolean(
                user.last_daily_claim &&
                String(
                    user.last_daily_claim
                ) === today
            );


        /* -------------------------------------------------
           LUCKY STATUS
        ------------------------------------------------- */

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

                luckyAvailable = false;

                remainingSeconds =
                    Math.ceil(
                        remaining / 1000
                    );

                nextRollAt =
                    new Date(nextTime);
            }
        }


        return {
            success: true,

            balance:
                Number(user.coins),

            todayCoins:
                Number(user.today_coins),

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
            }
        };


    } finally {

        client.release();
    }
}

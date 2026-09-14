import crypto from "crypto";
import pool from "../db/pool.js";

/*

MEMORY COINS
REWARDS SERVICE

Features:

1. Daily Bonus
   
   - Default reward: 100 coins
   - Once per calendar day
   - Uses Asia/Phnom_Penh date
   - Tracks daily streak

2. Lucky Roll
   
   - One roll every 5 minutes
   - Number: 1 - 99,999
   - Reward calculated SERVER-SIDE
   - Requires adCompleted = true
   - Uses PostgreSQL row locking
   - Prevents double rewards from concurrent requests

IMPORTANT:

The browser NEVER decides how many coins to award.

All coin changes happen inside PostgreSQL transactions.

============================================================
*/

/*

CONFIGURATION

*/

const DEFAULT_DAILY_BONUS = 100;

const DEFAULT_LUCKY_COOLDOWN_SECONDS = 300;

const DEFAULT_LUCKY_MIN = 1;

const DEFAULT_LUCKY_MAX = 99999;

/*

HELPERS

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
).format(
    new Date()
);

}

/*

LOAD APP SETTING

*/

async function getSetting(
client,
key
) {

const result =
    await client.query(
        `
        SELECT
            value
        FROM app_settings
        WHERE key = $1
        LIMIT 1
        `,
        [key]
    );

if (
    result.rows.length === 0
) {

    return null;

}

return result.rows[0].value;

}

/*

GET DAILY BONUS CONFIG

*/

async function getDailyBonusAmount(
client
) {

const economy =
    await getSetting(
        client,
        "economy"
    );

if (
    economy &&
    Number.isFinite(
        Number(
            economy.daily_bonus
        )
    )
) {

    return Math.max(
        0,
        Math.floor(
            Number(
                economy.daily_bonus
            )
        )
    );

}

return DEFAULT_DAILY_BONUS;

}

/*

GET LUCKY ROLL CONFIG

*/

async function getLuckyRollConfig(
client
) {

const setting =
    await getSetting(
        client,
        "lucky_roll"
    );

if (!setting) {

    return {

        cooldownSeconds:
            DEFAULT_LUCKY_COOLDOWN_SECONDS,

        minimum:
            DEFAULT_LUCKY_MIN,

        maximum:
            DEFAULT_LUCKY_MAX,

        rewards: {

            default: 5,

            "90000": 8,

            "95000": 12,

            "99500": 18,

            "99997": 82,

            "99999": 10000

        }

    };

}

return {

    cooldownSeconds:
        Number(
            setting.cooldown_seconds ??
            DEFAULT_LUCKY_COOLDOWN_SECONDS
        ),

    minimum:
        Number(
            setting.minimum ??
            DEFAULT_LUCKY_MIN
        ),

    maximum:
        Number(
            setting.maximum ??
            DEFAULT_LUCKY_MAX
        ),

    rewards:
        setting.rewards || {

            default: 5,

            "90000": 8,

            "95000": 12,

            "99500": 18,

            "99997": 82,

            "99999": 10000

        }

};

}

/*

CALCULATE LUCKY ROLL REWARD

Current rules:

1 - 89,999
+5 coins

90,000 - 94,999
+8 coins

95,000 - 99,499
+12 coins

99,500 - 99,996
+18 coins

99,997 - 99,998
+82 coins

99,999
+10,000 coins

============================================================
*/

function calculateLuckyReward(
rollNumber,
rewards
) {

const number =
    Number(rollNumber);

if (
    number === 99999
) {

    return Number(
        rewards["99999"] ?? 10000
    );

}

if (
    number >= 99997
) {

    return Number(
        rewards["99997"] ?? 82
    );

}

if (
    number >= 99500
) {

    return Number(
        rewards["99500"] ?? 18
    );

}

if (
    number >= 95000
) {

    return Number(
        rewards["95000"] ?? 12
    );

}

if (
    number >= 90000
) {

    return Number(
        rewards["90000"] ?? 8
    );

}

return Number(
    rewards.default ?? 5
);

}

/*

DAILY BONUS

POST /api/rewards/daily

Rules:

- One claim per calendar day
- +100 coins
- Daily streak is maintained
- Transaction is atomic
- Duplicate requests cannot award twice

============================================================
*/

export async function claimDailyBonus(
userId
) {

const client =
    await pool.connect();

try {

    await client.query(
        "BEGIN"
    );


    /*
    --------------------------------------------------------
    LOCK USER
    --------------------------------------------------------
    */

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


    if (
        userResult.rows.length === 0
    ) {

        throw new Error(
            "User not found."
        );

    }


    const user =
        userResult.rows[0];


    /*
    --------------------------------------------------------
    TODAY IN CAMBODIA TIME
    --------------------------------------------------------
    */

    const today =
        getPhnomPenhDate();


    /*
    --------------------------------------------------------
    CHECK ALREADY CLAIMED
    --------------------------------------------------------
    */

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
                Number(
                    user.coins
                ),

            streak:
                Number(
                    user.daily_streak
                ),

            claimDate:
                today

        };

    }


    /*
    --------------------------------------------------------
    GET DAILY BONUS AMOUNT
    --------------------------------------------------------
    */

    const reward =
        await getDailyBonusAmount(
            client
        );


    if (
        reward <= 0
    ) {

        throw new Error(
            "Daily bonus is disabled."
        );

    }


    /*
    --------------------------------------------------------
    CALCULATE STREAK
    --------------------------------------------------------
    */

    let newStreak = 1;


    if (
        user.last_daily_claim
    ) {

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
                (
                    24 *
                    60 *
                    60 *
                    1000
                )
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


    /*
    --------------------------------------------------------
    BALANCE BEFORE
    --------------------------------------------------------
    */

    const balanceBefore =
        Number(
            user.coins
        );


    /*
    --------------------------------------------------------
    ADD COINS
    --------------------------------------------------------
    */

    const balanceAfter =
        balanceBefore +
        reward;


    /*
    --------------------------------------------------------
    CREATE CLAIM RECORD
    --------------------------------------------------------
    */

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


    /*
    --------------------------------------------------------
    UPDATE USER BALANCE
    --------------------------------------------------------
    */

    const userUpdate =
        await client.query(
            `
            UPDATE users
            SET
                coins =
                    coins + $1,

                today_coins =
                    today_coins + $1,

                daily_streak =
                    $2,

                last_daily_claim =
                    $3

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
        userUpdate.rows.length === 0
    ) {

        throw new Error(
            "Unable to update user balance."
        );

    }


    const updatedUser =
        userUpdate.rows[0];


    /*
    --------------------------------------------------------
    RECORD COIN TRANSACTION
    --------------------------------------------------------
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
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            NOW()
        )
        `,
        [
            userId,

            "daily_bonus",

            reward,

            balanceBefore,

            balanceAfter,

            claim.id,

            `Daily bonus day ${newStreak}`
        ]
    );


    /*
    --------------------------------------------------------
    COMMIT
    --------------------------------------------------------
    */

    await client.query(
        "COMMIT"
    );


    return {

        success: true,

        reward: reward,

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

    await client.query(
        "ROLLBACK"
    );

    throw error;

} finally {

    client.release();

}

}

/*

LUCKY ROLL

POST /api/rewards/lucky-roll

Request:

{
"adCompleted": true
}

The server generates the number.

The browser CANNOT choose:

99999
10000
reward amount
roll number

============================================================
*/

export async function luckyRoll(
userId,
adCompleted
) {

const client =
    await pool.connect();

try {

    await client.query(
        "BEGIN"
    );


    /*
    --------------------------------------------------------
    AD CHECK
    --------------------------------------------------------
    */

    if (
        adCompleted !== true
    ) {

        await client.query(
            "ROLLBACK"
        );

        return {

            success: false,

            error:
                "AD_REQUIRED",

            message:
                "You must complete the rewarded ad before Lucky Roll."

        };

    }


    /*
    --------------------------------------------------------
    LOCK USER
    --------------------------------------------------------
    */

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


    if (
        userResult.rows.length === 0
    ) {

        throw new Error(
            "User not found."
        );

    }


    const user =
        userResult.rows[0];


    /*
    --------------------------------------------------------
    LOAD CONFIG
    --------------------------------------------------------
    */

    const config =
        await getLuckyRollConfig(
            client
        );


    const cooldownSeconds =
        Math.max(
            1,
            Math.floor(
                config.cooldownSeconds
            )
        );


    const minimum =
        Math.max(
            1,
            Math.floor(
                config.minimum
            )
        );


    const maximum =
        Math.min(
            99999,
            Math.floor(
                config.maximum
            )
        );


    /*
    --------------------------------------------------------
    GET LAST ROLL
    --------------------------------------------------------
    */

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
        lastRollResult.rows.length > 0
    ) {

        const lastRoll =
            lastRollResult.rows[0];


        const lastRollTime =
            new Date(
                lastRoll.rolled_at
            ).getTime();


        const nextTime =
            lastRollTime +
            (
                cooldownSeconds *
                1000
            );


        const now =
            Date.now();


        if (
            now < nextTime
        ) {

            nextRollAt =
                new Date(
                    nextTime
                );


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
    --------------------------------------------------------
    SERVER-SIDE RANDOM NUMBER
    --------------------------------------------------------
    */

    const rollNumber =
        crypto.randomInt(
            minimum,
            maximum + 1
        );


    /*
    --------------------------------------------------------
    CALCULATE SERVER-SIDE REWARD
    --------------------------------------------------------
    */

    const reward =
        calculateLuckyReward(
            rollNumber,
            config.rewards
        );


    /*
    --------------------------------------------------------
    BALANCE BEFORE
    --------------------------------------------------------
    */

    const balanceBefore =
        Number(
            user.coins
        );


    const balanceAfter =
        balanceBefore +
        reward;


    /*
    --------------------------------------------------------
    INSERT LUCKY ROLL
    --------------------------------------------------------
    */

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


    /*
    --------------------------------------------------------
    UPDATE USER BALANCE
    --------------------------------------------------------
    */

    const updatedResult =
        await client.query(
            `
            UPDATE users
            SET
                coins =
                    coins + $1,

                today_coins =
                    today_coins + $1

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
        updatedResult.rows.length === 0
    ) {

        throw new Error(
            "Unable to update user balance."
        );

    }


    const updatedUser =
        updatedResult.rows[0];


    /*
    --------------------------------------------------------
    RECORD COIN TRANSACTION
    --------------------------------------------------------
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
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            NOW()
        )
        `,
        [
            userId,

            "lucky_roll",

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
    --------------------------------------------------------
    COMMIT
    --------------------------------------------------------
    */

    await client.query(
        "COMMIT"
    );


    const nextRoll =
        new Date(
            new Date(
                roll.rolled_at
            ).getTime() +
            (
                cooldownSeconds *
                1000
            )
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

    await client.query(
        "ROLLBACK"
    );

    throw error;

} finally {

    client.release();

}

}

/*

GET REWARD STATUS

Useful for the frontend.

Returns:

- daily bonus status
- daily streak
- lucky roll cooldown
- next lucky roll time

============================================================
*/

export async function getRewardStatus(
userId
) {

const client =
    await pool.connect();

try {

    const today =
        getPhnomPenhDate();


    /*
    --------------------------------------------------------
    USER
    --------------------------------------------------------
    */

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


    if (
        userResult.rows.length === 0
    ) {

        throw new Error(
            "User not found."
        );

    }


    const user =
        userResult.rows[0];


    /*
    --------------------------------------------------------
    DAILY STATUS
    --------------------------------------------------------
    */

    const dailyClaimed =
        user.last_daily_claim &&
        String(
            user.last_daily_claim
        ) === today;


    /*
    --------------------------------------------------------
    LAST LUCKY ROLL
    --------------------------------------------------------
    */

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


    let luckyAvailable =
        true;

    let nextRollAt =
        null;

    let remainingSeconds =
        0;


    if (
        luckyResult.rows.length > 0
    ) {

        const lastRollAt =
            new Date(
                luckyResult.rows[0].rolled_at
            ).getTime();


        const nextTime =
            lastRollAt +
            (
                Number(
                    config.cooldownSeconds
                ) *
                1000
            );


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
                    remaining /
                    1000
                );

            nextRollAt =
                new Date(
                    nextTime
                );

        }

    }


    return {

        success: true,

        balance:
            Number(
                user.coins
            ),

        todayCoins:
            Number(
                user.today_coins
            ),

        dailyBonus: {

            reward:
                await getDailyBonusAmount(
                    client
                ),

            claimed:
                Boolean(
                    dailyClaimed
                ),

            streak:
                Number(
                    user.daily_streak
                )

        },

        luckyRoll: {

            available:
                luckyAvailable,

            cooldownSeconds:
                Number(
                    config.cooldownSeconds
                ),

            remainingSeconds,

            nextRollAt

        }

    };

} finally {

    client.release();

}

}

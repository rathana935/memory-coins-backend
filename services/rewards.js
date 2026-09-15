import crypto from "crypto";
import { pool } from "../db/pool.js";


/* =========================================================
   CONFIG
========================================================= */

const DEFAULT_DAILY_BONUS = 100;
const DEFAULT_REFERRAL_REWARD = 250;

const AD_TYPES = [
    "life",
    "double_reward",
    "lucky_roll"
];

const LIFE_AD_REWARD = 1;

const LUCKY_ROLL_COOLDOWN_SECONDS = 300;


/* =========================================================
   HELPERS
========================================================= */

function isUUID(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(value || "")
    );
}


function getCambodiaDate() {

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


function calculateLuckyReward(number) {

    if (number >= 99999) {
        return 10000;
    }

    if (number >= 99997) {
        return 82;
    }

    if (number >= 99500) {
        return 18;
    }

    if (number >= 95000) {
        return 12;
    }

    if (number >= 90000) {
        return 8;
    }

    return 5;
}


function generateLuckyNumber() {

    return crypto.randomInt(
        1,
        100000
    );

}


/* =========================================================
   USER
========================================================= */

async function getUserByTelegramId(
    client,
    telegramId
) {

    const result = await client.query(
        `
        SELECT *
        FROM users
        WHERE telegram_id = $1
        LIMIT 1
        `,
        [String(telegramId)]
    );

    if (!result.rows[0]) {

        const error = new Error(
            "Telegram user not found."
        );

        error.code = "USER_NOT_FOUND";

        throw error;
    }

    return result.rows[0];
}


/* =========================================================
   SERVER SETTINGS
========================================================= */

async function getSetting(
    client,
    key,
    fallback
) {

    const result = await client.query(
        `
        SELECT value
        FROM app_settings
        WHERE key = $1
        LIMIT 1
        `,
        [key]
    );

    if (!result.rows[0]) {
        return fallback;
    }

    return result.rows[0].value;
}


async function getNumberSetting(
    client,
    key,
    fallback
) {

    const value =
        await getSetting(
            client,
            key,
            fallback
        );

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}


/* =========================================================
   AD INTENT
========================================================= */

export async function createAdRewardIntent({
    userId,
    adType,
    gameSessionId = null
}) {

    if (!isUUID(userId)) {

        const error = new Error(
            "Invalid user ID."
        );

        error.code = "INVALID_USER_ID";

        throw error;
    }


    if (!AD_TYPES.includes(adType)) {

        const error = new Error(
            "Invalid ad type."
        );

        error.code = "INVALID_AD_TYPE";

        throw error;
    }


    if (
        adType === "double_reward" &&
        !isUUID(gameSessionId)
    ) {

        const error = new Error(
            "A game session is required for double reward."
        );

        error.code = "GAME_SESSION_REQUIRED";

        throw error;
    }


    const client =
        await pool.connect();

    try {

        await client.query(
            "BEGIN"
        );


        await client.query(
            `
            SELECT id
            FROM users
            WHERE id = $1
            FOR UPDATE
            `,
            [userId]
        );


        if (adType === "double_reward") {

            const session =
                await client.query(
                    `
                    SELECT
                        id,
                        user_id,
                        status
                    FROM game_sessions
                    WHERE id = $1
                    LIMIT 1
                    `,
                    [gameSessionId]
                );


            if (!session.rows[0]) {

                const error = new Error(
                    "Game session not found."
                );

                error.code =
                    "GAME_SESSION_NOT_FOUND";

                throw error;
            }


            if (
                session.rows[0].user_id !== userId
            ) {

                const error = new Error(
                    "Game session does not belong to this user."
                );

                error.code =
                    "GAME_SESSION_FORBIDDEN";

                throw error;
            }


            if (
                session.rows[0].status !==
                "completed"
            ) {

                const error = new Error(
                    "Game must be completed before requesting double reward."
                );

                error.code =
                    "GAME_NOT_COMPLETED";

                throw error;
            }


            /*
             * Do not create duplicate pending intents
             * for the same completed game.
             */

            const existing =
                await client.query(
                    `
                    SELECT *
                    FROM ad_rewards
                    WHERE user_id = $1
                      AND ad_type = 'double_reward'
                      AND status = 'pending'
                      AND metadata->>'gameSessionId' = $2
                    ORDER BY created_at DESC
                    LIMIT 1
                    `,
                    [
                        userId,
                        gameSessionId
                    ]
                );


            if (existing.rows[0]) {

                await client.query(
                    "COMMIT"
                );

                return existing.rows[0];
            }

        }


        const metadata = {
            gameSessionId:
                gameSessionId || null
        };


        const result =
            await client.query(
                `
                INSERT INTO ad_rewards (
                    user_id,
                    provider,
                    ad_type,
                    external_reward_id,
                    reward_coins,
                    status,
                    metadata
                )
                VALUES (
                    $1,
                    'adsgram',
                    $2,
                    NULL,
                    $3,
                    'pending',
                    $4::jsonb
                )
                RETURNING *
                `,
                [
                    userId,
                    adType,
                    adType === "life"
                        ? LIFE_AD_REWARD
                        : 0,
                    JSON.stringify(metadata)
                ]
            );


        await client.query(
            "COMMIT"
        );


        return result.rows[0];

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
   ADSGRAM REWARD URL
=========================================================

   This endpoint confirms that AdsGram called the
   Reward URL for the Telegram user.

   IMPORTANT:
   It does NOT immediately give coins/lives.

   It only changes a matching pending ad reward
   from pending -> confirmed.

========================================================= */

export async function confirmAdsgramReward({
    telegramId,
    adType = "life"
}) {

    if (!telegramId) {

        const error = new Error(
            "Missing Telegram user ID."
        );

        error.code =
            "USER_NOT_FOUND";

        throw error;
    }


    if (!AD_TYPES.includes(adType)) {

        const error = new Error(
            "Invalid ad type."
        );

        error.code =
            "INVALID_AD_TYPE";

        throw error;
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


        /*
         * Find the most recent pending intent.
         *
         * This prevents an old reward from being
         * repeatedly consumed.
         */

        const pending =
            await client.query(
                `
                SELECT *
                FROM ad_rewards
                WHERE user_id = $1
                  AND provider = 'adsgram'
                  AND ad_type = $2
                  AND status = 'pending'
                ORDER BY created_at DESC
                LIMIT 1
                FOR UPDATE
                `,
                [
                    user.id,
                    adType
                ]
            );


        if (!pending.rows[0]) {

            const error = new Error(
                "No pending ad reward."
            );

            error.code =
                "NO_PENDING_AD";

            throw error;
        }


        const reward =
            pending.rows[0];


        const externalRewardId =
            `adsgram:${adType}:${reward.id}`;


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

            const error = new Error(
                "Ad reward was already processed."
            );

            error.code =
                "AD_ALREADY_PROCESSED";

            throw error;
        }


        await client.query(
            "COMMIT"
        );


        return updated.rows[0];

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
   CONSUME VERIFIED AD
========================================================= */

async function consumeVerifiedAd({
    client,
    userId,
    adType,
    gameSessionId = null
}) {

    let query = `
        SELECT *
        FROM ad_rewards
        WHERE user_id = $1
          AND provider = 'adsgram'
          AND ad_type = $2
          AND status = 'confirmed'
          AND consumed_at IS NULL
    `;

    const params = [
        userId,
        adType
    ];


    if (gameSessionId) {

        query += `
            AND metadata->>'gameSessionId' = $3
        `;

        params.push(
            gameSessionId
        );
    }


    query += `
        ORDER BY confirmed_at ASC
        LIMIT 1
        FOR UPDATE
    `;


    const result =
        await client.query(
            query,
            params
        );


    if (!result.rows[0]) {

        const error = new Error(
            "No verified AdsGram reward is available."
        );

        error.code =
            "NO_VERIFIED_AD";

        throw error;
    }


    const ad =
        result.rows[0];


    const consumed =
        await client.query(
            `
            UPDATE ad_rewards
            SET consumed_at = NOW()
            WHERE id = $1
              AND status = 'confirmed'
              AND consumed_at IS NULL
            RETURNING *
            `,
            [ad.id]
        );


    if (!consumed.rows[0]) {

        const error = new Error(
            "Ad reward was already consumed."
        );

        error.code =
            "AD_ALREADY_CONSUMED";

        throw error;
    }


    return consumed.rows[0];
}


/* =========================================================
   LIFE RECOVERY
========================================================= */

async function recoverLives(
    client,
    userId
) {

    const result =
        await client.query(
            `
            SELECT
                id,
                lives,
                last_life_at
            FROM users
            WHERE id = $1
            FOR UPDATE
            `,
            [userId]
        );


    if (!result.rows[0]) {

        const error = new Error(
            "User not found."
        );

        error.code =
            "USER_NOT_FOUND";

        throw error;
    }


    const user =
        result.rows[0];


    let lives =
        Number(user.lives || 0);


    if (
        lives >= 5 ||
        !user.last_life_at
    ) {

        return lives;
    }


    const now =
        Date.now();

    const last =
        new Date(
            user.last_life_at
        ).getTime();


    const elapsed =
        now - last;


    const recovered =
        Math.floor(
            elapsed /
            (60 * 60 * 1000)
        );


    if (recovered <= 0) {

        return lives;
    }


    lives =
        Math.min(
            5,
            lives + recovered
        );


    if (lives >= 5) {

        await client.query(
            `
            UPDATE users
            SET
                lives = 5,
                last_life_at = NULL,
                updated_at = NOW()
            WHERE id = $1
            `,
            [userId]
        );

    } else {

        const newLast =
            new Date(
                last +
                recovered *
                60 *
                60 *
                1000
            );


        await client.query(
            `
            UPDATE users
            SET
                lives = $2,
                last_life_at = $3,
                updated_at = NOW()
            WHERE id = $1
            `,
            [
                userId,
                lives,
                newLast
            ]
        );

    }


    return lives;
}


/* =========================================================
   CLAIM +1 LIFE FROM ADSGRAM
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


        const lives =
            await recoverLives(
                client,
                userId
            );


        if (lives >= 5) {

            const error = new Error(
                "You already have maximum lives."
            );

            error.code =
                "MAX_LIVES";

            throw error;
        }


        const ad =
            await consumeVerifiedAd({
                client,
                userId,
                adType: "life"
            });


        const result =
            await client.query(
                `
                UPDATE users
                SET
                    lives = LEAST(5, lives + 1),
                    updated_at = NOW()
                WHERE id = $1
                RETURNING
                    id,
                    lives,
                    coins
                `,
                [userId]
            );


        await client.query(
            `
            INSERT INTO coin_transactions (
                user_id,
                type,
                amount,
                balance_before,
                balance_after,
                reference_id,
                description
            )
            VALUES (
                $1,
                'ad_reward',
                0,
                $2,
                $2,
                $3,
                'AdsGram rewarded ad: +1 life'
            )
            `,
            [
                userId,
                Number(result.rows[0].coins),
                ad.id
            ]
        );


        await client.query(
            "COMMIT"
        );


        return {
            success: true,
            reward: {
                livesAdded: 1
            },
            lives:
                Number(
                    result.rows[0].lives
                ),
            coins:
                Number(
                    result.rows[0].coins
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
                SELECT *
                FROM users
                WHERE id = $1
                FOR UPDATE
                `,
                [userId]
            );


        if (!userResult.rows[0]) {

            const error = new Error(
                "User not found."
            );

            error.code =
                "USER_NOT_FOUND";

            throw error;
        }


        const user =
            userResult.rows[0];


        const claimDate =
            getCambodiaDate();


        const existing =
            await client.query(
                `
                SELECT id
                FROM daily_bonus_claims
                WHERE user_id = $1
                  AND claim_date = $2
                LIMIT 1
                `,
                [
                    userId,
                    claimDate
                ]
            );


        if (existing.rows[0]) {

            const error = new Error(
                "Daily bonus already claimed today."
            );

            error.code =
                "ALREADY_CLAIMED";

            throw error;
        }


        const reward =
            await getNumberSetting(
                client,
                "daily_bonus",
                DEFAULT_DAILY_BONUS
            );


        const before =
            Number(user.coins);


        const after =
            before + reward;


        await client.query(
            `
            UPDATE users
            SET
                coins = $2,
                today_coins = today_coins + $3,
                daily_streak = daily_streak + 1,
                last_daily_claim = $4,
                updated_at = NOW()
            WHERE id = $1
            `,
            [
                userId,
                after,
                reward,
                claimDate
            ]
        );


        await client.query(
            `
            INSERT INTO daily_bonus_claims (
                user_id,
                claim_date,
                reward_coins
            )
            VALUES (
                $1,
                $2,
                $3
            )
            `,
            [
                userId,
                claimDate,
                reward
            ]
        );


        await client.query(
            `
            INSERT INTO coin_transactions (
                user_id,
                type,
                amount,
                balance_before,
                balance_after,
                reference_id,
                description
            )
            VALUES (
                $1,
                'daily_bonus',
                $2,
                $3,
                $4,
                NULL,
                'Daily bonus'
            )
            `,
            [
                userId,
                reward,
                before,
                after
            ]
        );


        await client.query(
            "COMMIT"
        );


        return {
            success: true,
            reward,
            coins: after,
            claimDate
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
                SELECT *
                FROM users
                WHERE id = $1
                FOR UPDATE
                `,
                [userId]
            );


        if (!userResult.rows[0]) {

            const error = new Error(
                "User not found."
            );

            error.code =
                "USER_NOT_FOUND";

            throw error;
        }


        const user =
            userResult.rows[0];


        /*
         * Check cooldown using the last roll.
         */

        const lastRoll =
            await client.query(
                `
                SELECT rolled_at
                FROM lucky_rolls
                WHERE user_id = $1
                ORDER BY rolled_at DESC
                LIMIT 1
                `,
                [userId]
            );


        if (lastRoll.rows[0]) {

            const elapsed =
                (
                    Date.now() -
                    new Date(
                        lastRoll.rows[0].rolled_at
                    ).getTime()
                ) / 1000;


            if (
                elapsed <
                LUCKY_ROLL_COOLDOWN_SECONDS
            ) {

                const remaining =
                    Math.ceil(
                        LUCKY_ROLL_COOLDOWN_SECONDS -
                        elapsed
                    );


                const error = new Error(
                    "Lucky Roll is still on cooldown."
                );

                error.code =
                    "LUCKY_ROLL_COOLDOWN";

                error.remainingSeconds =
                    remaining;

                throw error;
            }
        }


        /*
         * Consume verified AdsGram reward.
         */

        const ad =
            await consumeVerifiedAd({
                client,
                userId,
                adType: "lucky_roll"
            });


        const rollNumber =
            generateLuckyNumber();


        const reward =
            calculateLuckyReward(
                rollNumber
            );


        const before =
            Number(user.coins);


        const after =
            before + reward;


        const roll =
            await client.query(
                `
                INSERT INTO lucky_rolls (
                    user_id,
                    roll_number,
                    reward_coins,
                    ad_required,
                    ad_completed,
                    rolled_at
                )
                VALUES (
                    $1,
                    $2,
                    $3,
                    TRUE,
                    TRUE,
                    NOW()
                )
                RETURNING *
                `,
                [
                    userId,
                    rollNumber,
                    reward
                ]
            );


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
                reward
            ]
        );


        await client.query(
            `
            INSERT INTO coin_transactions (
                user_id,
                type,
                amount,
                balance_before,
                balance_after,
                reference_id,
                description
            )
            VALUES (
                $1,
                'lucky_roll',
                $2,
                $3,
                $4,
                $5,
                'Lucky Roll reward'
            )
            `,
            [
                userId,
                reward,
                before,
                after,
                roll.rows[0].id
            ]
        );


        await client.query(
            `
            UPDATE ad_rewards
            SET
                metadata =
                    metadata ||
                    jsonb_build_object(
                        'luckyRollId',
                        $2
                    )
            WHERE id = $1
            `,
            [
                ad.id,
                roll.rows[0].id
            ]
        );


        await client.query(
            "COMMIT"
        );


        return {
            success: true,
            rollNumber,
            reward,
            coins: after,
            luckyRollId:
                roll.rows[0].id
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
   DOUBLE REWARD
========================================================= */

export async function claimDoubleGameReward(
    userId,
    gameSessionId
) {

    if (!isUUID(gameSessionId)) {

        const error = new Error(
            "Invalid game session."
        );

        error.code =
            "INVALID_GAME_SESSION";

        throw error;
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
                SELECT *
                FROM users
                WHERE id = $1
                FOR UPDATE
                `,
                [userId]
            );


        if (!userResult.rows[0]) {

            const error = new Error(
                "User not found."
            );

            error.code =
                "USER_NOT_FOUND";

            throw error;
        }


        const sessionResult =
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


        if (!sessionResult.rows[0]) {

            const error = new Error(
                "Game session not found."
            );

            error.code =
                "GAME_SESSION_NOT_FOUND";

            throw error;
        }


        const session =
            sessionResult.rows[0];


        if (
            session.status !==
            "completed"
        ) {

            const error = new Error(
                "Game is not completed."
            );

            error.code =
                "GAME_NOT_COMPLETED";

            throw error;
        }


        const reward =
            Number(
                session.reward_coins
            );


        if (
            !Number.isInteger(reward) ||
            reward <= 0
        ) {

            const error = new Error(
                "Invalid game reward."
            );

            error.code =
                "INVALID_GAME_REWARD";

            throw error;
        }


        /*
         * Consume only the verified ad belonging
         * to this exact completed game.
         */

        await consumeVerifiedAd({
            client,
            userId,
            adType: "double_reward",
            gameSessionId
        });


        const user =
            userResult.rows[0];


        const before =
            Number(user.coins);


        const after =
            before + reward;


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
                reward
            ]
        );


        await client.query(
            `
            INSERT INTO coin_transactions (
                user_id,
                type,
                amount,
                balance_before,
                balance_after,
                reference_id,
                description
            )
            VALUES (
                $1,
                'double_game_reward',
                $2,
                $3,
                $4,
                $5,
                'Double game reward'
            )
            `,
            [
                userId,
                reward,
                before,
                after,
                gameSessionId
            ]
        );


        await client.query(
            "COMMIT"
        );


        return {
            success: true,
            reward,
            coins: after,
            gameSessionId
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
                    lives,
                    last_life_at,
                    last_daily_claim
                FROM users
                WHERE id = $1
                FOR UPDATE
                `,
                [userId]
            );


        if (!userResult.rows[0]) {

            const error = new Error(
                "User not found."
            );

            error.code =
                "USER_NOT_FOUND";

            throw error;
        }


        const user =
            userResult.rows[0];


        const lives =
            await recoverLives(
                client,
                userId
            );


        const claimDate =
            getCambodiaDate();


        const daily =
            await client.query(
                `
                SELECT id
                FROM daily_bonus_claims
                WHERE user_id = $1
                  AND claim_date = $2
                LIMIT 1
                `,
                [
                    userId,
                    claimDate
                ]
            );


        const verifiedAds =
            await client.query(
                `
                SELECT
                    ad_type,
                    COUNT(*)::int AS count
                FROM ad_rewards
                WHERE user_id = $1
                  AND provider = 'adsgram'
                  AND status = 'confirmed'
                  AND consumed_at IS NULL
                GROUP BY ad_type
                `,
                [userId]
            );


        const verifiedAdsMap = {
            life: 0,
            double_reward: 0,
            lucky_roll: 0
        };


        for (
            const row of verifiedAds.rows
        ) {

            verifiedAdsMap[
                row.ad_type
            ] = Number(
                row.count
            );

        }


        await client.query(
            "COMMIT"
        );


        return {

            coins:
                Number(user.coins),

            lives,

            maxLives: 5,

            dailyBonus: {

                claimed:
                    Boolean(
                        daily.rows[0]
                    ),

                claimDate

            },

            verifiedAds:
                verifiedAdsMap

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

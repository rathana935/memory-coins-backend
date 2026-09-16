import pool from "../db/pool.js";


/*
============================================================
MEMORY COINS
LEADERBOARD SERVICE
============================================================

SECURITY
------------------------------------------------------------
The frontend cannot submit:

- coins
- score
- rank
- username
- leaderboard position

The server calculates leaderboard values directly from
PostgreSQL.

ALL-TIME
------------------------------------------------------------
Uses the user's current wallet balance.

WEEKLY
------------------------------------------------------------
Uses legitimate positive earning transactions created
during the current PostgreSQL calendar week.

IMPORTANT
------------------------------------------------------------
Only explicitly approved earning transaction types are
included.

This prevents unrelated positive transactions such as:

- withdrawal_refund
- admin_adjustment

from being counted as weekly earnings.

============================================================
*/


/*
============================================================
CONFIGURATION
============================================================
*/

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;


/*
============================================================
WEEKLY EARNING TRANSACTION TYPES
============================================================

These must match transaction types used by the rest of
the backend.

Current backend types include:

game_reward
daily_bonus
lucky_roll
referral
referral_reward
ad_reward
double_game_reward

"referral" is included because the current auth route
records referral rewards using:

type = "referral"

============================================================
*/

const WEEKLY_EARNING_TYPES = [
    "game_reward",
    "daily_bonus",
    "lucky_roll",
    "referral",
    "referral_reward",
    "ad_reward",
    "double_game_reward"
];


/*
============================================================
VALIDATE LIMIT
============================================================
*/

function normalizeLimit(value) {

    const number =
        Number(value);


    if (
        !Number.isFinite(number)
    ) {

        return DEFAULT_LIMIT;

    }


    return Math.min(
        Math.max(
            Math.floor(number),
            1
        ),
        MAX_LIMIT
    );

}


/*
============================================================
VALIDATE OFFSET
============================================================
*/

function normalizeOffset(value) {

    const number =
        Number(value);


    if (
        !Number.isFinite(number)
    ) {

        return 0;

    }


    return Math.max(
        Math.floor(number),
        0
    );

}


/*
============================================================
NORMALIZE USER ID
============================================================
*/

function normalizeUserId(value) {

    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {

        return null;

    }


    return value;

}


/*
============================================================
FORMAT LEADERBOARD ROW
============================================================
*/

function serializeLeaderboardRow(row) {

    return {

        rank:
            Number(
                row.rank
            ),

        userId:
            row.id,

        username:
            row.username,

        firstName:
            row.first_name,

        lastName:
            row.last_name,

        photoUrl:
            row.photo_url,

        coins:
            Number(
                row.coins || 0
            )

    };

}


/*
============================================================
GET ALL-TIME LEADERBOARD
============================================================

Ranking is based on the user's CURRENT wallet balance.

Therefore:

withdrawals reduce the leaderboard balance.

refunds increase the current balance.

This represents current wallet balance rather than
historical lifetime earnings.

============================================================
*/

export async function getAllTimeLeaderboard(
    options = {}
) {

    const limit =
        normalizeLimit(
            options.limit
        );


    const offset =
        normalizeOffset(
            options.offset
        );


    const userId =
        normalizeUserId(
            options.userId
        );


    /*
    --------------------------------------------------------
    LEADERBOARD
    --------------------------------------------------------
    */

    const result =
        await pool.query(
            `
            WITH ranked AS (

                SELECT

                    u.id,

                    u.username,

                    u.first_name,

                    u.last_name,

                    u.photo_url,

                    u.coins,

                    RANK() OVER (
                        ORDER BY
                            u.coins DESC,
                            u.created_at ASC,
                            u.id ASC
                    ) AS rank

                FROM users u

                WHERE
                    u.is_blocked = FALSE

                    AND u.coins >= 0
            )

            SELECT

                id,

                username,

                first_name,

                last_name,

                photo_url,

                coins,

                rank

            FROM ranked

            ORDER BY
                rank ASC,
                id ASC

            LIMIT $1
            OFFSET $2
            `,
            [
                limit,
                offset
            ]
        );


    /*
    --------------------------------------------------------
    CURRENT USER RANK
    --------------------------------------------------------
    */

    let currentUser = null;


    if (userId) {

        const userResult =
            await pool.query(
                `
                WITH ranked AS (

                    SELECT

                        u.id,

                        u.username,

                        u.first_name,

                        u.last_name,

                        u.photo_url,

                        u.coins,

                        RANK() OVER (
                            ORDER BY
                                u.coins DESC,
                                u.created_at ASC,
                                u.id ASC
                        ) AS rank

                    FROM users u

                    WHERE
                        u.is_blocked = FALSE

                        AND u.coins >= 0
                )

                SELECT

                    id,

                    username,

                    first_name,

                    last_name,

                    photo_url,

                    coins,

                    rank

                FROM ranked

                WHERE
                    id = $1

                LIMIT 1
                `,
                [
                    userId
                ]
            );


        if (
            userResult.rows.length > 0
        ) {

            currentUser =
                serializeLeaderboardRow(
                    userResult.rows[0]
                );

        }

    }


    /*
    --------------------------------------------------------
    TOTAL ACTIVE PLAYERS
    --------------------------------------------------------
    */

    const countResult =
        await pool.query(
            `
            SELECT
                COUNT(*)::INTEGER AS total

            FROM users

            WHERE
                is_blocked = FALSE
            `
        );


    /*
    --------------------------------------------------------
    RETURN
    --------------------------------------------------------
    */

    return {

        success: true,

        period:
            "all_time",

        players:
            Number(
                countResult.rows[0].total
            ),

        leaderboard:
            result.rows.map(
                serializeLeaderboardRow
            ),

        currentUser

    };

}


/*
============================================================
GET WEEKLY LEADERBOARD
============================================================

The PostgreSQL date_trunc('week', NOW()) starts the week
on Monday.

Only whitelisted positive earning transactions count.

============================================================
*/

export async function getWeeklyLeaderboard(
    options = {}
) {

    const limit =
        normalizeLimit(
            options.limit
        );


    const offset =
        normalizeOffset(
            options.offset
        );


    const userId =
        normalizeUserId(
            options.userId
        );


    /*
    --------------------------------------------------------
    LEADERBOARD
    --------------------------------------------------------
    */

    const result =
        await pool.query(
            `
            WITH weekly_coins AS (

                SELECT

                    u.id,

                    u.username,

                    u.first_name,

                    u.last_name,

                    u.photo_url,

                    COALESCE(
                        SUM(ct.amount),
                        0
                    )::BIGINT AS coins

                FROM users u

                LEFT JOIN coin_transactions ct

                    ON ct.user_id = u.id

                    AND ct.created_at >=
                        date_trunc(
                            'week',
                            NOW()
                        )

                    AND ct.amount > 0

                    AND ct.type = ANY(
                        $1::VARCHAR[]
                    )

                WHERE
                    u.is_blocked = FALSE

                GROUP BY

                    u.id,

                    u.username,

                    u.first_name,

                    u.last_name,

                    u.photo_url

            ),

            ranked AS (

                SELECT

                    weekly_coins.*,

                    RANK() OVER (
                        ORDER BY
                            coins DESC,
                            id ASC
                    ) AS rank

                FROM weekly_coins

            )

            SELECT

                id,

                username,

                first_name,

                last_name,

                photo_url,

                coins,

                rank

            FROM ranked

            ORDER BY
                rank ASC,
                id ASC

            LIMIT $2
            OFFSET $3
            `,
            [
                WEEKLY_EARNING_TYPES,
                limit,
                offset
            ]
        );


    /*
    --------------------------------------------------------
    CURRENT USER WEEKLY RANK
    --------------------------------------------------------
    */

    let currentUser = null;


    if (userId) {

        const userResult =
            await pool.query(
                `
                WITH weekly_coins AS (

                    SELECT

                        u.id,

                        u.username,

                        u.first_name,

                        u.last_name,

                        u.photo_url,

                        COALESCE(
                            SUM(ct.amount),
                            0
                        )::BIGINT AS coins

                    FROM users u

                    LEFT JOIN coin_transactions ct

                        ON ct.user_id = u.id

                        AND ct.created_at >=
                            date_trunc(
                                'week',
                                NOW()
                            )

                        AND ct.amount > 0

                        AND ct.type = ANY(
                            $1::VARCHAR[]
                        )

                    WHERE
                        u.is_blocked = FALSE

                    GROUP BY

                        u.id,

                        u.username,

                        u.first_name,

                        u.last_name,

                        u.photo_url

                ),

                ranked AS (

                    SELECT

                        weekly_coins.*,

                        RANK() OVER (
                            ORDER BY
                                coins DESC,
                                id ASC
                        ) AS rank

                    FROM weekly_coins

                )

                SELECT

                    id,

                    username,

                    first_name,

                    last_name,

                    photo_url,

                    coins,

                    rank

                FROM ranked

                WHERE
                    id = $2

                LIMIT 1
                `,
                [
                    WEEKLY_EARNING_TYPES,
                    userId
                ]
            );


        if (
            userResult.rows.length > 0
        ) {

            currentUser =
                serializeLeaderboardRow(
                    userResult.rows[0]
                );

        }

    }


    /*
    --------------------------------------------------------
    TOTAL ACTIVE PLAYERS
    --------------------------------------------------------
    */

    const countResult =
        await pool.query(
            `
            SELECT
                COUNT(*)::INTEGER AS total

            FROM users

            WHERE
                is_blocked = FALSE
            `
        );


    /*
    --------------------------------------------------------
    RETURN
    --------------------------------------------------------
    */

    return {

        success: true,

        period:
            "weekly",

        players:
            Number(
                countResult.rows[0].total
            ),

        leaderboard:
            result.rows.map(
                serializeLeaderboardRow
            ),

        currentUser

    };

}


/*
============================================================
GET LEADERBOARD
============================================================

Supported:

weekly
all_time

Unknown values fall back to all_time.

The route already validates the period, but keeping this
fallback makes the service safe if it is called directly
from another backend module.

============================================================
*/

export async function getLeaderboard(
    period,
    options = {}
) {

    if (
        String(period).toLowerCase() ===
        "weekly"
    ) {

        return getWeeklyLeaderboard(
            options
        );

    }


    return getAllTimeLeaderboard(
        options
    );

}

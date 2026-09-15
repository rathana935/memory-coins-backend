import pool from "../db/pool.js";

/*
============================================================
MEMORY CARD / MEMORY COINS
LEADERBOARD SERVICE
============================================================

SECURITY RULES
------------------------------------------------------------
The frontend cannot submit:

- coins
- score
- rank
- username

The server calculates everything from PostgreSQL.

ALL-TIME
------------------------------------------------------------
Uses the user's current wallet balance.

WEEKLY
------------------------------------------------------------
Uses only legitimate earning transactions during the
current calendar week.

Allowed earning transaction types:

- game_reward
- daily_bonus
- lucky_roll
- referral_reward
- ad_reward

Transactions such as:

- withdrawal
- withdrawal_refund
- withdrawal_failed
- admin_adjustment

are NOT counted toward the weekly leaderboard.

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
VALIDATE PAGINATION
============================================================
*/

function normalizeLimit(value) {

    const number = Number(value);

    if (!Number.isFinite(number)) {
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


function normalizeOffset(value) {

    const number = Number(value);

    if (!Number.isFinite(number)) {
        return 0;
    }

    return Math.max(
        Math.floor(number),
        0
    );
}


/*
============================================================
WEEKLY EARNING TRANSACTION TYPES
============================================================

IMPORTANT:

Do NOT simply count all positive transactions.

For example:

withdrawal_refund = positive amount

but it is NOT new earnings.

Only genuine earning activities belong here.

============================================================
*/

const WEEKLY_EARNING_TYPES = [
    "game_reward",
    "daily_bonus",
    "lucky_roll",
    "referral_reward",
    "ad_reward"
];


/*
============================================================
GET ALL-TIME LEADERBOARD
============================================================

Ranking is based on the user's CURRENT coin balance.

Withdrawals reduce the balance.

Refunds increase the balance.

This is correct for an all-time wallet-balance leaderboard.

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
        options.userId || null;


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
                rank ASC

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
                userResult.rows[0];

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
                (row) => ({

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
                            row.coins
                        )

                })
            ),

        currentUser:
            currentUser
                ? {

                    rank:
                        Number(
                            currentUser.rank
                        ),

                    userId:
                        currentUser.id,

                    username:
                        currentUser.username,

                    firstName:
                        currentUser.first_name,

                    lastName:
                        currentUser.last_name,

                    photoUrl:
                        currentUser.photo_url,

                    coins:
                        Number(
                            currentUser.coins
                        )

                }
                : null

    };

}


/*
============================================================
GET WEEKLY LEADERBOARD
============================================================

The weekly leaderboard starts at Monday 00:00 according to
PostgreSQL's date_trunc('week') behavior.

ONLY legitimate earning transaction types are counted.

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
        options.userId || null;


    /*
    --------------------------------------------------------
    LEADERBOARD
    --------------------------------------------------------

    IMPORTANT:

    We explicitly whitelist earning transaction types.

    This prevents:

        withdrawal_refund

    or other future positive transactions from increasing
    the weekly leaderboard.

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

                    AND ct.type = ANY($1::VARCHAR[])

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
                rank ASC

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

                        AND ct.type = ANY($1::VARCHAR[])

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
                userResult.rows[0];

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
                (row) => ({

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
                            row.coins
                        )

                })
            ),

        currentUser:
            currentUser
                ? {

                    rank:
                        Number(
                            currentUser.rank
                        ),

                    userId:
                        currentUser.id,

                    username:
                        currentUser.username,

                    firstName:
                        currentUser.first_name,

                    lastName:
                        currentUser.last_name,

                    photoUrl:
                        currentUser.photo_url,

                    coins:
                        Number(
                            currentUser.coins
                        )

                }
                : null

    };

}


/*
============================================================
GET LEADERBOARD
============================================================

period:

"weekly"
"all_time"

Any unknown period defaults to all_time.

============================================================
*/

export async function getLeaderboard(
    period,
    options = {}
) {

    if (
        period === "weekly"
    ) {

        return getWeeklyLeaderboard(
            options
        );

    }


    return getAllTimeLeaderboard(
        options
    );

}

import pool from "../db/pool.js";

/*

MEMORY COINS
LEADERBOARD SERVICE

The leaderboard is calculated from PostgreSQL.

The frontend cannot submit:

- coins
- rank
- username
- score

The server determines everything.

============================================================
*/

/*

GET ALL-TIME LEADERBOARD

Returns users ranked by their current coin balance.

Options:

limit
offset
userId

============================================================
*/

export async function getAllTimeLeaderboard(
options = {}
) {

const limit =
    Math.min(
        Math.max(
            Number(
                options.limit || 20
            ),
            1
        ),
        100
    );


const offset =
    Math.max(
        Number(
            options.offset || 0
        ),
        0
    );


const userId =
    options.userId || null;


const result =
    await pool.query(
        `
        SELECT
            ranked.id,
            ranked.username,
            ranked.first_name,
            ranked.last_name,
            ranked.photo_url,
            ranked.coins,
            ranked.rank

        FROM
        (
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
                        u.created_at ASC
                ) AS rank

            FROM users u

            WHERE
                u.is_blocked = FALSE

                AND u.coins >= 0

        ) ranked

        ORDER BY
            ranked.rank ASC

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
Find current user's position
--------------------------------------------------------
*/

let currentUser = null;


if (userId) {

    const userResult =
        await pool.query(
            `
            SELECT

                ranked.id,

                ranked.username,

                ranked.first_name,

                ranked.last_name,

                ranked.photo_url,

                ranked.coins,

                ranked.rank

            FROM
            (
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
                            u.created_at ASC
                    ) AS rank

                FROM users u

                WHERE
                    u.is_blocked = FALSE

                    AND u.coins >= 0

            ) ranked

            WHERE
                ranked.id = $1

            LIMIT 1
            `,
            [userId]
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
Total players
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

GET WEEKLY LEADERBOARD

Weekly ranking is based on coins earned during the
current calendar week.

The source is coin_transactions.

Only positive coin transactions are counted.

This means:

- Game rewards count
- Daily Bonus counts
- Lucky Roll counts
- Other positive rewards count

Withdrawals do NOT increase the leaderboard.

============================================================
*/

export async function getWeeklyLeaderboard(
options = {}
) {

const limit =
    Math.min(
        Math.max(
            Number(
                options.limit || 20
            ),
            1
        ),
        100
    );


const offset =
    Math.max(
        Number(
            options.offset || 0
        ),
        0
    );


const userId =
    options.userId || null;


/*
--------------------------------------------------------
Calculate Monday of current week
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
                    SUM(
                        CASE

                            WHEN
                                ct.amount > 0

                            THEN
                                ct.amount

                            ELSE
                                0

                        END
                    ),
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
Find current user
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
                        SUM(
                            CASE

                                WHEN
                                    ct.amount > 0

                                THEN
                                    ct.amount

                                ELSE
                                    0

                            END
                        ),
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

            SELECT *

            FROM ranked

            WHERE id = $1

            LIMIT 1
            `,
            [userId]
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
Total active players
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

GET LEADERBOARD

period:

"weekly"
"all_time"

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

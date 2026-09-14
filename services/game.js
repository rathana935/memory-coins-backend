import crypto from "crypto";
import pool from "../db/pool.js";

/*
============================================================
MEMORY COINS - GAME SERVICE
PART 2
============================================================

Responsibilities:

- Start games
- Consume lives
- Recover lives after 1 hour
- Complete games
- Award game coins
- Prevent duplicate rewards
- Update difficulty levels
- Record coin transactions
============================================================
*/


const MAX_LIVES = 5;

const LIFE_COOLDOWN_MINUTES = 60;

const LIFE_COOLDOWN_MS =
    LIFE_COOLDOWN_MINUTES *
    60 *
    1000;


/*
============================================================
GAME CONFIGURATION
============================================================
*/

const GAME_CONFIG = {

    easy: {
        rows: 2,
        cols: 4,
        pairs: 4,
        reward: 10
    },

    medium: {
        rows: 3,
        cols: 4,
        pairs: 6,
        reward: 12
    },

    hard: {
        rows: 4,
        cols: 4,
        pairs: 8,
        reward: 15
    }

};


/*
============================================================
HELPERS
============================================================
*/


function isValidDifficulty(difficulty) {

    return Object.prototype.hasOwnProperty.call(
        GAME_CONFIG,
        difficulty
    );

}


/*
PostgreSQL completion_token is UUID.
*/

function generateCompletionToken() {

    return crypto.randomUUID();

}


/*
Convert database UUID/value to string.
*/

function gameSessionId(value) {

    return String(value);

}


/*
============================================================
RECOVER LIVES
============================================================

Rules:

Maximum lives = 5

Example:

5 lives
↓
start game
↓
4 lives

After 1 hour
↓
5 lives

Example:

0 lives
+
3 hours elapsed
=
3 lives

Maximum is always 5.

The timer continues even when the user
closes the app because last_life_at is
stored in PostgreSQL.
============================================================
*/

export async function recoverLives(
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


    if (result.rows.length === 0) {

        throw new Error(
            "User not found"
        );

    }


    const user =
        result.rows[0];


    let lives =
        Number(user.lives);


    /*
    --------------------------------------------------------
    Already full
    --------------------------------------------------------
    */

    if (lives >= MAX_LIVES) {

        if (user.last_life_at !== null) {

            await client.query(
                `
                UPDATE users
                SET
                    last_life_at = NULL
                WHERE id = $1
                `,
                [userId]
            );

        }


        return {

            lives: MAX_LIVES,

            nextLifeAt: null

        };

    }


    /*
    --------------------------------------------------------
    No timer
    --------------------------------------------------------
    */

    if (!user.last_life_at) {

        return {

            lives,

            nextLifeAt: null

        };

    }


    /*
    --------------------------------------------------------
    Calculate elapsed time
    --------------------------------------------------------
    */

    const lostAt =
        new Date(
            user.last_life_at
        );


    const now =
        new Date();


    const elapsedMilliseconds =
        now.getTime() -
        lostAt.getTime();


    /*
    --------------------------------------------------------
    Calculate recovered lives
    --------------------------------------------------------
    */

    const recoveredLives =
        Math.floor(
            elapsedMilliseconds /
            LIFE_COOLDOWN_MS
        );


    /*
    No complete hour yet.
    */

    if (recoveredLives <= 0) {

        return {

            lives,

            nextLifeAt:
                new Date(
                    lostAt.getTime() +
                    LIFE_COOLDOWN_MS
                )

        };

    }


    /*
    --------------------------------------------------------
    Calculate new life count
    --------------------------------------------------------
    */

    const newLives =
        Math.min(
            MAX_LIVES,
            lives + recoveredLives
        );


    /*
    --------------------------------------------------------
    Recovered all lives
    --------------------------------------------------------
    */

    if (newLives >= MAX_LIVES) {

        await client.query(
            `
            UPDATE users
            SET
                lives = $1,
                last_life_at = NULL
            WHERE id = $2
            `,
            [
                MAX_LIVES,
                userId
            ]
        );


        return {

            lives: MAX_LIVES,

            nextLifeAt: null

        };

    }


    /*
    --------------------------------------------------------
    Preserve remaining cooldown
    --------------------------------------------------------
    */

    const newLostAt =
        new Date(
            lostAt.getTime() +
            (
                recoveredLives *
                LIFE_COOLDOWN_MS
            )
        );


    await client.query(
        `
        UPDATE users
        SET
            lives = $1,
            last_life_at = $2
        WHERE id = $3
        `,
        [
            newLives,
            newLostAt,
            userId
        ]
    );


    const nextLifeAt =
        new Date(
            newLostAt.getTime() +
            LIFE_COOLDOWN_MS
        );


    return {

        lives: newLives,

        nextLifeAt

    };

}


/*
============================================================
START GAME
============================================================
*/

export async function startGame(
    userId,
    difficulty
) {

    /*
    Validate difficulty.
    */

    if (!isValidDifficulty(difficulty)) {

        throw new Error(
            "Invalid difficulty"
        );

    }


    const config =
        GAME_CONFIG[difficulty];


    const client =
        await pool.connect();


    try {

        await client.query(
            "BEGIN"
        );


        /*
        ----------------------------------------------------
        Recover expired lives first.
        ----------------------------------------------------
        */

        const lifeState =
            await recoverLives(
                client,
                userId
            );


        /*
        ----------------------------------------------------
        No lives
        ----------------------------------------------------
        */

        if (lifeState.lives <= 0) {

            await client.query(
                "ROLLBACK"
            );


            return {

                success: false,

                error: "NO_LIVES",

                message:
                    "No lives available.",

                lives: 0,

                nextLifeAt:
                    lifeState.nextLifeAt

            };

        }


        /*
        ----------------------------------------------------
        Consume ONE life.
        ----------------------------------------------------

        If user has 5 lives:

        5 → 4

        Start the recovery timer.

        If user already has 4 lives,
        keep the existing recovery timer.
        ----------------------------------------------------
        */

        const updatedUser =
            await client.query(
                `
                UPDATE users
                SET
                    lives = lives - 1,

                    last_life_at =
                        CASE
                            WHEN lives = $1
                            THEN NOW()
                            ELSE last_life_at
                        END

                WHERE id = $2

                RETURNING
                    id,
                    lives,
                    last_life_at
                `,
                [
                    MAX_LIVES,
                    userId
                ]
            );


        if (
            updatedUser.rows.length === 0
        ) {

            throw new Error(
                "User not found"
            );

        }


        const user =
            updatedUser.rows[0];


        /*
        ----------------------------------------------------
        Generate secure UUID completion token.
        ----------------------------------------------------
        */

        const completionToken =
            generateCompletionToken();


        /*
        ----------------------------------------------------
        Get current difficulty level.
        ----------------------------------------------------
        */

        const levelResult =
            await client.query(
                `
                SELECT

                    CASE

                        WHEN $2 = 'easy'
                        THEN easy_level

                        WHEN $2 = 'medium'
                        THEN medium_level

                        WHEN $2 = 'hard'
                        THEN hard_level

                    END AS level

                FROM users

                WHERE id = $1
                `,
                [
                    userId,
                    difficulty
                ]
            );


        if (
            levelResult.rows.length === 0
        ) {

            throw new Error(
                "User not found"
            );

        }


        const level =
            Number(
                levelResult.rows[0].level
            );


        /*
        ----------------------------------------------------
        Create game session.
        ----------------------------------------------------

        IMPORTANT:

        Database column is reward_coins.
        ----------------------------------------------------
        */

        const sessionResult =
            await client.query(
                `
                INSERT INTO game_sessions
                (
                    user_id,
                    difficulty,
                    level,
                    pairs,
                    reward_coins,
                    status,
                    started_at,
                    completion_token
                )

                VALUES
                (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    'started',
                    NOW(),
                    $6
                )

                RETURNING
                    id,
                    difficulty,
                    level,
                    pairs,
                    reward_coins,
                    started_at,
                    completion_token
                `,
                [
                    userId,
                    difficulty,
                    level,
                    config.pairs,
                    config.reward,
                    completionToken
                ]
            );


        const session =
            sessionResult.rows[0];


        await client.query(
            "COMMIT"
        );


        /*
        ----------------------------------------------------
        Return game information.
        ----------------------------------------------------
        */

        return {

            success: true,

            game: {

                id:
                    gameSessionId(
                        session.id
                    ),

                difficulty:
                    session.difficulty,

                level:
                    Number(
                        session.level
                    ),

                rows:
                    config.rows,

                cols:
                    config.cols,

                pairs:
                    Number(
                        session.pairs
                    ),

                reward:
                    Number(
                        session.reward_coins
                    ),

                completionToken:
                    session.completion_token,

                startedAt:
                    session.started_at

            },

            lives:
                Number(
                    user.lives
                ),

            nextLifeAt:
                user.last_life_at
                    ? new Date(
                        new Date(
                            user.last_life_at
                        ).getTime() +
                        LIFE_COOLDOWN_MS
                    )
                    : null

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
============================================================
COMPLETE GAME
============================================================

Security:

- Locks game session
- Checks user
- Checks completion token
- Prevents duplicate completion
- Gets reward from PostgreSQL
- Never trusts reward from frontend
- Updates balance atomically
- Records transaction
============================================================
*/

export async function completeGame({
    userId,
    gameId,
    completionToken,
    moves,
    durationSeconds
}) {

    const client =
        await pool.connect();


    try {

        await client.query(
            "BEGIN"
        );


        /*
        ----------------------------------------------------
        Lock game session.
        ----------------------------------------------------
        */

        const sessionResult =
            await client.query(
                `
                SELECT
                    id,
                    user_id,
                    difficulty,
                    level,
                    pairs,
                    reward_coins,
                    status,
                    started_at,
                    completed_at,
                    completion_token
                FROM game_sessions

                WHERE
                    id = $1
                    AND user_id = $2

                FOR UPDATE
                `,
                [
                    gameId,
                    userId
                ]
            );


        if (
            sessionResult.rows.length === 0
        ) {

            await client.query(
                "ROLLBACK"
            );


            throw new Error(
                "Game session not found"
            );

        }


        const session =
            sessionResult.rows[0];


        /*
        ----------------------------------------------------
        Prevent duplicate rewards.
        ----------------------------------------------------
        */

        if (
            session.status ===
            "completed"
        ) {

            await client.query(
                "ROLLBACK"
            );


            return {

                success: false,

                error:
                    "ALREADY_COMPLETED",

                message:
                    "This game has already been completed."

            };

        }


        /*
        ----------------------------------------------------
        Verify completion token.
        ----------------------------------------------------
        */

        if (
            !completionToken ||
            completionToken !==
            session.completion_token
        ) {

            await client.query(
                "ROLLBACK"
            );


            throw new Error(
                "Invalid completion token"
            );

        }


        /*
        ----------------------------------------------------
        Validate moves.
        ----------------------------------------------------
        */

        const parsedMoves =
            Number(moves);


        const safeMoves =
            Number.isInteger(
                parsedMoves
            ) &&
            parsedMoves >= 0
                ? parsedMoves
                : 0;


        /*
        ----------------------------------------------------
        Validate duration.
        ----------------------------------------------------
        */

        const parsedDuration =
            Number(
                durationSeconds
            );


        const safeDuration =
            Number.isFinite(
                parsedDuration
            ) &&
            parsedDuration >= 0
                ? Math.floor(
                    parsedDuration
                )
                : 0;


        /*
        ----------------------------------------------------
        IMPORTANT:

        Reward comes from PostgreSQL,
        not the browser.
        ----------------------------------------------------
        */

        const reward =
            Number(
                session.reward_coins
            );


        /*
        ----------------------------------------------------
        Get user's balance BEFORE reward.
        ----------------------------------------------------
        */

        const balanceResult =
            await client.query(
                `
                SELECT
                    coins
                FROM users
                WHERE id = $1
                FOR UPDATE
                `,
                [userId]
            );


        if (
            balanceResult.rows.length === 0
        ) {

            throw new Error(
                "User not found"
            );

        }


        const balanceBefore =
            Number(
                balanceResult.rows[0].coins
            );


        /*
        ----------------------------------------------------
        Mark game completed.
        ----------------------------------------------------
        */

        await client.query(
            `
            UPDATE game_sessions

            SET
                status = 'completed',
                completed_at = NOW(),
                moves = $1,
                duration_seconds = $2

            WHERE id = $3
            `,
            [
                safeMoves,
                safeDuration,
                gameId
            ]
        );


        /*
        ----------------------------------------------------
        Award coins.
        ----------------------------------------------------
        */

        const userResult =
            await client.query(
                `
                UPDATE users

                SET
                    coins =
                        coins + $1,

                    today_coins =
                        today_coins + $1,

                    games_played =
                        games_played + 1,

                    easy_games =
                        CASE
                            WHEN $2 = 'easy'
                            THEN easy_games + 1
                            ELSE easy_games
                        END,

                    medium_games =
                        CASE
                            WHEN $2 = 'medium'
                            THEN medium_games + 1
                            ELSE medium_games
                        END,

                    hard_games =
                        CASE
                            WHEN $2 = 'hard'
                            THEN hard_games + 1
                            ELSE hard_games
                        END,

                    easy_level =
                        CASE
                            WHEN $2 = 'easy'
                            THEN LEAST(
                                100,
                                easy_level + 1
                            )
                            ELSE easy_level
                        END,

                    medium_level =
                        CASE
                            WHEN $2 = 'medium'
                            THEN LEAST(
                                100,
                                medium_level + 1
                            )
                            ELSE medium_level
                        END,

                    hard_level =
                        CASE
                            WHEN $2 = 'hard'
                            THEN LEAST(
                                100,
                                hard_level + 1
                            )
                            ELSE hard_level
                        END

                WHERE id = $3

                RETURNING
                    coins,
                    today_coins,
                    games_played,
                    lives
                `,
                [
                    reward,
                    session.difficulty,
                    userId
                ]
            );


        if (
            userResult.rows.length === 0
        ) {

            throw new Error(
                "Unable to update user balance"
            );

        }


        const user =
            userResult.rows[0];


        const balanceAfter =
            Number(
                user.coins
            );


        /*
        ----------------------------------------------------
        Record game result.
        ----------------------------------------------------

        Database column:
        reward_coins

        Database timestamp:
        completed_at
        ----------------------------------------------------
        */

        await client.query(
            `
            INSERT INTO game_results
            (
                user_id,
                game_session_id,
                difficulty,
                level,
                reward_coins,
                moves,
                duration_seconds,
                completed_at
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
                gameId,
                session.difficulty,
                Number(
                    session.level
                ),
                reward,
                safeMoves,
                safeDuration
            ]
        );


        /*
        ----------------------------------------------------
        Record coin transaction.
        ----------------------------------------------------

        Your PostgreSQL schema requires:

        balance_before
        balance_after
        reference_id UUID
        ----------------------------------------------------
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
                "game_reward",
                reward,
                balanceBefore,
                balanceAfter,
                gameId,
                `Completed ${session.difficulty} memory game`
            ]
        );


        /*
        ----------------------------------------------------
        Commit EVERYTHING together.
        ----------------------------------------------------
        */

        await client.query(
            "COMMIT"
        );


        /*
        ----------------------------------------------------
        Return result.
        ----------------------------------------------------
        */

        return {

            success: true,

            reward,

            difficulty:
                session.difficulty,

            level:
                Number(
                    session.level
                ),

            balance:
                balanceAfter,

            todayCoins:
                Number(
                    user.today_coins
                ),

            gamesPlayed:
                Number(
                    user.games_played
                ),

            lives:
                Number(
                    user.lives
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


/*
============================================================
GET GAME STATUS
============================================================
*/

export async function getGameStatus(
    userId
) {

    const client =
        await pool.connect();


    try {

        await client.query(
            "BEGIN"
        );


        /*
        ----------------------------------------------------
        Recover lives first.
        ----------------------------------------------------
        */

        const lifeState =
            await recoverLives(
                client,
                userId
            );


        /*
        ----------------------------------------------------
        Get user status.
        ----------------------------------------------------
        */

        const result =
            await client.query(
                `
                SELECT
                    id,
                    coins,
                    today_coins,
                    games_played,
                    easy_games,
                    medium_games,
                    hard_games,
                    easy_level,
                    medium_level,
                    hard_level,
                    lives
                FROM users
                WHERE id = $1
                `,
                [userId]
            );


        if (
            result.rows.length === 0
        ) {

            throw new Error(
                "User not found"
            );

        }


        const user =
            result.rows[0];


        await client.query(
            "COMMIT"
        );


        /*
        ----------------------------------------------------
        Return status.
        ----------------------------------------------------
        */

        return {

            success: true,

            coins:
                Number(
                    user.coins
                ),

            todayCoins:
                Number(
                    user.today_coins
                ),

            gamesPlayed:
                Number(
                    user.games_played
                ),

            games: {

                easy:
                    Number(
                        user.easy_games
                    ),

                medium:
                    Number(
                        user.medium_games
                    ),

                hard:
                    Number(
                        user.hard_games
                    )

            },

            levels: {

                easy:
                    Number(
                        user.easy_level
                    ),

                medium:
                    Number(
                        user.medium_level
                    ),

                hard:
                    Number(
                        user.hard_level
                    )

            },

            lives:
                Number(
                    lifeState.lives
                ),

            nextLifeAt:
                lifeState.nextLifeAt

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

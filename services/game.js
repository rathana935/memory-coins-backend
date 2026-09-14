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

function generateCompletionToken() {

    return crypto.randomUUID();

}



/*
============================================================
RECOVER LIVES
============================================================

Example:

5 lives
↓ play
4 lives

After 1 hour:
5 lives

If:

0 lives
and 3 hours pass

then:

3 lives

Maximum is always 5.
============================================================
*/


export async function recoverLives(client, userId) {

    const result = await client.query(
        `
        SELECT
            id,
            lives,
            last_life_lost_at
        FROM users
        WHERE id = $1
        FOR UPDATE
        `,
        [userId]
    );


    if (result.rows.length === 0) {

        throw new Error("User not found");

    }


    const user = result.rows[0];


    let lives = Number(user.lives);


    /*
    Already full.
    */

    if (lives >= MAX_LIVES) {

        if (user.last_life_at !== null) {

            await client.query(
                `
                UPDATE users
                SET last_life_at = NULL
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
    No recovery timer means there is
    nothing to recover yet.
    */

    if (!user.last_life_at) {

        return {
            lives,
            nextLifeAt: null
        };

    }


    const lostAt =
        new Date(user.last_life_at);


    const now =
        new Date();


    const elapsedMilliseconds =
        now.getTime() - lostAt.getTime();


    const cooldownMilliseconds =
        LIFE_COOLDOWN_MINUTES *
        60 *
        1000;


    /*
    How many complete recovery periods
    have passed?
    */

    const recoveredLives =
        Math.floor(
            elapsedMilliseconds /
            cooldownMilliseconds
        );


    if (recoveredLives <= 0) {

        const nextLifeAt =
            new Date(
                lostAt.getTime() +
                cooldownMilliseconds
            );


        return {
            lives,
            nextLifeAt
        };

    }


    /*
    Never exceed MAX_LIVES.
    */

    const newLives =
        Math.min(
            MAX_LIVES,
            lives + recoveredLives
        );


    /*
    We need to preserve any remaining
    cooldown time.
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
    Move the recovery timestamp forward
    by the number of lives recovered.
    */

    const newLostAt =
        new Date(
            lostAt.getTime() +
            recoveredLives *
            cooldownMilliseconds
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
            cooldownMilliseconds
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

        await client.query("BEGIN");


        /*
        First recover any expired lives.
        */

        const lifeState =
            await recoverLives(
                client,
                userId
            );


        /*
        No lives available.
        */

        if (lifeState.lives <= 0) {

            await client.query("ROLLBACK");

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
        Consume ONE life.
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


        const user =
            updatedUser.rows[0];


        /*
        Generate a unique completion token.

        The frontend must return this token
        when completing the game.
        */

        const completionToken =
            generateCompletionToken();


        /*
        Get current difficulty level.
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


        const level =
            Number(
                levelResult.rows[0].level
            );


        /*
        Create game session.
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
                    reward,
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
                    reward,
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


        await client.query("COMMIT");


        return {
            success: true,

            game: {
                id:
                    gameSessionId(
                        sessionResult.rows[0].id
                    ),

                difficulty,

                level,

                rows:
                    config.rows,

                cols:
                    config.cols,

                pairs:
                    config.pairs,

                reward:
                    config.reward,

                completionToken,

                startedAt:
                    sessionResult.rows[0].started_at
            },

            lives:
                Number(user.lives),

            nextLifeAt:
                user.last_life_at
                    ? new Date(
                        new Date(
                            user.last_life_at
                        ).getTime() +
                        LIFE_COOLDOWN_MINUTES *
                        60 *
                        1000
                    )
                    : null
        };

    } catch (error) {

        await client.query("ROLLBACK");

        throw error;

    } finally {

        client.release();

    }

}


/*
============================================================
GAME SESSION ID
============================================================
*/

function gameSessionId(value) {

    return String(value);

}


/*
============================================================
COMPLETE GAME
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

        await client.query("BEGIN");


        /*
        Lock the game session.

        This prevents two simultaneous requests
        from claiming the same reward.
        */

        const sessionResult =
            await client.query(
                `
                SELECT
                    *
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


        if (sessionResult.rows.length === 0) {

            await client.query("ROLLBACK");

            throw new Error(
                "Game session not found"
            );

        }


        const session =
            sessionResult.rows[0];


        /*
        Already completed?

        Never award coins twice.
        */

        if (session.status === "completed") {

            await client.query("ROLLBACK");

            return {
                success: false,
                error: "ALREADY_COMPLETED",
                message:
                    "This game has already been completed."
            };

        }


        /*
        Verify completion token.
        */

        if (
            !completionToken ||
            completionToken !==
            session.completion_token
        ) {

            await client.query("ROLLBACK");

            throw new Error(
                "Invalid completion token"
            );

        }


        /*
        Validate moves.
        */

        const safeMoves =
            Number.isInteger(Number(moves)) &&
            Number(moves) >= 0
                ? Number(moves)
                : 0;


        /*
        Validate duration.
        */

        const safeDuration =
            Number.isFinite(
                Number(durationSeconds)
            ) &&
            Number(durationSeconds) >= 0
                ? Number(durationSeconds)
                : 0;


        const reward =
            Number(session.reward);


        /*
        Mark game completed.
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
                Math.floor(safeDuration),
                gameId
            ]
        );


        /*
        Award coins.

        The reward comes from the database
        game session, NOT from the browser.
        */

        const userResult =
            await client.query(
                `
                UPDATE users
                SET
                    coins = coins + $1,
                    today_coins = today_coins + $1,
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


        if (userResult.rows.length === 0) {

            throw new Error(
                "User not found"
            );

        }


        const user =
            userResult.rows[0];


        /*
        Record game result.
        */

        await client.query(
            `
            INSERT INTO game_results
            (
                user_id,
                game_session_id,
                difficulty,
                level,
                reward,
                moves,
                duration_seconds,
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
                gameId,
                session.difficulty,
                session.level,
                reward,
                safeMoves,
                Math.floor(safeDuration)
            ]
        );


        /*
        Record coin transaction.
        */

        await client.query(
            `
            INSERT INTO coin_transactions
            (
                user_id,
                amount,
                type,
                reference_id,
                description,
                created_at
            )
            VALUES
            (
                $1,
                $2,
                'game_reward',
                $3,
                $4,
                NOW()
            )
            `,
            [
                userId,
                reward,
                String(gameId),
                `Completed ${session.difficulty} memory game`
            ]
        );


        await client.query("COMMIT");


        return {

            success:true,

            reward,

            difficulty:
                session.difficulty,

            level:
                Number(session.level),

            balance:
                Number(user.coins),

            todayCoins:
                Number(user.today_coins),

            gamesPlayed:
                Number(user.games_played),

            lives:
                Number(user.lives)

        };

    } catch (error) {

        await client.query("ROLLBACK");

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


export async function getGameStatus(userId) {

    const client =
        await pool.connect();


    try {

        await client.query("BEGIN");


        const lifeState =
            await recoverLives(
                client,
                userId
            );


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


        if (result.rows.length === 0) {

            throw new Error(
                "User not found"
            );

        }


        const user =
            result.rows[0];


        await client.query("COMMIT");


        return {

            success:true,

            coins:
                Number(user.coins),

            todayCoins:
                Number(user.today_coins),

            gamesPlayed:
                Number(user.games_played),

            games: {

                easy:
                    Number(user.easy_games),

                medium:
                    Number(user.medium_games),

                hard:
                    Number(user.hard_games)

            },

            levels: {

                easy:
                    Number(user.easy_level),

                medium:
                    Number(user.medium_level),

                hard:
                    Number(user.hard_level)

            },

            lives:
                Number(lifeState.lives),

            nextLifeAt:
                lifeState.nextLifeAt

        };

    } catch (error) {

        await client.query("ROLLBACK");

        throw error;

    } finally {

        client.release();

    }

}

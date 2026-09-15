import crypto from "crypto";
import pool from "../db/pool.js";

/*
============================================================
MEMORY CARD / MEMORY COINS - GAME SERVICE
============================================================

GAME RULES
------------------------------------------------------------
Easy:
- 2 x 4 cards
- 4 pairs
- 10 coins

Medium:
- 3 x 4 cards
- 6 pairs
- 12 coins

Hard:
- 4 x 4 cards
- 8 pairs
- 15 coins

LIVES
------------------------------------------------------------
- Maximum 5 lives
- Starting a game consumes 1 life
- 1 life regenerates every 60 minutes
- Server controls life regeneration
- Remaining cooldown time is preserved
- Frontend receives exact countdown information

SECURITY
------------------------------------------------------------
- Server controls rewards
- Server controls game sessions
- Server generates completion token
- Duplicate completion blocked
- Balance updates transactional
- Client cannot request 2x reward
- Ad rewards will be handled separately through
  server-side verified AdsGram integration
============================================================
*/


/*
============================================================
LIFE CONFIGURATION
============================================================
*/

const MAX_LIVES = 5;

const LIFE_COOLDOWN_MINUTES = 60;

const LIFE_COOLDOWN_SECONDS =
    LIFE_COOLDOWN_MINUTES * 60;

const LIFE_COOLDOWN_MS =
    LIFE_COOLDOWN_SECONDS * 1000;


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
VALIDATION
============================================================
*/

function isValidDifficulty(difficulty) {

    return Object.prototype.hasOwnProperty.call(
        GAME_CONFIG,
        difficulty
    );

}


/*
============================================================
GENERATE COMPLETION TOKEN
============================================================
*/

function generateCompletionToken() {

    return crypto.randomUUID();

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
DATE HELPERS
============================================================
*/

function calculateNextLifeAt(lastLifeAt) {

    if (!lastLifeAt) {
        return null;
    }

    return new Date(
        new Date(lastLifeAt).getTime() +
        LIFE_COOLDOWN_MS
    );

}


function calculateSecondsUntil(date) {

    if (!date) {
        return null;
    }

    const milliseconds =
        new Date(date).getTime() -
        Date.now();

    return Math.max(
        0,
        Math.ceil(
            milliseconds / 1000
        )
    );

}


/*
============================================================
RECOVER LIVES
============================================================

IMPORTANT

last_life_at represents the beginning of the
current regeneration chain.

Example:

5 lives
↓
start game
↓
4 lives
last_life_at = NOW()

After 60 minutes:

4 → 5
last_life_at = NULL


Example:

1 life
last_life_at = 3 hours ago

3 hours elapsed:

1 + 3 = 4 lives

The remaining recovery time is preserved.
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


    if (result.rowCount === 0) {

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
    PROTECT INVALID LIFE VALUES
    --------------------------------------------------------
    */

    if (
        !Number.isInteger(lives) ||
        lives < 0
    ) {

        lives = 0;

    }


    lives =
        Math.min(
            MAX_LIVES,
            lives
        );


    /*
    --------------------------------------------------------
    ALREADY FULL
    --------------------------------------------------------
    */

    if (lives >= MAX_LIVES) {

        await client.query(
            `
            UPDATE users
            SET
                lives = $1,
                last_life_at = NULL,
                updated_at = NOW()
            WHERE id = $2
            `,
            [
                MAX_LIVES,
                userId
            ]
        );


        return {

            lives: MAX_LIVES,

            nextLifeAt: null,

            secondsUntilNextLife: 0,

            maxLives: MAX_LIVES

        };

    }


    /*
    --------------------------------------------------------
    NO ACTIVE TIMER
    --------------------------------------------------------
    */

    if (!user.last_life_at) {

        return {

            lives,

            nextLifeAt: null,

            secondsUntilNextLife: null,

            maxLives: MAX_LIVES

        };

    }


    /*
    --------------------------------------------------------
    CURRENT TIME
    --------------------------------------------------------
    */

    const lastLifeAt =
        new Date(
            user.last_life_at
        );

    const now =
        new Date();


    /*
    --------------------------------------------------------
    INVALID DATABASE DATE
    --------------------------------------------------------
    */

    if (
        Number.isNaN(
            lastLifeAt.getTime()
        )
    ) {

        await client.query(
            `
            UPDATE users
            SET
                last_life_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
            `,
            [userId]
        );


        const nextLifeAt =
            new Date(
                Date.now() +
                LIFE_COOLDOWN_MS
            );


        return {

            lives,

            nextLifeAt,

            secondsUntilNextLife:
                calculateSecondsUntil(
                    nextLifeAt
                ),

            maxLives: MAX_LIVES

        };

    }


    /*
    --------------------------------------------------------
    FUTURE TIMESTAMP PROTECTION
    --------------------------------------------------------
    */

    const elapsedMilliseconds =
        now.getTime() -
        lastLifeAt.getTime();


    if (elapsedMilliseconds < 0) {

        const nextLifeAt =
            calculateNextLifeAt(
                lastLifeAt
            );


        return {

            lives,

            nextLifeAt,

            secondsUntilNextLife:
                calculateSecondsUntil(
                    nextLifeAt
                ),

            maxLives: MAX_LIVES

        };

    }


    /*
    --------------------------------------------------------
    CALCULATE RECOVERED LIVES
    --------------------------------------------------------
    */

    const recoveredLives =
        Math.floor(
            elapsedMilliseconds /
            LIFE_COOLDOWN_MS
        );


    /*
    --------------------------------------------------------
    NOTHING RECOVERED YET
    --------------------------------------------------------
    */

    if (recoveredLives <= 0) {

        const nextLifeAt =
            calculateNextLifeAt(
                lastLifeAt
            );


        return {

            lives,

            nextLifeAt,

            secondsUntilNextLife:
                calculateSecondsUntil(
                    nextLifeAt
                ),

            maxLives: MAX_LIVES

        };

    }


    /*
    --------------------------------------------------------
    CALCULATE NEW LIFE COUNT
    --------------------------------------------------------
    */

    const newLives =
        Math.min(
            MAX_LIVES,
            lives + recoveredLives
        );


    /*
    --------------------------------------------------------
    ALL LIVES RECOVERED
    --------------------------------------------------------
    */

    if (newLives >= MAX_LIVES) {

        await client.query(
            `
            UPDATE users
            SET
                lives = $1,
                last_life_at = NULL,
                updated_at = NOW()
            WHERE id = $2
            `,
            [
                MAX_LIVES,
                userId
            ]
        );


        return {

            lives: MAX_LIVES,

            nextLifeAt: null,

            secondsUntilNextLife: 0,

            maxLives: MAX_LIVES

        };

    }


    /*
    --------------------------------------------------------
    PRESERVE REMAINING TIME
    --------------------------------------------------------

    Example:

    lastLifeAt = 2 hours 20 minutes ago

    Recover:
    +2 lives

    Remaining:
    20 minutes

    Therefore we move lastLifeAt forward by
    exactly 2 hours instead of resetting it to NOW.
    --------------------------------------------------------
    */

    const newLastLifeAt =
        new Date(
            lastLifeAt.getTime() +
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
            last_life_at = $2,
            updated_at = NOW()
        WHERE id = $3
        `,
        [
            newLives,
            newLastLifeAt,
            userId
        ]
    );


    const nextLifeAt =
        calculateNextLifeAt(
            newLastLifeAt
        );


    return {

        lives: newLives,

        nextLifeAt,

        secondsUntilNextLife:
            calculateSecondsUntil(
                nextLifeAt
            ),

        maxLives: MAX_LIVES

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

        await client.query(
            "BEGIN"
        );


        /*
        ----------------------------------------------------
        RECOVER LIVES BEFORE STARTING
        ----------------------------------------------------
        */

        const lifeState =
            await recoverLives(
                client,
                userId
            );


        /*
        ----------------------------------------------------
        NO LIVES
        ----------------------------------------------------
        */

        if (lifeState.lives <= 0) {

            await client.query(
                "COMMIT"
            );


            return {

                success: false,

                error: "NO_LIVES",

                message:
                    "No lives available. Please wait for the next life.",

                lives: 0,

                maxLives:
                    MAX_LIVES,

                nextLifeAt:
                    lifeState.nextLifeAt,

                secondsUntilNextLife:
                    lifeState.secondsUntilNextLife,

                lifeCooldownMinutes:
                    LIFE_COOLDOWN_MINUTES

            };

        }


        /*
        ----------------------------------------------------
        CONSUME ONE LIFE
        ----------------------------------------------------

        If:

        5 → 4

        start regeneration timer.

        If already:

        4 → 3

        keep the existing regeneration timer.
        ----------------------------------------------------
        */

        const updatedUser =
            await client.query(
                `
                UPDATE users
                SET

                    lives =
                        lives - 1,

                    last_life_at =
                        CASE

                            WHEN lives = $1
                            THEN NOW()

                            ELSE last_life_at

                        END,

                    updated_at = NOW()

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


        if (updatedUser.rowCount === 0) {

            throw new Error(
                "User not found"
            );

        }


        const user =
            updatedUser.rows[0];


        /*
        ----------------------------------------------------
        COMPLETION TOKEN
        ----------------------------------------------------
        */

        const completionToken =
            generateCompletionToken();


        /*
        ----------------------------------------------------
        GET CURRENT LEVEL
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


        if (levelResult.rowCount === 0) {

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
        CREATE GAME SESSION
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
        NEXT LIFE
        ----------------------------------------------------
        */

        const nextLifeAt =
            user.last_life_at
                ? calculateNextLifeAt(
                    user.last_life_at
                )
                : null;


        const secondsUntilNextLife =
            calculateSecondsUntil(
                nextLifeAt
            );


        /*
        ----------------------------------------------------
        RETURN GAME
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

            maxLives:
                MAX_LIVES,

            nextLifeAt,

            secondsUntilNextLife,

            lifeCooldownMinutes:
                LIFE_COOLDOWN_MINUTES

        };

    } catch (error) {

        try {

            await client.query(
                "ROLLBACK"
            );

        } catch {
            // Ignore rollback error.
        }

        throw error;

    } finally {

        client.release();

    }

}


/*
============================================================
COMPLETE GAME
============================================================

IMPORTANT:

This function ONLY gives the normal reward.

The client cannot request:

doubleReward = true

or:

multiplier = 2

The double reward must be granted by a separate
server-verified AdsGram reward flow.

Normal rewards:

Easy   = 10
Medium = 12
Hard   = 15
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
        LOCK GAME SESSION
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


        if (sessionResult.rowCount === 0) {

            throw new Error(
                "Game session not found"
            );

        }


        const session =
            sessionResult.rows[0];


        /*
        ----------------------------------------------------
        DUPLICATE COMPLETION
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
        VERIFY TOKEN
        ----------------------------------------------------
        */

        if (
            !completionToken ||
            completionToken !==
            session.completion_token
        ) {

            throw new Error(
                "Invalid completion token"
            );

        }


        /*
        ----------------------------------------------------
        VALIDATE MOVES
        ----------------------------------------------------
        */

        const parsedMoves =
            Number(moves);


        if (
            !Number.isInteger(
                parsedMoves
            ) ||
            parsedMoves < 0 ||
            parsedMoves > 10000
        ) {

            throw new Error(
                "Invalid moves"
            );

        }


        /*
        ----------------------------------------------------
        VALIDATE DURATION
        ----------------------------------------------------
        */

        const parsedDuration =
            Number(
                durationSeconds
            );


        if (
            !Number.isFinite(
                parsedDuration
            ) ||
            parsedDuration < 0 ||
            parsedDuration > 86400
        ) {

            throw new Error(
                "Invalid duration"
            );

        }


        const safeMoves =
            Math.floor(
                parsedMoves
            );


        const safeDuration =
            Math.floor(
                parsedDuration
            );


        /*
        ----------------------------------------------------
        NORMAL REWARD
        ----------------------------------------------------
        */

        const reward =
            Number(
                session.reward_coins
            );


        if (
            !Number.isSafeInteger(
                reward
            ) ||
            reward <= 0
        ) {

            throw new Error(
                "Invalid game reward"
            );

        }


        /*
        ----------------------------------------------------
        LOCK USER
        ----------------------------------------------------
        */

        const balanceResult =
            await client.query(
                `
                SELECT
                    coins,
                    today_coins,
                    lives

                FROM users

                WHERE id = $1

                FOR UPDATE
                `,
                [userId]
            );


        if (balanceResult.rowCount === 0) {

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
        MARK GAME COMPLETED
        ----------------------------------------------------
        */

        const completionResult =
            await client.query(
                `
                UPDATE game_sessions

                SET

                    status = 'completed',

                    completed_at = NOW(),

                    moves = $1,

                    duration_seconds = $2

                WHERE
                    id = $3
                    AND status = 'started'

                RETURNING id
                `,
                [
                    safeMoves,
                    safeDuration,
                    gameId
                ]
            );


        if (completionResult.rowCount === 0) {

            throw new Error(
                "Game could not be completed"
            );

        }


        /*
        ----------------------------------------------------
        UPDATE USER
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

                        END,

                    updated_at = NOW()

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


        if (userResult.rowCount === 0) {

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
        GAME RESULT
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
                Number(session.level),
                reward,
                safeMoves,
                safeDuration
            ]
        );


        /*
        ----------------------------------------------------
        COIN TRANSACTION
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
                'game_reward',
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
                gameId,
                `Completed ${session.difficulty} memory game`
            ]
        );


        await client.query(
            "COMMIT"
        );


        /*
        ----------------------------------------------------
        RETURN RESULT
        ----------------------------------------------------
        */

        return {

            success: true,

            reward,

            baseReward:
                reward,

            multiplier: 1,

            doubleReward: false,

            doubleRewardAvailable: true,

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
                ),

            maxLives:
                MAX_LIVES

        };

    } catch (error) {

        try {

            await client.query(
                "ROLLBACK"
            );

        } catch {
            // Ignore rollback error.
        }

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
        RECOVER LIVES
        ----------------------------------------------------
        */

        const lifeState =
            await recoverLives(
                client,
                userId
            );


        /*
        ----------------------------------------------------
        GET USER
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


        if (result.rowCount === 0) {

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
        RETURN STATUS
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

            /*
            ------------------------------------------------
            LIFE INFORMATION
            ------------------------------------------------
            */

            lives:
                Number(
                    lifeState.lives
                ),

            maxLives:
                MAX_LIVES,

            nextLifeAt:
                lifeState.nextLifeAt,

            secondsUntilNextLife:
                lifeState.secondsUntilNextLife,

            lifeCooldownMinutes:
                LIFE_COOLDOWN_MINUTES,

            lifeCooldownSeconds:
                LIFE_COOLDOWN_SECONDS

        };

    } catch (error) {

        try {

            await client.query(
                "ROLLBACK"
            );

        } catch {
            // Ignore rollback error.
        }

        throw error;

    } finally {

        client.release();

    }

}

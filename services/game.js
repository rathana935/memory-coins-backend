import crypto from "crypto";
import pool from "../db/pool.js";

/*
============================================================
MEMORY CARD - GAME SERVICE
============================================================

GAME RULES
------------------------------------------------------------
Easy:
- 2 x 4 cards
- 4 pairs
- 10 coins
- 100 games

Medium:
- 3 x 4 cards
- 6 pairs
- 12 coins
- 100 games

Hard:
- 4 x 4 cards
- 8 pairs
- 15 coins
- 100 games

LIVES
------------------------------------------------------------
- Maximum 5 lives
- Starting a game consumes 1 life
- 1 life regenerates every 60 minutes
- Server controls regeneration

REWARDS
------------------------------------------------------------
Normal game:
    Easy   = +10
    Medium = +12
    Hard   = +15

Double Reward:
    Easy   = +10 extra
    Medium = +12 extra
    Hard   = +15 extra

IMPORTANT
------------------------------------------------------------
Double Reward is NOT granted by the client.

The server must:
1. Verify the game session
2. Verify it belongs to the user
3. Verify it is completed
4. Verify the base reward from the database
5. Verify the AdsGram reward separately
6. Prevent the same game from being doubled twice
7. Add the extra reward transactionally

SECURITY
------------------------------------------------------------
- Server controls rewards
- Server controls game sessions
- Server generates completion token
- Duplicate completion blocked
- Balance updates are transactional
- Client cannot request arbitrary reward
- Client cannot request multiplier
- Client cannot choose double reward amount
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
        reward: 10,
        maxGames: 100
    },

    medium: {
        rows: 3,
        cols: 4,
        pairs: 6,
        reward: 12,
        maxGames: 100
    },

    hard: {
        rows: 4,
        cols: 4,
        pairs: 8,
        reward: 15,
        maxGames: 100
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
UUID VALIDATION
============================================================
*/

function isValidUUID(value) {

    if (
        typeof value !== "string"
    ) {
        return false;
    }

    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value);

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
    FULL LIVES
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


    const lastLifeAt =
        new Date(
            user.last_life_at
        );


    const now =
        new Date();


    /*
    --------------------------------------------------------
    INVALID DATE PROTECTION
    --------------------------------------------------------
    */

    if (
        Number.isNaN(
            lastLifeAt.getTime()
        )
    ) {

        const nextLifeAt =
            new Date(
                Date.now() +
                LIFE_COOLDOWN_MS
            );


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
        GET USER PROGRESS
        ----------------------------------------------------
        */

        const userResult =
            await client.query(
                `
                SELECT
                    id,
                    lives,
                    easy_level,
                    medium_level,
                    hard_level,
                    easy_games,
                    medium_games,
                    hard_games
                FROM users
                WHERE id = $1
                FOR UPDATE
                `,
                [userId]
            );


        if (userResult.rowCount === 0) {

            throw new Error(
                "User not found"
            );

        }


        const user =
            userResult.rows[0];


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

                maxLives: MAX_LIVES,

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
        GET DIFFICULTY PROGRESS
        ----------------------------------------------------
        */

        let currentLevel;
        let completedGames;


        if (difficulty === "easy") {

            currentLevel =
                Number(user.easy_level);

            completedGames =
                Number(user.easy_games);

        }

        else if (difficulty === "medium") {

            currentLevel =
                Number(user.medium_level);

            completedGames =
                Number(user.medium_games);

        }

        else {

            currentLevel =
                Number(user.hard_level);

            completedGames =
                Number(user.hard_games);

        }


        /*
        ----------------------------------------------------
        PROTECT INVALID PROGRESS
        ----------------------------------------------------
        */

        if (
            !Number.isInteger(currentLevel) ||
            currentLevel < 1
        ) {

            currentLevel = 1;

        }


        if (
            !Number.isInteger(completedGames) ||
            completedGames < 0
        ) {

            completedGames = 0;

        }


        /*
        ----------------------------------------------------
        100 GAME LIMIT
        ----------------------------------------------------
        */

        if (
            completedGames >=
            config.maxGames
        ) {

            await client.query(
                "COMMIT"
            );


            return {

                success: false,

                error: "LEVELS_COMPLETED",

                message:
                    `${difficulty} difficulty is already completed.`,

                difficulty,

                completedGames:
                    config.maxGames,

                maxGames:
                    config.maxGames,

                level:
                    Math.min(
                        config.maxGames,
                        currentLevel
                    ),

                lives:
                    Number(
                        lifeState.lives
                    ),

                maxLives:
                    MAX_LIVES

            };

        }


        /*
        ----------------------------------------------------
        NORMALIZE LEVEL
        ----------------------------------------------------
        */

        const level =
            Math.min(
                config.maxGames,
                Math.max(
                    1,
                    currentLevel
                )
            );


        /*
        ----------------------------------------------------
        CONSUME ONE LIFE
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

                WHERE
                    id = $2
                    AND lives > 0

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
                "Unable to consume life"
            );

        }


        const updated =
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


        const nextLifeAt =
            updated.last_life_at
                ? calculateNextLifeAt(
                    updated.last_life_at
                )
                : null;


        const secondsUntilNextLife =
            calculateSecondsUntil(
                nextLifeAt
            );


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
                    updated.lives
                ),

            maxLives:
                MAX_LIVES,

            nextLifeAt,

            secondsUntilNextLife,

            lifeCooldownMinutes:
                LIFE_COOLDOWN_MINUTES,

            lifeCooldownSeconds:
                LIFE_COOLDOWN_SECONDS

        };

    }

    catch (error) {

        try {

            await client.query(
                "ROLLBACK"
            );

        } catch {}

        throw error;

    }

    finally {

        client.release();

    }

}


/*
============================================================
COMPLETE GAME
============================================================

Normal completion only.

This function NEVER accepts:
- doubleReward
- multiplier
- extraCoins
- rewardAmount
============================================================
*/

export async function completeGame({

    userId,

    gameId,

    completionToken,

    moves,

    durationSeconds

}) {

    if (!isValidUUID(gameId)) {

        throw new Error(
            "Invalid game ID"
        );

    }


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
            session.status === "completed"
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
        VERIFY STATUS
        ----------------------------------------------------
        */

        if (
            session.status !== "started"
        ) {

            throw new Error(
                "Game session is not active"
            );

        }


        /*
        ----------------------------------------------------
        VERIFY TOKEN
        ----------------------------------------------------
        */

        if (
            typeof completionToken !== "string" ||
            completionToken.length < 20 ||
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
        VERIFY SERVER REWARD
        ----------------------------------------------------
        */

        const config =
            GAME_CONFIG[
                session.difficulty
            ];


        if (!config) {

            throw new Error(
                "Invalid game difficulty"
            );

        }


        const reward =
            Number(
                session.reward_coins
            );


        if (
            reward !==
            config.reward
        ) {

            throw new Error(
                "Invalid game reward"
            );

        }


        /*
        ----------------------------------------------------
        VERIFY LEVEL
        ----------------------------------------------------
        */

        const sessionLevel =
            Number(
                session.level
            );


        if (
            !Number.isInteger(
                sessionLevel
            ) ||
            sessionLevel < 1 ||
            sessionLevel > config.maxGames
        ) {

            throw new Error(
                "Invalid game level"
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
                    lives,
                    games_played,
                    easy_games,
                    medium_games,
                    hard_games

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


        const dbUser =
            balanceResult.rows[0];


        const balanceBefore =
            Number(
                dbUser.coins
            );


        if (
            !Number.isSafeInteger(
                balanceBefore
            ) ||
            balanceBefore < 0
        ) {

            throw new Error(
                "Invalid user balance"
            );

        }


        /*
        ----------------------------------------------------
        CURRENT DIFFICULTY PROGRESS
        ----------------------------------------------------
        */

        let currentCompletedGames;


        if (
            session.difficulty === "easy"
        ) {

            currentCompletedGames =
                Number(
                    dbUser.easy_games
                );

        }

        else if (
            session.difficulty === "medium"
        ) {

            currentCompletedGames =
                Number(
                    dbUser.medium_games
                );

        }

        else {

            currentCompletedGames =
                Number(
                    dbUser.hard_games
                );

        }


        if (
            !Number.isInteger(
                currentCompletedGames
            ) ||
            currentCompletedGames < 0
        ) {

            throw new Error(
                "Invalid game progress"
            );

        }


        if (
            currentCompletedGames >=
            config.maxGames
        ) {

            throw new Error(
                "Difficulty already completed"
            );

        }


        /*
        ----------------------------------------------------
        MARK SESSION COMPLETED
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
                    AND user_id = $4
                    AND status = 'started'

                RETURNING id
                `,
                [
                    safeMoves,
                    safeDuration,
                    gameId,
                    userId
                ]
            );


        if (completionResult.rowCount === 0) {

            throw new Error(
                "Game could not be completed"
            );

        }


        /*
        ----------------------------------------------------
        UPDATE USER BALANCE
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
                            THEN LEAST(
                                100,
                                easy_games + 1
                            )
                            ELSE easy_games
                        END,

                    medium_games =
                        CASE
                            WHEN $2 = 'medium'
                            THEN LEAST(
                                100,
                                medium_games + 1
                            )
                            ELSE medium_games
                        END,

                    hard_games =
                        CASE
                            WHEN $2 = 'hard'
                            THEN LEAST(
                                100,
                                hard_games + 1
                            )
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
                    lives,
                    easy_games,
                    medium_games,
                    hard_games,
                    easy_level,
                    medium_level,
                    hard_level
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
                sessionLevel,
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


        return {

            success: true,

            reward,

            baseReward:
                reward,

            multiplier: 1,

            doubleReward: false,

            doubleRewardAvailable: true,

            gameSessionId:
                gameId,

            difficulty:
                session.difficulty,

            level:
                sessionLevel,

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
                MAX_LIVES,

            difficultyProgress: {

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

            }

        };

    }

    catch (error) {

        try {

            await client.query(
                "ROLLBACK"
            );

        } catch {}

        throw error;

    }

    finally {

        client.release();

    }

}


/*
============================================================
CHECK DOUBLE REWARD STATUS
============================================================

Returns whether this completed game has already received
a Double Reward.

We use coin_transactions.reference_id so we do NOT need
to add another database column.

A game can have only one successful double reward.
============================================================
*/

export async function getDoubleRewardStatus(
    userId,
    gameId
) {

    if (!isValidUUID(gameId)) {

        throw new Error(
            "Invalid game ID"
        );

    }


    const result =
        await pool.query(
            `
            SELECT
                id,
                difficulty,
                reward_coins,
                status
            FROM game_sessions
            WHERE
                id = $1
                AND user_id = $2
            LIMIT 1
            `,
            [
                gameId,
                userId
            ]
        );


    if (result.rowCount === 0) {

        throw new Error(
            "Game session not found"
        );

    }


    const session =
        result.rows[0];


    const doubleResult =
        await pool.query(
            `
            SELECT id
            FROM coin_transactions
            WHERE
                user_id = $1
                AND reference_id = $2
                AND type = 'double_game_reward'
            LIMIT 1
            `,
            [
                userId,
                gameId
            ]
        );


    return {

        success: true,

        gameSessionId:
            gameId,

        completed:
            session.status === "completed",

        doubleRewarded:
            doubleResult.rowCount > 0,

        baseReward:
            Number(
                session.reward_coins
            ),

        difficulty:
            session.difficulty

    };

}


/*
============================================================
APPLY DOUBLE REWARD
============================================================

This function is intended to be called AFTER:

1. AdsGram reward has been verified
2. The verified ad reward has been consumed
3. The game session has been validated

The function itself is still transactional and checks
again that the same game has not already received the
Double Reward.

IMPORTANT:
The client never supplies the reward amount.
============================================================
*/

export async function applyDoubleReward(
    client,
    userId,
    gameId
) {

    if (!isValidUUID(gameId)) {

        throw new Error(
            "Invalid game ID"
        );

    }


    /*
    --------------------------------------------------------
    LOCK GAME SESSION
    --------------------------------------------------------
    */

    const sessionResult =
        await client.query(
            `
            SELECT
                id,
                user_id,
                difficulty,
                reward_coins,
                status
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
    --------------------------------------------------------
    GAME MUST BE COMPLETED
    --------------------------------------------------------
    */

    if (
        session.status !== "completed"
    ) {

        throw new Error(
            "Game session is not completed"
        );

    }


    /*
    --------------------------------------------------------
    VERIFY SERVER REWARD
    --------------------------------------------------------
    */

    const config =
        GAME_CONFIG[
            session.difficulty
        ];


    if (!config) {

        throw new Error(
            "Invalid game difficulty"
        );

    }


    const extraReward =
        Number(
            session.reward_coins
        );


    if (
        extraReward !==
        config.reward
    ) {

        throw new Error(
            "Invalid game reward"
        );

    }


    /*
    --------------------------------------------------------
    CHECK WHETHER DOUBLE REWARD WAS ALREADY GIVEN
    --------------------------------------------------------

    The game session is locked above.

    Therefore two simultaneous requests for the same game
    cannot both pass this check.
    --------------------------------------------------------
    */

    const existingResult =
        await client.query(
            `
            SELECT id
            FROM coin_transactions
            WHERE
                user_id = $1
                AND reference_id = $2
                AND type = 'double_game_reward'
            LIMIT 1
            `,
            [
                userId,
                gameId
            ]
        );


    if (existingResult.rowCount > 0) {

        return {

            success: false,

            error:
                "DOUBLE_REWARD_ALREADY_CLAIMED",

            message:
                "Double Reward has already been claimed for this game.",

            gameSessionId:
                gameId,

            doubleReward:
                false

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
            "User not found"
        );

    }


    const user =
        userResult.rows[0];


    const balanceBefore =
        Number(
            user.coins
        );


    if (
        !Number.isSafeInteger(
            balanceBefore
        ) ||
        balanceBefore < 0
    ) {

        throw new Error(
            "Invalid user balance"
        );

    }


    /*
    --------------------------------------------------------
    ADD EXTRA REWARD
    --------------------------------------------------------
    */

    const updateResult =
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
                extraReward,
                userId
            ]
        );


    if (updateResult.rowCount === 0) {

        throw new Error(
            "Unable to update user balance"
        );

    }


    const updatedUser =
        updateResult.rows[0];


    const balanceAfter =
        Number(
            updatedUser.coins
        );


    /*
    --------------------------------------------------------
    RECORD DOUBLE REWARD TRANSACTION
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
            extraReward,
            balanceBefore,
            balanceAfter,
            gameId,
            `Double Reward for ${session.difficulty} memory game`
        ]
    );


    return {

        success: true,

        gameSessionId:
            gameId,

        difficulty:
            session.difficulty,

        baseReward:
            extraReward,

        extraReward,

        totalReward:
            extraReward * 2,

        doubleReward:
            true,

        multiplier: 2,

        balance:
            balanceAfter,

        todayCoins:
            Number(
                updatedUser.today_coins
            )

    };

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

            maxLives:
                MAX_LIVES,

            nextLifeAt:
                lifeState.nextLifeAt,

            secondsUntilNextLife:
                lifeState.secondsUntilNextLife,

            lifeCooldownMinutes:
                LIFE_COOLDOWN_MINUTES,

            lifeCooldownSeconds:
                LIFE_COOLDOWN_SECONDS,

            maxGames: {

                easy:
                    GAME_CONFIG.easy.maxGames,

                medium:
                    GAME_CONFIG.medium.maxGames,

                hard:
                    GAME_CONFIG.hard.maxGames

            }

        };

    }

    catch (error) {

        try {

            await client.query(
                "ROLLBACK"
            );

        } catch {}

        throw error;

    }

    finally {

        client.release();

    }

}

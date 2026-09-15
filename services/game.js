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
- Remaining cooldown is preserved

SECURITY
------------------------------------------------------------
- Server controls rewards
- Server controls game sessions
- Server generates completion token
- Duplicate completion blocked
- Balance updates are transactional
- Client cannot request 2x reward
- Ads are NOT trusted from the client
- Double reward will be handled separately
  through verified ad logic
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

Rules:

5 lives
↓
start game
↓
4 lives
↓
60 minutes
↓
5 lives

If several hours pass:

1 life
↓
3 hours later
↓
4 lives
↓
remaining cooldown preserved

The server is always authoritative.
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


    /*
    --------------------------------------------------------
    PARSE TIMESTAMP
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


    /*
    --------------------------------------------------------
    NOTHING RECOVERED
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

    last_life_at = 2h20m ago

    recovered = 2

    remaining = 20 minutes

    We move the original timestamp forward
    by exactly 2 hours.
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
        LOCK USER + RECOVER LIVES
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
        GET CURRENT LEVEL + GAME COUNT
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
        SELECT DIFFICULTY PROGRESS
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

        Each difficulty has exactly 100 games.

        Once 100 games are completed, that difficulty
        cannot be started again.
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
                        user.lives
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

        If 5 → 4:
            start timer.

        If 4 → 3:
            preserve existing timer.
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


        /*
        ----------------------------------------------------
        NEXT LIFE
        ----------------------------------------------------
        */

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

        }

        catch {
            // Ignore rollback error.
        }

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

IMPORTANT:

The client cannot request:

doubleReward
multiplier
extraCoins
rewardAmount

The normal reward ALWAYS comes from the
server-created game session.

Ads / double reward are handled separately.
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
        VERIFY SESSION STATUS
        ----------------------------------------------------
        */

        if (
            session.status !==
            "started"
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
        VALIDATE GAME ID
        ----------------------------------------------------
        */

        if (!gameId) {

            throw new Error(
                "Invalid game ID"
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
        VERIFY REWARD FROM DATABASE
        ----------------------------------------------------
        */

        const reward =
            Number(
                session.reward_coins
            );


        const config =
            GAME_CONFIG[
                session.difficulty
            ];


        if (!config) {

            throw new Error(
                "Invalid game difficulty"
            );

        }


        /*
        IMPORTANT:

        Reward must match the server configuration.

        This protects the database if a game session
        somehow contains an invalid reward.
        ----------------------------------------------------
        */

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


        /*
        ----------------------------------------------------
        PROTECT BALANCE
        ----------------------------------------------------
        */

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
        VERIFY DIFFICULTY PROGRESS
        ----------------------------------------------------
        */

        let currentCompletedGames;


        if (
            session.difficulty ===
            "easy"
        ) {

            currentCompletedGames =
                Number(
                    dbUser.easy_games
                );

        }

        else if (
            session.difficulty ===
            "medium"
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


        /*
        ----------------------------------------------------
        PREVENT COMPLETING MORE THAN 100
        ----------------------------------------------------
        */

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
        UPDATE USER BALANCE + PROGRESS
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

            /*
            The normal game completion is always x1.

            Client cannot change this value.
            */
            multiplier: 1,

            doubleReward: false,

            /*
            This only tells the frontend that a
            separate verified ad reward may be offered.

            It does NOT grant anything.
            */
            doubleRewardAvailable: true,

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

        }

        catch {
            // Ignore rollback error.
        }

        throw error;

    }

    finally {

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
                LIFE_COOLDOWN_SECONDS,

            /*
            ------------------------------------------------
            DIFFICULTY LIMITS
            ------------------------------------------------
            */

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

        }

        catch {
            // Ignore rollback error.
        }

        throw error;

    }

    finally {

        client.release();

    }

}

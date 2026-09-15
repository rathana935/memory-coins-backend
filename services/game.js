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

Double Reward is handled ONLY by:
    services/rewards.js

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

IMPORTANT
------------------------------------------------------------
The current completion-token system prevents simple
unauthorized requests, but a production version should
eventually use server-verifiable puzzle state to prove
that the player actually matched all cards.

The server NEVER trusts:
- client reward amount
- client multiplier
- client coin amount
- client "doubleReward" value
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

function isValidDifficulty(
    difficulty
) {

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
        .test(
            value.trim()
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

function normalizeGameSessionId(value) {

    return String(
        value ?? ""
    ).trim();

}


/*
============================================================
DATE HELPERS
============================================================
*/

function calculateNextLifeAt(
    lastLifeAt
) {

    if (!lastLifeAt) {

        return null;

    }

    const timestamp =
        new Date(
            lastLifeAt
        ).getTime();


    if (
        Number.isNaN(timestamp)
    ) {

        return null;

    }


    return new Date(
        timestamp +
        LIFE_COOLDOWN_MS
    );

}


function calculateSecondsUntil(
    date
) {

    if (!date) {

        return null;

    }

    const timestamp =
        new Date(
            date
        ).getTime();


    if (
        Number.isNaN(timestamp)
    ) {

        return null;

    }


    const milliseconds =
        timestamp -
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

IMPORTANT:

The user row is locked with FOR UPDATE.

This prevents two simultaneous requests from recovering
the same life twice.
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


    if (
        result.rowCount === 0
    ) {

        const error =
            new Error(
                "USER_NOT_FOUND"
            );

        error.code =
            "USER_NOT_FOUND";

        throw error;

    }


    const user =
        result.rows[0];


    let lives =
        Number(
            user.lives
        );


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

    if (
        lives >= MAX_LIVES
    ) {

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

            lives:
                MAX_LIVES,

            nextLifeAt:
                null,

            secondsUntilNextLife:
                0,

            maxLives:
                MAX_LIVES

        };

    }


    /*
    --------------------------------------------------------
    NO ACTIVE TIMER
    --------------------------------------------------------
    */

    if (
        !user.last_life_at
    ) {

        return {

            lives,

            nextLifeAt:
                null,

            secondsUntilNextLife:
                null,

            maxLives:
                MAX_LIVES

        };

    }


    const lastLifeAt =
        new Date(
            user.last_life_at
        );


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

            maxLives:
                MAX_LIVES

        };

    }


    /*
    --------------------------------------------------------
    FUTURE TIMESTAMP PROTECTION
    --------------------------------------------------------
    */

    const elapsedMilliseconds =
        Date.now() -
        lastLifeAt.getTime();


    if (
        elapsedMilliseconds < 0
    ) {

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

            maxLives:
                MAX_LIVES

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


    if (
        recoveredLives <= 0
    ) {

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

            maxLives:
                MAX_LIVES

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

    if (
        newLives >= MAX_LIVES
    ) {

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

            lives:
                MAX_LIVES,

            nextLifeAt:
                null,

            secondsUntilNextLife:
                0,

            maxLives:
                MAX_LIVES

        };

    }


    /*
    --------------------------------------------------------
    PRESERVE REMAINING TIME
    --------------------------------------------------------

    Example:

    Last life: 10:00
    Current time: 11:20

    One life recovered at 11:00.

    Next life:
    12:00

    We preserve that remaining 40 minutes.
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

        lives:
            newLives,

        nextLifeAt,

        secondsUntilNextLife:
            calculateSecondsUntil(
                nextLifeAt
            ),

        maxLives:
            MAX_LIVES

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

    if (
        !isValidDifficulty(
            difficulty
        )
    ) {

        const error =
            new Error(
                "INVALID_DIFFICULTY"
            );

        error.code =
            "INVALID_DIFFICULTY";

        throw error;

    }


    const config =
        GAME_CONFIG[
            difficulty
        ];


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
        GET USER PROGRESS

        The row is already locked by recoverLives(),
        but FOR UPDATE is kept here for clarity.
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


        if (
            userResult.rowCount === 0
        ) {

            const error =
                new Error(
                    "USER_NOT_FOUND"
                );

            error.code =
                "USER_NOT_FOUND";

            throw error;

        }


        const user =
            userResult.rows[0];


        /*
        ----------------------------------------------------
        NO LIVES
        ----------------------------------------------------
        */

        if (
            lifeState.lives <= 0
        ) {

            await client.query(
                "COMMIT"
            );


            return {

                success:
                    false,

                error:
                    "NO_LIVES",

                message:
                    "No lives available. Please wait for the next life.",

                lives:
                    0,

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

        }


        /*
        ----------------------------------------------------
        GET DIFFICULTY PROGRESS
        ----------------------------------------------------
        */

        let currentLevel;
        let completedGames;


        if (
            difficulty === "easy"
        ) {

            currentLevel =
                Number(
                    user.easy_level
                );

            completedGames =
                Number(
                    user.easy_games
                );

        }

        else if (
            difficulty === "medium"
        ) {

            currentLevel =
                Number(
                    user.medium_level
                );

            completedGames =
                Number(
                    user.medium_games
                );

        }

        else {

            currentLevel =
                Number(
                    user.hard_level
                );

            completedGames =
                Number(
                    user.hard_games
                );

        }


        /*
        ----------------------------------------------------
        PROTECT INVALID PROGRESS
        ----------------------------------------------------
        */

        if (
            !Number.isInteger(
                currentLevel
            ) ||
            currentLevel < 1
        ) {

            currentLevel = 1;

        }


        if (
            !Number.isInteger(
                completedGames
            ) ||
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

                success:
                    false,

                error:
                    "LEVELS_COMPLETED",

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


        if (
            updatedUser.rowCount === 0
        ) {

            const error =
                new Error(
                    "UNABLE_TO_CONSUME_LIFE"
                );

            error.code =
                "UNABLE_TO_CONSUME_LIFE";

            throw error;

        }


        const updated =
            updatedUser.rows[0];


        /*
        ----------------------------------------------------
        GENERATE COMPLETION TOKEN
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


        if (
            sessionResult.rowCount === 0
        ) {

            throw new Error(
                "GAME_SESSION_CREATE_FAILED"
            );

        }


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

            success:
                true,

            game: {

                id:
                    normalizeGameSessionId(
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

NORMAL REWARD ONLY.

This function deliberately does NOT accept:
- reward
- coins
- extraCoins
- multiplier
- doubleReward
- doubleRewardVerified

The normal reward always comes from the server-side
game session/database configuration.
============================================================
*/

export async function completeGame({

    userId,

    gameId,

    completionToken,

    moves,

    durationSeconds

}) {

    const normalizedGameId =
        normalizeGameSessionId(
            gameId
        );


    /*
    --------------------------------------------------------
    VALIDATE GAME ID
    --------------------------------------------------------
    */

    if (
        !isValidUUID(
            normalizedGameId
        )
    ) {

        const error =
            new Error(
                "INVALID_GAME_ID"
            );

        error.code =
            "INVALID_GAME_ID";

        throw error;

    }


    /*
    --------------------------------------------------------
    VALIDATE COMPLETION TOKEN
    --------------------------------------------------------
    */

    if (
        typeof completionToken !==
        "string" ||
        completionToken.length < 20 ||
        completionToken.length > 200
    ) {

        const error =
            new Error(
                "INVALID_COMPLETION_TOKEN"
            );

        error.code =
            "INVALID_COMPLETION_TOKEN";

        throw error;

    }


    /*
    --------------------------------------------------------
    VALIDATE MOVES
    --------------------------------------------------------
    */

    const parsedMoves =
        Number(
            moves
        );


    if (
        !Number.isInteger(
            parsedMoves
        ) ||
        parsedMoves < 0 ||
        parsedMoves > 10000
    ) {

        const error =
            new Error(
                "INVALID_MOVES"
            );

        error.code =
            "INVALID_MOVES";

        throw error;

    }


    /*
    --------------------------------------------------------
    VALIDATE DURATION
    --------------------------------------------------------
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

        const error =
            new Error(
                "INVALID_DURATION"
            );

        error.code =
            "INVALID_DURATION";

        throw error;

    }


    const safeMoves =
        Math.floor(
            parsedMoves
        );


    const safeDuration =
        Math.floor(
            parsedDuration
        );


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
                    normalizedGameId,
                    userId
                ]
            );


        if (
            sessionResult.rowCount === 0
        ) {

            const error =
                new Error(
                    "GAME_SESSION_NOT_FOUND"
                );

            error.code =
                "GAME_SESSION_NOT_FOUND";

            throw error;

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

                success:
                    false,

                error:
                    "ALREADY_COMPLETED",

                message:
                    "This game has already been completed.",

                gameSessionId:
                    normalizedGameId

            };

        }


        /*
        ----------------------------------------------------
        VERIFY ACTIVE STATUS
        ----------------------------------------------------
        */

        if (
            session.status !==
            "started"
        ) {

            const error =
                new Error(
                    "GAME_NOT_ACTIVE"
                );

            error.code =
                "GAME_NOT_ACTIVE";

            throw error;

        }


        /*
        ----------------------------------------------------
        VERIFY COMPLETION TOKEN
        ----------------------------------------------------
        */

        if (
            completionToken !==
            session.completion_token
        ) {

            const error =
                new Error(
                    "INVALID_COMPLETION_TOKEN"
                );

            error.code =
                "INVALID_COMPLETION_TOKEN";

            throw error;

        }


        /*
        ----------------------------------------------------
        SERVER GAME CONFIG
        ----------------------------------------------------
        */

        const config =
            GAME_CONFIG[
                session.difficulty
            ];


        if (!config) {

            const error =
                new Error(
                    "INVALID_GAME_DIFFICULTY"
                );

            error.code =
                "INVALID_GAME_DIFFICULTY";

            throw error;

        }


        /*
        ----------------------------------------------------
        VERIFY DATABASE GAME SETTINGS
        ----------------------------------------------------
        */

        const sessionReward =
            Number(
                session.reward_coins
            );


        const sessionPairs =
            Number(
                session.pairs
            );


        if (
            sessionReward !==
            config.reward
        ) {

            const error =
                new Error(
                    "INVALID_GAME_REWARD"
                );

            error.code =
                "INVALID_GAME_REWARD";

            throw error;

        }


        if (
            sessionPairs !==
            config.pairs
        ) {

            const error =
                new Error(
                    "INVALID_GAME_PAIRS"
                );

            error.code =
                "INVALID_GAME_PAIRS";

            throw error;

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

            const error =
                new Error(
                    "INVALID_GAME_LEVEL"
                );

            error.code =
                "INVALID_GAME_LEVEL";

            throw error;

        }


        /*
        ----------------------------------------------------
        VERIFY START TIME
        ----------------------------------------------------
        */

        if (
            !session.started_at
        ) {

            const error =
                new Error(
                    "INVALID_GAME_START_TIME"
                );

            error.code =
                "INVALID_GAME_START_TIME";

            throw error;

        }


        /*
        ----------------------------------------------------
        BASIC SERVER-SIDE TIME CHECK
        ----------------------------------------------------

        Prevent impossible negative completion time.

        We intentionally do NOT require the client duration
        to exactly equal server duration because mobile
        network latency can affect it.

        Production puzzle verification should eventually
        use a server-issued puzzle state.
        ----------------------------------------------------
        */

        const startedAt =
            new Date(
                session.started_at
            ).getTime();


        if (
            Number.isNaN(
                startedAt
            )
        ) {

            const error =
                new Error(
                    "INVALID_GAME_START_TIME"
                );

            error.code =
                "INVALID_GAME_START_TIME";

            throw error;

        }


        const serverElapsedSeconds =
            Math.floor(
                (
                    Date.now() -
                    startedAt
                ) / 1000
            );


        if (
            serverElapsedSeconds < 0
        ) {

            const error =
                new Error(
                    "INVALID_GAME_TIME"
                );

            error.code =
                "INVALID_GAME_TIME";

            throw error;

        }


        /*
        ----------------------------------------------------
        MINIMUM REAL SERVER TIME

        A game cannot be completed before it actually
        started.

        We use a small tolerance for clock/network behavior.
        ----------------------------------------------------
        */

        const minimumAllowedDuration =
            Math.max(
                0,
                serverElapsedSeconds - 5
            );


        if (
            safeDuration >
            serverElapsedSeconds + 5
        ) {

            const error =
                new Error(
                    "INVALID_GAME_DURATION"
                );

            error.code =
                "INVALID_GAME_DURATION";

            throw error;

        }


        if (
            safeDuration <
            0
        ) {

            const error =
                new Error(
                    "INVALID_GAME_DURATION"
                );

            error.code =
                "INVALID_GAME_DURATION";

            throw error;

        }


        /*
        ----------------------------------------------------
        NOTE

        `minimumAllowedDuration` is intentionally calculated
        above for future puzzle verification.

        We don't reject short mobile durations here because
        the server currently cannot know how fast the player
        legitimately solved the puzzle.

        The actual puzzle-state verification should be added
        before production real-money launch.
        ----------------------------------------------------
        */

        void minimumAllowedDuration;


        /*
        ----------------------------------------------------
        LOCK USER
        ----------------------------------------------------
        */

        const userResult =
            await client.query(
                `
                SELECT
                    id,
                    coins,
                    today_coins,
                    lives,
                    games_played,
                    easy_games,
                    medium_games,
                    hard_games,
                    easy_level,
                    medium_level,
                    hard_level,
                    is_blocked

                FROM users

                WHERE id = $1

                FOR UPDATE
                `,
                [userId]
            );


        if (
            userResult.rowCount === 0
        ) {

            const error =
                new Error(
                    "USER_NOT_FOUND"
                );

            error.code =
                "USER_NOT_FOUND";

            throw error;

        }


        const user =
            userResult.rows[0];


        if (
            user.is_blocked
        ) {

            const error =
                new Error(
                    "USER_BLOCKED"
                );

            error.code =
                "USER_BLOCKED";

            throw error;

        }


        /*
        ----------------------------------------------------
        VERIFY BALANCE
        ----------------------------------------------------
        */

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

            const error =
                new Error(
                    "INVALID_USER_BALANCE"
                );

            error.code =
                "INVALID_USER_BALANCE";

            throw error;

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
                    user.easy_games
                );

        }

        else if (
            session.difficulty ===
            "medium"
        ) {

            currentCompletedGames =
                Number(
                    user.medium_games
                );

        }

        else {

            currentCompletedGames =
                Number(
                    user.hard_games
                );

        }


        if (
            !Number.isInteger(
                currentCompletedGames
            ) ||
            currentCompletedGames < 0
        ) {

            const error =
                new Error(
                    "INVALID_GAME_PROGRESS"
                );

            error.code =
                "INVALID_GAME_PROGRESS";

            throw error;

        }


        /*
        ----------------------------------------------------
        LEVEL CONSISTENCY CHECK
        ----------------------------------------------------

        The session level should represent the next game
        number.

        We allow an existing session to complete even if
        another field has changed, but never allow progress
        beyond 100.
        ----------------------------------------------------
        */

        if (
            currentCompletedGames >=
            config.maxGames
        ) {

            const error =
                new Error(
                    "DIFFICULTY_ALREADY_COMPLETED"
                );

            error.code =
                "DIFFICULTY_ALREADY_COMPLETED";

            throw error;

        }


        /*
        ----------------------------------------------------
        PREVENT IMPOSSIBLE LEVEL JUMP
        ----------------------------------------------------
        */

        if (
            sessionLevel >
            currentCompletedGames + 1
        ) {

            const error =
                new Error(
                    "INVALID_GAME_PROGRESS"
                );

            error.code =
                "INVALID_GAME_PROGRESS";

            throw error;

        }


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
                    AND user_id = $4
                    AND status = 'started'

                RETURNING
                    id
                `,
                [
                    safeMoves,
                    safeDuration,
                    normalizedGameId,
                    userId
                ]
            );


        if (
            completionResult.rowCount === 0
        ) {

            const error =
                new Error(
                    "GAME_COMPLETION_FAILED"
                );

            error.code =
                "GAME_COMPLETION_FAILED";

            throw error;

        }


        /*
        ----------------------------------------------------
        UPDATE USER BALANCE + PROGRESS
        ----------------------------------------------------
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
                    sessionReward,
                    session.difficulty,
                    userId
                ]
            );


        if (
            userUpdate.rowCount === 0
        ) {

            const error =
                new Error(
                    "USER_UPDATE_FAILED"
                );

            error.code =
                "USER_UPDATE_FAILED";

            throw error;

        }


        const updatedUser =
            userUpdate.rows[0];


        const balanceAfter =
            Number(
                updatedUser.coins
            );


        /*
        ----------------------------------------------------
        RECORD GAME RESULT
        ----------------------------------------------------
        */

        const gameResult =
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

                RETURNING
                    id
                `,
                [
                    userId,
                    normalizedGameId,
                    session.difficulty,
                    sessionLevel,
                    sessionReward,
                    safeMoves,
                    safeDuration
                ]
            );


        /*
        ----------------------------------------------------
        RECORD NORMAL GAME COIN TRANSACTION
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
                sessionReward,
                balanceBefore,
                balanceAfter,
                normalizedGameId,
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

            success:
                true,

            reward:
                sessionReward,

            baseReward:
                sessionReward,

            multiplier:
                1,

            doubleReward:
                false,

            /*
            This means the completed game is eligible
            to request Double Reward.

            It does NOT mean the ad has already been
            verified.
            */

            doubleRewardAvailable:
                true,

            gameSessionId:
                normalizedGameId,

            gameResultId:
                gameResult.rows[0].id,

            difficulty:
                session.difficulty,

            level:
                sessionLevel,

            balance:
                balanceAfter,

            todayCoins:
                Number(
                    updatedUser.today_coins
                ),

            gamesPlayed:
                Number(
                    updatedUser.games_played
                ),

            lives:
                Number(
                    updatedUser.lives
                ),

            maxLives:
                MAX_LIVES,

            difficultyProgress: {

                easy:
                    Number(
                        updatedUser.easy_games
                    ),

                medium:
                    Number(
                        updatedUser.medium_games
                    ),

                hard:
                    Number(
                        updatedUser.hard_games
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
        RECOVER NATURAL LIVES
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
                    lives,
                    is_blocked

                FROM users

                WHERE id = $1
                `,
                [userId]
            );


        if (
            result.rowCount === 0
        ) {

            const error =
                new Error(
                    "USER_NOT_FOUND"
                );

            error.code =
                "USER_NOT_FOUND";

            throw error;

        }


        const user =
            result.rows[0];


        if (
            user.is_blocked
        ) {

            const error =
                new Error(
                    "USER_BLOCKED"
                );

            error.code =
                "USER_BLOCKED";

            throw error;

        }


        await client.query(
            "COMMIT"
        );


        return {

            success:
                true,

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


/*
============================================================
EXPORT GAME CONFIG

Useful for routes/tests if needed.

Do not expose this object directly to users unless
you intentionally want the frontend to know the rules.
============================================================
*/

export {
    GAME_CONFIG,
    MAX_LIVES,
    LIFE_COOLDOWN_MINUTES,
    LIFE_COOLDOWN_SECONDS
};

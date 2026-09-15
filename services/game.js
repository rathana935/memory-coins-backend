import crypto from "crypto";
import pool from "../db/pool.js";


/*
============================================================
MEMORY COINS - GAME SERVICE
============================================================

Features:

- Start games
- Consume lives
- Recover lives
- Complete games
- Normal game rewards
- Verified 2x reward support
- Prevent duplicate rewards
- Update difficulty levels
- Update coin balance
- Record coin transactions
- Return life cooldown information

IMPORTANT:

Double reward MUST only be enabled after a real
advertisement reward has been verified.

Do NOT trust a simple frontend boolean.
============================================================
*/


const MAX_LIVES = 5;


/*
============================================================
LIFE COOLDOWN
============================================================

1 life is recovered every 60 minutes.

Example:

5 lives
↓ play
4 lives
↓
60 minutes
↓
5 lives
============================================================
*/

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
GENERATE COMPLETION TOKEN
============================================================
*/

function generateCompletionToken() {

    return crypto.randomUUID();

}


/*
============================================================
CONVERT GAME SESSION ID
============================================================
*/

function gameSessionId(
    value
) {

    return String(value);

}


/*
============================================================
GET NEXT LIFE TIME
============================================================

If last_life_at represents when the first
currently-recovering life was lost:

nextLifeAt =
last_life_at + 60 minutes
============================================================
*/

function calculateNextLifeAt(
    lastLifeAt
) {

    if (!lastLifeAt) {

        return null;

    }


    return new Date(

        new Date(
            lastLifeAt
        ).getTime() +

        LIFE_COOLDOWN_MS

    );

}


/*
============================================================
RECOVER LIVES
============================================================

Maximum = 5

Each completed cooldown gives 1 life.

Example:

0 lives
+
3 hours
=
3 lives

Example:

4 lives
+
1 hour
=
5 lives
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
            [
                userId
            ]
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


    let lives =
        Number(
            user.lives
        );


    /*
    --------------------------------------------------------
    Already full
    --------------------------------------------------------
    */

    if (
        lives >= MAX_LIVES
    ) {

        await client.query(
            `
            UPDATE users

            SET last_life_at = NULL

            WHERE id = $1
            `,
            [
                userId
            ]
        );


        return {

            lives:
                MAX_LIVES,

            nextLifeAt:
                null,

            secondsUntilNextLife:
                0

        };

    }


    /*
    --------------------------------------------------------
    No recovery timer
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
                null

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
    --------------------------------------------------------
    No life recovered yet
    --------------------------------------------------------
    */

    if (
        recoveredLives <= 0
    ) {

        const nextLifeAt =
            calculateNextLifeAt(
                user.last_life_at
            );


        const secondsUntilNextLife =
            Math.max(
                0,
                Math.ceil(
                    (
                        nextLifeAt.getTime() -
                        now.getTime()
                    ) / 1000
                )
            );


        return {

            lives,

            nextLifeAt,

            secondsUntilNextLife

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

    if (
        newLives >= MAX_LIVES
    ) {

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

            lives:
                MAX_LIVES,

            nextLifeAt:
                null,

            secondsUntilNextLife:
                0

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
        calculateNextLifeAt(
            newLostAt
        );


    const secondsUntilNextLife =
        Math.max(
            0,
            Math.ceil(
                (
                    nextLifeAt.getTime() -
                    now.getTime()
                ) / 1000
            )
        );


    return {

        lives:
            newLives,

        nextLifeAt,

        secondsUntilNextLife

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

        throw new Error(
            "Invalid difficulty"
        );

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
        Recover lives before starting.
        ----------------------------------------------------
        */

        const lifeState =
            await recoverLives(
                client,
                userId
            );


        /*
        ----------------------------------------------------
        No lives.
        ----------------------------------------------------
        */

        if (
            lifeState.lives <= 0
        ) {

            await client.query(
                "ROLLBACK"
            );


            return {

                success: false,

                error:
                    "NO_LIVES",

                message:
                    "No lives available.",

                lives:
                    0,

                nextLifeAt:
                    lifeState.nextLifeAt,

                secondsUntilNextLife:
                    lifeState.secondsUntilNextLife

            };

        }


        /*
        ----------------------------------------------------
        Consume one life.
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
        Generate completion token.
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
                    ? calculateNextLifeAt(
                        user.last_life_at
                    )
                    : null,

            secondsUntilNextLife:
                user.last_life_at
                    ? Math.max(
                        0,
                        Math.ceil(
                            (
                                calculateNextLifeAt(
                                    user.last_life_at
                                ).getTime() -
                                Date.now()
                            ) / 1000
                        )
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

IMPORTANT SECURITY RULE:

doubleRewardVerified MUST NOT simply come from:

{
    doubleRewardVerified: true
}

sent by the browser.

It should be set only after the server verifies
the ad reward.

For now the function supports the verified flag
so we can connect AdsGram in the next step.
============================================================
*/

export async function completeGame({

    userId,

    gameId,

    completionToken,

    moves,

    durationSeconds,

    doubleRewardVerified = false

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

            throw new Error(
                "Game session not found"
            );

        }


        const session =
            sessionResult.rows[0];


        /*
        ----------------------------------------------------
        Prevent duplicate completion.
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
            Number(
                moves
            );


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
        NORMAL REWARD
        ----------------------------------------------------
        */

        const baseReward =
            Number(
                session.reward_coins
            );


        /*
        ----------------------------------------------------
        DOUBLE REWARD
        ----------------------------------------------------

        Only use this after a verified advertisement.

        Example:

        Easy
        10 → 20

        Medium
        12 → 24

        Hard
        15 → 30
        ----------------------------------------------------
        */

        const rewardMultiplier =
            doubleRewardVerified
                ? 2
                : 1;


        const reward =
            baseReward *
            rewardMultiplier;


        /*
        ----------------------------------------------------
        Get current balance.
        ----------------------------------------------------
        */

        const balanceResult =
            await client.query(
                `
                SELECT

                    coins,
                    today_coins

                FROM users

                WHERE id = $1

                FOR UPDATE
                `,
                [
                    userId
                ]
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
        RECORD GAME RESULT
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
        RECORD COIN TRANSACTION
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

                doubleRewardVerified
                    ? "game_reward_2x"
                    : "game_reward",

                reward,

                balanceBefore,

                balanceAfter,

                gameId,

                doubleRewardVerified

                    ? `Completed ${session.difficulty} memory game with verified ad 2x reward`

                    : `Completed ${session.difficulty} memory game`
            ]
        );


        /*
        ----------------------------------------------------
        COMMIT
        ----------------------------------------------------
        */

        await client.query(
            "COMMIT"
        );


        /*
        ----------------------------------------------------
        RETURN UPDATED BALANCE
        ----------------------------------------------------
        */

        return {

            success: true,

            reward,

            baseReward,

            multiplier:
                rewardMultiplier,

            doubleReward:
                doubleRewardVerified,

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
        Recover lives.
        ----------------------------------------------------
        */

        const lifeState =
            await recoverLives(
                client,
                userId
            );


        /*
        ----------------------------------------------------
        Get user data.
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
                [
                    userId
                ]
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

            lives:
                Number(
                    lifeState.lives
                ),

            nextLifeAt:
                lifeState.nextLifeAt,

            secondsUntilNextLife:
                lifeState.secondsUntilNextLife,

            lifeCooldownMinutes:
                LIFE_COOLDOWN_MINUTES,

            maxLives:
                MAX_LIVES

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

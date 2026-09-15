import express from "express";

import {
    startGame,
    completeGame,
    getGameStatus
} from "../services/game.js";

const router = express.Router();


/*
============================================================
HELPERS
============================================================
*/

function getUserId(req) {

    return req.user?.user_id || null;

}


/*
============================================================
ERROR RESPONSE HELPER
============================================================
*/

function sendGameError(
    res,
    error
) {

    const code =
        error?.code ||
        "";


    /*
    --------------------------------------------------------
    USER
    --------------------------------------------------------
    */

    if (
        code ===
        "USER_NOT_FOUND"
    ) {

        return res.status(404).json({
            success: false,
            error:
                "User not found."
        });

    }


    if (
        code ===
        "USER_BLOCKED"
    ) {

        return res.status(403).json({
            success: false,
            error:
                "User account is blocked."
        });

    }


    /*
    --------------------------------------------------------
    GAME
    --------------------------------------------------------
    */

    if (
        code ===
        "GAME_SESSION_NOT_FOUND"
    ) {

        return res.status(404).json({
            success: false,
            error:
                "Game session not found."
        });

    }


    if (
        code ===
        "GAME_NOT_ACTIVE"
    ) {

        return res.status(409).json({
            success: false,
            error:
                "This game is no longer active."
        });

    }


    if (
        code ===
        "ALREADY_COMPLETED"
    ) {

        return res.status(409).json({
            success: false,
            error:
                "This game has already been completed."
        });

    }


    /*
    --------------------------------------------------------
    AUTH / TOKEN
    --------------------------------------------------------
    */

    if (
        code ===
        "INVALID_COMPLETION_TOKEN"
    ) {

        return res.status(403).json({
            success: false,
            error:
                "Invalid completion token."
        });

    }


    /*
    --------------------------------------------------------
    INPUT VALIDATION
    --------------------------------------------------------
    */

    if (
        code ===
        "INVALID_GAME_ID"
    ) {

        return res.status(400).json({
            success: false,
            error:
                "Invalid game ID."
        });

    }


    if (
        code ===
        "INVALID_DIFFICULTY"
    ) {

        return res.status(400).json({
            success: false,
            error:
                "Invalid difficulty. Use easy, medium, or hard."
        });

    }


    if (
        code ===
        "INVALID_MOVES"
    ) {

        return res.status(400).json({
            success: false,
            error:
                "Invalid moves."
        });

    }


    if (
        code ===
        "INVALID_DURATION"
    ) {

        return res.status(400).json({
            success: false,
            error:
                "Invalid duration."
        });

    }


    if (
        code ===
        "INVALID_GAME_TIME" ||
        code ===
        "INVALID_GAME_DURATION"
    ) {

        return res.status(400).json({
            success: false,
            error:
                "Invalid game duration."
        });

    }


    /*
    --------------------------------------------------------
    LIVES
    --------------------------------------------------------
    */

    if (
        code ===
        "NO_LIVES"
    ) {

        return res.status(409).json({
            success: false,
            error:
                "NO_LIVES",
            message:
                "No lives available. Please wait for the next life."
        });

    }


    if (
        code ===
        "UNABLE_TO_CONSUME_LIFE"
    ) {

        return res.status(409).json({
            success: false,
            error:
                "Unable to consume a life. Please try again."
        });

    }


    /*
    --------------------------------------------------------
    GAME PROGRESS
    --------------------------------------------------------
    */

    if (
        code ===
        "LEVELS_COMPLETED"
    ) {

        return res.status(409).json({
            success: false,
            error:
                "LEVELS_COMPLETED",
            message:
                error.message ||
                "This difficulty is already completed."
        });

    }


    if (
        code ===
        "DIFFICULTY_ALREADY_COMPLETED"
    ) {

        return res.status(409).json({
            success: false,
            error:
                "DIFFICULTY_ALREADY_COMPLETED",
            message:
                "This difficulty is already completed."
        });

    }


    if (
        code ===
        "INVALID_GAME_PROGRESS"
    ) {

        return res.status(409).json({
            success: false,
            error:
                "Invalid game progress."
        });

    }


    /*
    --------------------------------------------------------
    SERVER CONFIGURATION
    --------------------------------------------------------
    */

    if (
        code ===
        "INVALID_GAME_REWARD" ||
        code ===
        "INVALID_GAME_PAIRS" ||
        code ===
        "INVALID_GAME_LEVEL"
    ) {

        return res.status(500).json({
            success: false,
            error:
                "Game configuration error."
        });

    }


    /*
    --------------------------------------------------------
    USER BALANCE / DATABASE
    --------------------------------------------------------
    */

    if (
        code ===
        "INVALID_USER_BALANCE"
    ) {

        return res.status(500).json({
            success: false,
            error:
                "User balance configuration error."
        });

    }


    if (
        code ===
        "USER_UPDATE_FAILED" ||
        code ===
        "GAME_COMPLETION_FAILED" ||
        code ===
        "GAME_SESSION_CREATE_FAILED"
    ) {

        return res.status(500).json({
            success: false,
            error:
                "Unable to process game."
        });

    }


    /*
    --------------------------------------------------------
    FALLBACK
    --------------------------------------------------------
    */

    return res.status(500).json({
        success: false,
        error:
            "Unable to process game."
    });

}


/*
============================================================
GET GAME STATUS
============================================================

GET /api/game/status

Returns:

- coins
- today's coins
- games played
- difficulty progress
- levels
- lives
- next life recovery time
============================================================
*/

router.get(
    "/status",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);


            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error:
                        "Authentication required."
                });

            }


            const result =
                await getGameStatus(
                    userId
                );


            return res.status(200).json(
                result
            );

        }

        catch (error) {

            console.error(
                "Game status error:",
                error
            );


            return sendGameError(
                res,
                error
            );

        }

    }
);


/*
============================================================
START GAME
============================================================

POST /api/game/start

Body:

{
    "difficulty": "easy"
}

Allowed:

easy
medium
hard

Starting a game consumes ONE life.

The client cannot choose:

- reward
- pairs
- level
- lives
============================================================
*/

router.post(
    "/start",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);


            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error:
                        "Authentication required."
                });

            }


            const difficulty =
                typeof req.body?.difficulty ===
                "string"

                    ? req.body.difficulty
                        .trim()
                        .toLowerCase()

                    : "";


            /*
            ------------------------------------------------
            VALIDATE DIFFICULTY
            ------------------------------------------------
            */

            const allowedDifficulties = [
                "easy",
                "medium",
                "hard"
            ];


            if (
                !allowedDifficulties.includes(
                    difficulty
                )
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Invalid difficulty. Use easy, medium, or hard."
                });

            }


            /*
            ------------------------------------------------
            START GAME
            ------------------------------------------------
            */

            const result =
                await startGame(
                    userId,
                    difficulty
                );


            /*
            ------------------------------------------------
            NO LIVES
            ------------------------------------------------
            */

            if (
                result.success === false &&
                result.error ===
                    "NO_LIVES"
            ) {

                return res.status(409).json(
                    result
                );

            }


            /*
            ------------------------------------------------
            DIFFICULTY COMPLETED
            ------------------------------------------------
            */

            if (
                result.success === false &&
                result.error ===
                    "LEVELS_COMPLETED"
            ) {

                return res.status(409).json(
                    result
                );

            }


            return res.status(200).json(
                result
            );

        }

        catch (error) {

            console.error(
                "Start game error:",
                error
            );


            return sendGameError(
                res,
                error
            );

        }

    }
);


/*
============================================================
COMPLETE GAME
============================================================

POST /api/game/complete

Expected body:

{
    "gameId": "...",
    "completionToken": "...",
    "moves": 20,
    "durationSeconds": 25
}

IMPORTANT
------------------------------------------------------------

The client MUST NOT control:

- reward
- coins
- balance
- multiplier
- double reward
- extra reward

The server determines the normal reward from the
game session.

Normal rewards:

Easy   = 10
Medium = 12
Hard   = 15

Double Reward is handled separately through:

POST /api/rewards/double-game-reward
============================================================
*/

router.post(
    "/complete",
    async (req, res) => {

        try {

            const userId =
                getUserId(req);


            if (!userId) {

                return res.status(401).json({
                    success: false,
                    error:
                        "Authentication required."
                });

            }


            const body =
                req.body || {};


            /*
            ------------------------------------------------
            REJECT CLIENT-SIDE REWARD MANIPULATION
            ------------------------------------------------

            These fields should NEVER be accepted by the
            normal completion endpoint.

            We reject them instead of silently ignoring them.

            This makes accidental frontend bugs easier to
            detect and prevents the API contract from becoming
            ambiguous.
            ------------------------------------------------
            */

            const forbiddenFields = [

                "reward",

                "coins",

                "balance",

                "extraCoins",

                "rewardCoins",

                "multiplier",

                "rewardMultiplier",

                "doubleReward",

                "doubleRewardVerified",

                "double_reward",

                "adCompleted",

                "ad_completed"

            ];


            const suppliedForbiddenField =
                forbiddenFields.find(
                    field =>
                        Object.prototype
                            .hasOwnProperty.call(
                                body,
                                field
                            )
                );


            if (
                suppliedForbiddenField
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "CLIENT_REWARD_FIELD_NOT_ALLOWED",
                    message:
                        `${suppliedForbiddenField} cannot be sent to the game completion endpoint.`
                });

            }


            /*
            ------------------------------------------------
            READ ALLOWED FIELDS ONLY
            ------------------------------------------------
            */

            const {
                gameId,
                completionToken,
                moves,
                durationSeconds
            } = body;


            /*
            ------------------------------------------------
            GAME ID
            ------------------------------------------------
            */

            if (
                gameId === undefined ||
                gameId === null ||
                String(gameId).trim() === ""
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "gameId is required."
                });

            }


            /*
            ------------------------------------------------
            COMPLETION TOKEN
            ------------------------------------------------
            */

            if (
                typeof completionToken !==
                "string" ||
                completionToken.trim() === ""
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "completionToken is required."
                });

            }


            /*
            ------------------------------------------------
            MOVES
            ------------------------------------------------
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

                return res.status(400).json({
                    success: false,
                    error:
                        "Invalid moves."
                });

            }


            /*
            ------------------------------------------------
            DURATION
            ------------------------------------------------
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

                return res.status(400).json({
                    success: false,
                    error:
                        "Invalid duration."
                });

            }


            /*
            ------------------------------------------------
            COMPLETE GAME
            ------------------------------------------------
            */

            const result =
                await completeGame({

                    userId,

                    gameId:
                        String(
                            gameId
                        ).trim(),

                    completionToken:
                        completionToken.trim(),

                    moves:
                        parsedMoves,

                    durationSeconds:
                        Math.floor(
                            parsedDuration
                        )

                });


            /*
            ------------------------------------------------
            DUPLICATE COMPLETION
            ------------------------------------------------
            */

            if (
                result.success === false &&
                result.error ===
                    "ALREADY_COMPLETED"
            ) {

                return res.status(409).json(
                    result
                );

            }


            return res.status(200).json(
                result
            );

        }

        catch (error) {

            console.error(
                "Complete game error:",
                error
            );


            return sendGameError(
                res,
                error
            );

        }

    }
);


/*
============================================================
EXPORT
============================================================
*/

export default router;

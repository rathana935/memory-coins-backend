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
    return req.user?.user_id || req.user?.id || null;
}


function isUUID(value) {

    if (typeof value !== "string") {
        return false;
    }

    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value.trim());
}


function sendError(res, status, error, message) {

    return res.status(status).json({
        success: false,
        error,
        message
    });

}


/*
============================================================
GET GAME STATUS
============================================================

GET /api/game/status
============================================================
*/

router.get("/status", async (req, res) => {

    try {

        const userId = getUserId(req);

        if (!userId) {

            return sendError(
                res,
                401,
                "AUTHENTICATION_REQUIRED",
                "Authentication required."
            );
        }

        const result =
            await getGameStatus(userId);

        return res.status(200).json(result);

    } catch (error) {

        console.error(
            "Game status error:",
            error
        );

        if (
            error.code ===
            "USER_NOT_FOUND"
        ) {

            return sendError(
                res,
                404,
                "USER_NOT_FOUND",
                "User not found."
            );
        }

        if (
            error.code ===
            "USER_BLOCKED"
        ) {

            return sendError(
                res,
                403,
                "USER_BLOCKED",
                "User account is blocked."
            );
        }

        return sendError(
            res,
            500,
            "GAME_STATUS_FAILED",
            "Unable to load game status."
        );
    }

});


/*
============================================================
START GAME
============================================================

POST /api/game/start

Body:

{
    "difficulty": "easy"
}

Server determines:

- level
- reward
- puzzle
- pairs
- life consumption
- game session
============================================================
*/

router.post("/start", async (req, res) => {

    try {

        const userId = getUserId(req);

        if (!userId) {

            return sendError(
                res,
                401,
                "AUTHENTICATION_REQUIRED",
                "Authentication required."
            );
        }

        const difficulty =
            typeof req.body?.difficulty === "string"
                ? req.body.difficulty
                    .trim()
                    .toLowerCase()
                : "";

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

            return sendError(
                res,
                400,
                "INVALID_DIFFICULTY",
                "Invalid difficulty. Use easy, medium, or hard."
            );
        }

        const result =
            await startGame(
                userId,
                difficulty
            );

        /*
        ----------------------------------------------------
        NO LIVES
        ----------------------------------------------------
        */

        if (
            result?.success === false &&
            result?.error === "NO_LIVES"
        ) {

            return res
                .status(409)
                .json(result);
        }


        /*
        ----------------------------------------------------
        LEVELS COMPLETED
        ----------------------------------------------------
        */

        if (
            result?.success === false &&
            result?.error ===
                "LEVELS_COMPLETED"
        ) {

            return res
                .status(409)
                .json(result);
        }


        return res
            .status(200)
            .json(result);

    } catch (error) {

        console.error(
            "Start game error:",
            error
        );

        if (
            error.code ===
            "USER_NOT_FOUND"
        ) {

            return sendError(
                res,
                404,
                "USER_NOT_FOUND",
                "User not found."
            );
        }

        if (
            error.code ===
            "INVALID_DIFFICULTY"
        ) {

            return sendError(
                res,
                400,
                "INVALID_DIFFICULTY",
                "Invalid difficulty."
            );
        }

        if (
            error.code ===
            "USER_BLOCKED"
        ) {

            return sendError(
                res,
                403,
                "USER_BLOCKED",
                "User account is blocked."
            );
        }

        return sendError(
            res,
            500,
            "GAME_START_FAILED",
            "Unable to start game."
        );
    }

});


/*
============================================================
COMPLETE GAME
============================================================

POST /api/game/complete

Body:

{
    "gameId": "...",
    "completionToken": "...",
    "moves": 20,
    "durationSeconds": 25,
    "matchedPairs": [
        [0, 5],
        [1, 7],
        [2, 4],
        [3, 6]
    ]
}

IMPORTANT:

The client MUST NOT send:

- reward
- coins
- balance
- multiplier
- doubleReward
- adCompleted
- payout

The server determines the reward.
============================================================
*/

router.post("/complete", async (req, res) => {

    try {

        const userId = getUserId(req);

        if (!userId) {

            return sendError(
                res,
                401,
                "AUTHENTICATION_REQUIRED",
                "Authentication required."
            );
        }


        const body =
            req.body || {};


        /*
        ----------------------------------------------------
        SECURITY CHECK
        ----------------------------------------------------
        */

        const forbiddenFields = [

            "reward",
            "coins",
            "balance",

            "multiplier",
            "rewardMultiplier",

            "doubleReward",
            "doubleRewardVerified",

            "adCompleted",
            "adVerified",

            "payout"

        ];


        for (
            const field of forbiddenFields
        ) {

            if (
                Object.prototype.hasOwnProperty.call(
                    body,
                    field
                )
            ) {

                return sendError(
                    res,
                    400,
                    "FIELD_NOT_ALLOWED",
                    `Field "${field}" is not allowed.`
                );
            }
        }


        /*
        ----------------------------------------------------
        READ ONLY ALLOWED FIELDS
        ----------------------------------------------------
        */

        const {
            gameId,
            completionToken,
            moves,
            durationSeconds,
            matchedPairs
        } = body;


        /*
        ====================================================
        GAME ID
        ====================================================
        */

        if (
            typeof gameId !== "string" ||
            gameId.trim() === ""
        ) {

            return sendError(
                res,
                400,
                "INVALID_GAME_ID",
                "gameId is required."
            );
        }


        const normalizedGameId =
            gameId.trim();


        if (
            !isUUID(
                normalizedGameId
            )
        ) {

            return sendError(
                res,
                400,
                "INVALID_GAME_ID",
                "Invalid gameId."
            );
        }


        /*
        ====================================================
        COMPLETION TOKEN
        ====================================================
        */

        if (
            typeof completionToken !==
            "string"
        ) {

            return sendError(
                res,
                400,
                "INVALID_COMPLETION_TOKEN",
                "completionToken is required."
            );
        }


        const normalizedToken =
            completionToken.trim();


        if (
            normalizedToken.length < 20 ||
            normalizedToken.length > 200
        ) {

            return sendError(
                res,
                400,
                "INVALID_COMPLETION_TOKEN",
                "Invalid completionToken."
            );
        }


        /*
        ====================================================
        MOVES
        ====================================================
        */

        const parsedMoves =
            Number(moves);


        if (
            !Number.isInteger(
                parsedMoves
            ) ||
            parsedMoves < 1 ||
            parsedMoves > 10000
        ) {

            return sendError(
                res,
                400,
                "INVALID_MOVES",
                "Invalid moves."
            );
        }


        /*
        ====================================================
        DURATION
        ====================================================
        */

        const parsedDuration =
            Number(durationSeconds);


        if (
            !Number.isFinite(
                parsedDuration
            ) ||
            parsedDuration < 1 ||
            parsedDuration > 86400
        ) {

            return sendError(
                res,
                400,
                "INVALID_DURATION",
                "Invalid duration."
            );
        }


        /*
        ====================================================
        PUZZLE PROOF
        ====================================================

        matchedPairs MUST be an array.

        Example:

        [
            [0, 5],
            [1, 7],
            [2, 4],
            [3, 6]
        ]

        The service will verify:

        - correct number of pairs
        - valid indexes
        - no duplicate indexes
        - two different indexes
        - both cards have same server pairId
        - every card was matched
        ====================================================
        */

        if (
            !Array.isArray(
                matchedPairs
            )
        ) {

            return sendError(
                res,
                400,
                "INVALID_PUZZLE_PROOF",
                "matchedPairs must be an array."
            );
        }


        /*
        ----------------------------------------------------
        LIMIT REQUEST SIZE
        ----------------------------------------------------
        */

        if (
            matchedPairs.length > 16
        ) {

            return sendError(
                res,
                400,
                "INVALID_PUZZLE_PROOF",
                "Too many matched pairs."
            );
        }


        /*
        ----------------------------------------------------
        VALIDATE PAIR SHAPE
        ----------------------------------------------------
        */

        for (
            const pair of matchedPairs
        ) {

            if (
                !Array.isArray(pair) ||
                pair.length !== 2
            ) {

                return sendError(
                    res,
                    400,
                    "INVALID_PUZZLE_PROOF",
                    "Each matched pair must contain exactly two indexes."
                );
            }


            for (
                const index of pair
            ) {

                if (
                    !Number.isInteger(
                        index
                    ) ||
                    index < 0 ||
                    index > 15
                ) {

                    return sendError(
                        res,
                        400,
                        "INVALID_PUZZLE_PROOF",
                        "Invalid card index."
                    );
                }
            }
        }


        /*
        ====================================================
        COMPLETE GAME
        ====================================================

        IMPORTANT:

        We do NOT send:

        reward
        coins
        multiplier
        doubleReward

        The service gets the reward from the
        server-created game session.
        ====================================================
        */

        const result =
            await completeGame({

                userId,

                gameId:
                    normalizedGameId,

                completionToken:
                    normalizedToken,

                moves:
                    parsedMoves,

                durationSeconds:
                    Math.floor(
                        parsedDuration
                    ),

                matchedPairs

            });


        /*
        ====================================================
        KNOWN RESULT
        ====================================================
        */

        if (
            result?.success === false &&
            result?.error ===
                "ALREADY_COMPLETED"
        ) {

            return res
                .status(409)
                .json(result);
        }


        return res
            .status(200)
            .json(result);

    } catch (error) {

        console.error(
            "Complete game error:",
            error
        );


        /*
        ====================================================
        ERROR CODES FROM game.js
        ====================================================
        */

        switch (error.code) {


            case "GAME_SESSION_NOT_FOUND":

                return sendError(
                    res,
                    404,
                    error.code,
                    "Game session not found."
                );


            case "INVALID_COMPLETION_TOKEN":

                return sendError(
                    res,
                    403,
                    error.code,
                    "Invalid completion token."
                );


            case "INVALID_MOVES":

                return sendError(
                    res,
                    400,
                    error.code,
                    "Invalid moves."
                );


            case "INVALID_DURATION":

                return sendError(
                    res,
                    400,
                    error.code,
                    "Invalid duration."
                );


            case "INVALID_PUZZLE_PROOF":

                return sendError(
                    res,
                    403,
                    error.code,
                    "Invalid puzzle proof."
                );


            case "PUZZLE_NOT_FOUND":

                return sendError(
                    res,
                    500,
                    error.code,
                    "Game puzzle is unavailable."
                );


            case "INVALID_GAME_DURATION":

                return sendError(
                    res,
                    400,
                    error.code,
                    "Game duration is invalid."
                );


            case "INVALID_GAME_TIME":

                return sendError(
                    res,
                    400,
                    error.code,
                    "Game time is invalid."
                );


            case "GAME_NOT_ACTIVE":

                return sendError(
                    res,
                    409,
                    error.code,
                    "This game is no longer active."
                );


            case "INVALID_GAME_REWARD":

                return sendError(
                    res,
                    500,
                    error.code,
                    "Game reward configuration error."
                );


            case "INVALID_GAME_PAIRS":

                return sendError(
                    res,
                    500,
                    error.code,
                    "Game puzzle configuration error."
                );


            case "INVALID_GAME_LEVEL":

                return sendError(
                    res,
                    500,
                    error.code,
                    "Game level configuration error."
                );


            case "INVALID_GAME_PROGRESS":

                return sendError(
                    res,
                    409,
                    error.code,
                    "Invalid game progress."
                );


            case "DIFFICULTY_ALREADY_COMPLETED":

                return sendError(
                    res,
                    409,
                    error.code,
                    "This difficulty has already been completed."
                );


            case "USER_NOT_FOUND":

                return sendError(
                    res,
                    404,
                    error.code,
                    "User not found."
                );


            case "USER_BLOCKED":

                return sendError(
                    res,
                    403,
                    error.code,
                    "User account is blocked."
                );


            case "GAME_COMPLETION_FAILED":

                return sendError(
                    res,
                    409,
                    error.code,
                    "Game completion failed."
                );


            case "USER_UPDATE_FAILED":

                return sendError(
                    res,
                    500,
                    error.code,
                    "Unable to update user balance."
                );


            default:

                return sendError(
                    res,
                    500,
                    "GAME_COMPLETION_FAILED",
                    "Unable to complete game."
                );
        }

    }

});


export default router;

// routes/game.js

import express from "express";

import {
    startGame,
    completeGame,
    getGameStatus,
} from "../services/game.js";

const router = express.Router();

/* =========================================================
   CONSTANTS
========================================================= */

const VALID_DIFFICULTIES = [
    "easy",
    "hard",
    "difficult",
];

const MAX_MOVES = 1000;

const MAX_DURATION_SECONDS =
    60 * 60;

const MAX_MATCHED_PAIRS = 18;

const MAX_MATCHED_INDEXES = 36;

/* =========================================================
   HELPERS
========================================================= */

function getUserId(req) {
    return (
        req.user?.id ||
        req.user?.user_id ||
        req.user?.userId ||
        req.user?.telegram_id ||
        req.user?.telegramId ||
        null
    );
}

function isValidUUID(value) {
    return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            value
        )
    );
}

function sendError(
    res,
    status,
    code,
    message
) {
    return res.status(status).json({
        success: false,
        error: code,
        message,
    });
}

/* =========================================================
   GET GAME STATUS
========================================================= */

router.get(
    "/status",
    async (req, res) => {
        try {
            const userId =
                getUserId(req);

            if (!userId) {
                return sendError(
                    res,
                    401,
                    "UNAUTHORIZED",
                    "Authentication required."
                );
            }

            const result =
                await getGameStatus(
                    userId
                );

            return res.json({
                success: true,
                ...result,
            });
        } catch (error) {
            console.error(
                "GET /api/game/status error:",
                error
            );

            switch (error?.code) {
                case "USER_NOT_FOUND":
                    return sendError(
                        res,
                        404,
                        error.code,
                        "User not found."
                    );

                default:
                    return sendError(
                        res,
                        500,
                        "GAME_STATUS_FAILED",
                        "Unable to get game status."
                    );
            }
        }
    }
);

/* =========================================================
   START GAME
========================================================= */

router.post(
    "/start",
    async (req, res) => {
        try {
            const userId =
                getUserId(req);

            if (!userId) {
                return sendError(
                    res,
                    401,
                    "UNAUTHORIZED",
                    "Authentication required."
                );
            }

            const {
                difficulty,
            } = req.body || {};

            /* -------------------------------------------------
               VALIDATE DIFFICULTY
            ------------------------------------------------- */

            if (
                !VALID_DIFFICULTIES.includes(
                    difficulty
                )
            ) {
                return sendError(
                    res,
                    400,
                    "INVALID_GAME_DIFFICULTY",
                    "Invalid difficulty. Use easy, hard, or difficult."
                );
            }

            /* -------------------------------------------------
               START GAME
            ------------------------------------------------- */

            const result =
                await startGame(
                    userId,
                    difficulty
                );

            return res.json({
                success: true,
                ...result,
            });
        } catch (error) {
            console.error(
                "POST /api/game/start error:",
                error
            );

            const code =
                error?.code;

            switch (code) {
                case "USER_NOT_FOUND":
                    return sendError(
                        res,
                        404,
                        code,
                        "User not found."
                    );

                case "INVALID_GAME_DIFFICULTY":
                    return sendError(
                        res,
                        400,
                        code,
                        "Invalid difficulty. Use easy, hard, or difficult."
                    );

                case "NO_LIVES":
                    return sendError(
                        res,
                        400,
                        code,
                        "You do not have any lives remaining."
                    );

                case "GAME_ALREADY_ACTIVE":
                    return sendError(
                        res,
                        409,
                        code,
                        "You already have an active game."
                    );

                case "MAX_LEVEL_REACHED":
                    return sendError(
                        res,
                        400,
                        code,
                        "You have completed all 100 levels."
                    );

                case "INVALID_CURRENT_LEVEL":
                    return sendError(
                        res,
                        400,
                        code,
                        "Invalid current level."
                    );

                case "INVALID_PAIR_COUNT":
                    return sendError(
                        res,
                        500,
                        code,
                        "Unable to create puzzle."
                    );

                default:
                    return sendError(
                        res,
                        500,
                        "GAME_START_FAILED",
                        "Unable to start game."
                    );
            }
        }
    }
);

/* =========================================================
   COMPLETE GAME
========================================================= */

router.post(
    "/complete",
    async (req, res) => {
        try {
            const userId =
                getUserId(req);

            if (!userId) {
                return sendError(
                    res,
                    401,
                    "UNAUTHORIZED",
                    "Authentication required."
                );
            }

            const {
                gameId,
                completionToken,
                difficulty,
                moves,
                duration,
                durationSeconds,
                matchedPairs,
                matchedIndexes,
            } = req.body || {};

            /* -------------------------------------------------
               GAME ID
            ------------------------------------------------- */

            if (
                !isValidUUID(
                    gameId
                )
            ) {
                return sendError(
                    res,
                    400,
                    "INVALID_GAME_ID",
                    "Invalid game ID."
                );
            }

            /* -------------------------------------------------
               COMPLETION TOKEN
            ------------------------------------------------- */

            if (
                typeof completionToken !==
                    "string" ||
                completionToken.length <
                    10 ||
                completionToken.length >
                    500
            ) {
                return sendError(
                    res,
                    400,
                    "INVALID_COMPLETION_TOKEN",
                    "Invalid completion token."
                );
            }

            /* -------------------------------------------------
               DIFFICULTY
            ------------------------------------------------- */

            if (
                !VALID_DIFFICULTIES.includes(
                    difficulty
                )
            ) {
                return sendError(
                    res,
                    400,
                    "INVALID_GAME_DIFFICULTY",
                    "Invalid difficulty. Use easy, hard, or difficult."
                );
            }

            /* -------------------------------------------------
               MOVES
            ------------------------------------------------- */

            if (
                !Number.isInteger(
                    moves
                ) ||
                moves < 1 ||
                moves >
                    MAX_MOVES
            ) {
                return sendError(
                    res,
                    400,
                    "INVALID_MOVES",
                    "Invalid moves value."
                );
            }

            /* -------------------------------------------------
               DURATION
               
               Support:
                 duration
                 durationSeconds
            ------------------------------------------------- */

            const finalDuration =
                Number.isInteger(
                    duration
                )
                    ? duration
                    : durationSeconds;

            if (
                !Number.isInteger(
                    finalDuration
                ) ||
                finalDuration < 1 ||
                finalDuration >
                    MAX_DURATION_SECONDS
            ) {
                return sendError(
                    res,
                    400,
                    "INVALID_GAME_DURATION",
                    "Invalid game duration."
                );
            }

            /* -------------------------------------------------
               MATCHED PAIRS
            ------------------------------------------------- */

            if (
                !Number.isInteger(
                    matchedPairs
                ) ||
                matchedPairs < 0 ||
                matchedPairs >
                    MAX_MATCHED_PAIRS
            ) {
                return sendError(
                    res,
                    400,
                    "INVALID_MATCHED_PAIRS",
                    "Invalid matched pairs value."
                );
            }

            /* -------------------------------------------------
               MATCHED INDEXES
            ------------------------------------------------- */

            if (
                !Array.isArray(
                    matchedIndexes
                ) ||
                matchedIndexes.length >
                    MAX_MATCHED_INDEXES
            ) {
                return sendError(
                    res,
                    400,
                    "INVALID_MATCHED_INDEXES",
                    "Invalid matched indexes."
                );
            }

            for (
                const index of
                    matchedIndexes
            ) {
                if (
                    !Number.isInteger(
                        index
                    ) ||
                    index < 0 ||
                    index >=
                        MAX_MATCHED_INDEXES
                ) {
                    return sendError(
                        res,
                        400,
                        "INVALID_MATCHED_INDEX",
                        "Invalid card index."
                    );
                }
            }

            /* -------------------------------------------------
               SECURITY
               
               Never accept these from
               the frontend:

                 reward
                 coins
                 multiplier
                 doubleReward
                 adReward
                 bonus
            ------------------------------------------------- */

            const result =
                await completeGame(
                    userId,
                    {
                        gameId,
                        completionToken,
                        difficulty,
                        moves,
                        duration:
                            finalDuration,
                        matchedPairs,
                        matchedIndexes,
                    }
                );

            return res.json({
                success: true,
                ...result,
            });
        } catch (error) {
            console.error(
                "POST /api/game/complete error:",
                error
            );

            const code =
                error?.code;

            switch (code) {
                case "USER_NOT_FOUND":
                    return sendError(
                        res,
                        404,
                        code,
                        "User not found."
                    );

                case "GAME_NOT_FOUND":
                    return sendError(
                        res,
                        404,
                        code,
                        "Game not found."
                    );

                case "INVALID_GAME_SESSION":
                    return sendError(
                        res,
                        403,
                        code,
                        "Invalid game session."
                    );

                case "INVALID_GAME_DIFFICULTY":
                    return sendError(
                        res,
                        400,
                        code,
                        "Invalid difficulty. Use easy, hard, or difficult."
                    );

                case "INVALID_COMPLETION_TOKEN":
                    return sendError(
                        res,
                        403,
                        code,
                        "Invalid completion token."
                    );

                case "GAME_ALREADY_COMPLETED":
                    return sendError(
                        res,
                        409,
                        code,
                        "This game has already been completed."
                    );

                case "GAME_EXPIRED":
                    return sendError(
                        res,
                        400,
                        code,
                        "This game has expired."
                    );

                case "INVALID_MOVES":
                    return sendError(
                        res,
                        400,
                        code,
                        "Invalid moves value."
                    );

                case "INVALID_GAME_DURATION":
                    return sendError(
                        res,
                        400,
                        code,
                        "Invalid game duration."
                    );

                case "INVALID_PUZZLE":
                    return sendError(
                        res,
                        400,
                        code,
                        "Invalid puzzle."
                    );

                case "INVALID_MATCHED_PAIRS":
                    return sendError(
                        res,
                        400,
                        code,
                        "Invalid matched pairs."
                    );

                case "INVALID_MATCHED_INDEXES":
                    return sendError(
                        res,
                        400,
                        code,
                        "Invalid matched indexes."
                    );

                case "INVALID_MATCHED_INDEX":
                    return sendError(
                        res,
                        400,
                        code,
                        "Invalid card index."
                    );

                case "PUZZLE_NOT_COMPLETED":
                    return sendError(
                        res,
                        400,
                        code,
                        "The puzzle has not been completed."
                    );

                case "INVALID_GAME_START_TIME":
                    return sendError(
                        res,
                        400,
                        code,
                        "Invalid game start time."
                    );

                case "INVALID_GAME_LEVEL":
                    return sendError(
                        res,
                        400,
                        code,
                        "Invalid game level."
                    );

                case "LEVEL_NOT_UNLOCKED":
                    return sendError(
                        res,
                        409,
                        code,
                        "This level is not currently unlocked."
                    );

                case "INVALID_COIN_BALANCE":
                    return sendError(
                        res,
                        500,
                        code,
                        "Invalid account balance."
                    );

                case "COIN_BALANCE_OVERFLOW":
                    return sendError(
                        res,
                        500,
                        code,
                        "Unable to update coin balance."
                    );

                case "USER_UPDATE_FAILED":
                    return sendError(
                        res,
                        500,
                        code,
                        "Unable to update account."
                    );

                case "INVALID_GAME_CONFIGURATION":
                    return sendError(
                        res,
                        500,
                        code,
                        "Game configuration error."
                    );

                default:
                    return sendError(
                        res,
                        500,
                        "GAME_COMPLETE_FAILED",
                        "Unable to complete game."
                    );
            }
        }
    }
);

/* =========================================================
   EXPORT
========================================================= */

export default router;

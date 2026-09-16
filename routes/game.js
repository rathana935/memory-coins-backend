// routes/game.js

import express from "express";

import {
    startGame,
    completeGame,
    getGameStatus,
} from "../services/game.js";

const router = express.Router();

/* =========================================================
   CONFIG
========================================================= */

const VALID_DIFFICULTIES = [
    "easy",
    "hard",
    "difficult",
];

const MAX_MOVES = 1000;
const MAX_DURATION_SECONDS = 60 * 60;
const MAX_MATCHED_PAIRS = 18;
const MAX_MATCHED_INDEXES = 36;

/* =========================================================
   HELPERS
========================================================= */

function getUserId(req) {
    return (
        req.user?.id ??
        req.user?.user_id ??
        req.user?.userId ??
        req.user?.telegram_id ??
        req.user?.telegramId ??
        req.auth?.id ??
        req.auth?.user_id ??
        req.auth?.userId ??
        req.auth?.telegram_id ??
        req.auth?.telegramId ??
        req.userId ??
        null
    );
}

function normalizeDifficulty(value) {
    if (typeof value !== "string") {
        return "";
    }

    return value.trim().toLowerCase();
}

function getDifficulty(req) {
    const body = req.body || {};

    if (typeof body.difficulty === "string") {
        return body.difficulty;
    }

    if (
        body.game &&
        typeof body.game.difficulty === "string"
    ) {
        return body.game.difficulty;
    }

    return "";
}

function getLevel(req) {
    const body = req.body || {};

    const value =
        body.level ??
        body.gameLevel ??
        body.game?.level;

    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return undefined;
    }

    const level = Number(value);

    if (!Number.isInteger(level)) {
        return undefined;
    }

    return level;
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
            const userId = getUserId(req);

            if (!userId) {
                return sendError(
                    res,
                    401,
                    "UNAUTHORIZED",
                    "Authentication required."
                );
            }

            const result =
                await getGameStatus(userId);

            return res.json({
                success: true,
                ...result,
            });

        } catch (error) {
            console.error(
                "GET /api/game/status error:",
                error
            );

            if (
                error?.code ===
                "USER_NOT_FOUND"
            ) {
                return sendError(
                    res,
                    404,
                    "USER_NOT_FOUND",
                    "User not found."
                );
            }

            return sendError(
                res,
                500,
                "GAME_STATUS_FAILED",
                "Unable to get game status."
            );
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

            const difficulty =
                normalizeDifficulty(
                    getDifficulty(req)
                );

            const requestedLevel =
                getLevel(req);

            console.log(
                "START GAME REQUEST:",
                {
                    userId,
                    difficulty,
                    requestedLevel,
                }
            );

            /* ---------------------------------------------
               AUTH
            --------------------------------------------- */

            if (!userId) {
                return sendError(
                    res,
                    401,
                    "UNAUTHORIZED",
                    "Authentication required."
                );
            }

            /* ---------------------------------------------
               DIFFICULTY
            --------------------------------------------- */

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

            /* ---------------------------------------------
               LEVEL

               If frontend does not provide a level,
               start at level 1.

               The game service still verifies the
               actual unlocked level server-side.
            --------------------------------------------- */

            const level =
                requestedLevel ?? 1;

            if (
                !Number.isInteger(level) ||
                level < 1 ||
                level > 100
            ) {
                return sendError(
                    res,
                    400,
                    "INVALID_GAME_LEVEL",
                    "Level must be between 1 and 100."
                );
            }

            /* ---------------------------------------------
               IMPORTANT

               startGame() expects ONE OBJECT.

               NOT:

               startGame(
                   userId,
                   difficulty,
                   level
               )
            --------------------------------------------- */

            const result =
                await startGame({
                    userId,
                    difficulty,
                    level,
                });

            /* ---------------------------------------------
               RESPONSE

               Keep backend names and also provide
               frontend-friendly aliases.
            --------------------------------------------- */

            return res.json({
                success: true,

                ...result,

                gameSessionId:
                    result.gameSessionId,

                id:
                    result.gameSessionId,

                puzzle:
                    result.puzzle,

                cards:
                    result.puzzle,

                reward:
                    Number(result.reward ?? 0),

                rewardCoins:
                    Number(result.reward ?? 0),
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

                case "INVALID_DIFFICULTY":
                case "INVALID_GAME_DIFFICULTY":

                    return sendError(
                        res,
                        400,
                        "INVALID_GAME_DIFFICULTY",
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
                        "This level is not unlocked yet."
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

            const body =
                req.body || {};

            const {
                gameId,
                gameSessionId,
                completionToken,
                moves,
                duration,
                durationSeconds,
                matchedPairs,
                matchedIndexes,
            } = body;

            /* ---------------------------------------------
               SUPPORT BOTH:

               gameId
               gameSessionId
            --------------------------------------------- */

            const sessionId =
                gameSessionId ??
                gameId;

            /* ---------------------------------------------
               GAME ID
            --------------------------------------------- */

            if (
                !isValidUUID(sessionId)
            ) {
                return sendError(
                    res,
                    400,
                    "INVALID_GAME_ID",
                    "Invalid game ID."
                );
            }

            /* ---------------------------------------------
               COMPLETION TOKEN
            --------------------------------------------- */

            if (
                typeof completionToken !==
                    "string" ||
                completionToken.length < 10 ||
                completionToken.length > 500
            ) {
                return sendError(
                    res,
                    400,
                    "INVALID_COMPLETION_TOKEN",
                    "Invalid completion token."
                );
            }

            /* ---------------------------------------------
               MOVES
            --------------------------------------------- */

            const finalMoves =
                Number(moves);

            if (
                !Number.isInteger(
                    finalMoves
                ) ||
                finalMoves < 1 ||
                finalMoves > MAX_MOVES
            ) {
                return sendError(
                    res,
                    400,
                    "INVALID_MOVES",
                    "Invalid moves value."
                );
            }

            /* ---------------------------------------------
               DURATION

               Accept either:

               durationSeconds
               duration
            --------------------------------------------- */

            const finalDuration =
                Number(
                    durationSeconds ??
                    duration
                );

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

            /* ---------------------------------------------
               MATCHED PAIRS

               Backend expects an INTEGER.

               Example:

               8

               NOT:

               [[0,7],[1,5],...]
            --------------------------------------------- */

            const finalMatchedPairs =
                Number(matchedPairs);

            if (
                !Number.isInteger(
                    finalMatchedPairs
                ) ||
                finalMatchedPairs < 0 ||
                finalMatchedPairs >
                    MAX_MATCHED_PAIRS
            ) {
                return sendError(
                    res,
                    400,
                    "INVALID_MATCHED_PAIRS",
                    "Invalid matched pairs value."
                );
            }

            /* ---------------------------------------------
               MATCHED INDEXES
            --------------------------------------------- */

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
                const index
                of matchedIndexes
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

            /* ---------------------------------------------
               IMPORTANT

               completeGame() expects ONE OBJECT:

               completeGame({
                   userId,
                   gameSessionId,
                   completionToken,
                   moves,
                   durationSeconds,
                   matchedPairs,
                   matchedIndexes
               })
            --------------------------------------------- */

            const result =
                await completeGame({
                    userId,

                    gameSessionId:
                        sessionId,

                    completionToken,

                    moves:
                        finalMoves,

                    durationSeconds:
                        finalDuration,

                    matchedPairs:
                        finalMatchedPairs,

                    matchedIndexes,
                });

            /* ---------------------------------------------
               RESPONSE
            --------------------------------------------- */

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
                        "This level is not unlocked yet."
                    );

                case "INVALID_LEVEL_PROGRESS":

                    return sendError(
                        res,
                        400,
                        code,
                        "Invalid level progress."
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

export default router;

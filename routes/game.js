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

    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
    );
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
            return res.status(401).json({
                success: false,
                error: "Authentication required."
            });
        }

        const result = await getGameStatus(userId);

        return res.status(200).json(result);

    } catch (error) {
        console.error("Game status error:", error);

        if (error.message === "User not found") {
            return res.status(404).json({
                success: false,
                error: "User not found."
            });
        }

        return res.status(500).json({
            success: false,
            error: "Unable to load game status."
        });
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

Allowed:

easy
medium
hard

The server determines:

- level
- reward
- cards
- pairs
- life consumption
- game session
============================================================
*/

router.post("/start", async (req, res) => {
    try {
        const userId = getUserId(req);

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required."
            });
        }

        const difficulty =
            typeof req.body?.difficulty === "string"
                ? req.body.difficulty.trim().toLowerCase()
                : "";

        const allowedDifficulties = [
            "easy",
            "medium",
            "hard"
        ];

        if (!allowedDifficulties.includes(difficulty)) {
            return res.status(400).json({
                success: false,
                error:
                    "Invalid difficulty. Use easy, medium, or hard."
            });
        }

        const result = await startGame(
            userId,
            difficulty
        );

        /*
        ----------------------------------------------------
        No lives
        ----------------------------------------------------
        */

        if (
            result?.success === false &&
            result?.error === "NO_LIVES"
        ) {
            return res.status(409).json(result);
        }

        /*
        ----------------------------------------------------
        Game limit reached
        ----------------------------------------------------
        */

        if (
            result?.success === false &&
            result?.error === "GAME_LIMIT_REACHED"
        ) {
            return res.status(409).json(result);
        }

        return res.status(200).json(result);

    } catch (error) {
        console.error("Start game error:", error);

        if (error.message === "User not found") {
            return res.status(404).json({
                success: false,
                error: "User not found."
            });
        }

        if (error.message === "Invalid difficulty") {
            return res.status(400).json({
                success: false,
                error: "Invalid difficulty."
            });
        }

        if (error.message === "NO_LIVES") {
            return res.status(409).json({
                success: false,
                error: "NO_LIVES"
            });
        }

        return res.status(500).json({
            success: false,
            error: "Unable to start game."
        });
    }
});

/*
============================================================
COMPLETE GAME
============================================================

POST /api/game/complete

Allowed body:

{
    "gameId": "...",
    "completionToken": "...",
    "moves": 20,
    "durationSeconds": 25
}

The client MUST NOT provide:

- reward
- coins
- balance
- multiplier
- doubleReward
- doubleRewardVerified

The server determines the reward.

============================================================
*/

router.post("/complete", async (req, res) => {
    try {
        const userId = getUserId(req);

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required."
            });
        }

        const body = req.body || {};

        /*
        ----------------------------------------------------
        SECURITY CHECK
        ----------------------------------------------------

        These values must NEVER be accepted from the client.

        We explicitly reject them instead of silently ignoring
        them so frontend mistakes are easier to detect.
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

        for (const field of forbiddenFields) {
            if (
                Object.prototype.hasOwnProperty.call(
                    body,
                    field
                )
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        `Field "${field}" is not allowed.`
                });
            }
        }

        /*
        ----------------------------------------------------
        Read allowed fields only
        ----------------------------------------------------
        */

        const {
            gameId,
            completionToken,
            moves,
            durationSeconds,

            /*
            Future server-verifiable puzzle proof.

            The current game service does not require these
            yet, so they remain optional for compatibility.
            */
            matchedPairs,
            moveSequence
        } = body;

        /*
        ----------------------------------------------------
        GAME ID
        ----------------------------------------------------
        */

        if (
            typeof gameId !== "string" ||
            gameId.trim() === ""
        ) {
            return res.status(400).json({
                success: false,
                error: "gameId is required."
            });
        }

        const normalizedGameId = gameId.trim();

        if (!isUUID(normalizedGameId)) {
            return res.status(400).json({
                success: false,
                error: "Invalid gameId."
            });
        }

        /*
        ----------------------------------------------------
        COMPLETION TOKEN
        ----------------------------------------------------
        */

        if (
            typeof completionToken !== "string" ||
            completionToken.trim() === ""
        ) {
            return res.status(400).json({
                success: false,
                error: "completionToken is required."
            });
        }

        const normalizedToken =
            completionToken.trim();

        /*
        ----------------------------------------------------
        TOKEN LENGTH
        ----------------------------------------------------

        Prevent unnecessarily huge request payloads.
        ----------------------------------------------------
        */

        if (
            normalizedToken.length < 16 ||
            normalizedToken.length > 512
        ) {
            return res.status(400).json({
                success: false,
                error: "Invalid completionToken."
            });
        }

        /*
        ----------------------------------------------------
        MOVES
        ----------------------------------------------------
        */

        const parsedMoves = Number(moves);

        if (
            !Number.isInteger(parsedMoves) ||
            parsedMoves < 1 ||
            parsedMoves > 10000
        ) {
            return res.status(400).json({
                success: false,
                error: "Invalid moves."
            });
        }

        /*
        ----------------------------------------------------
        DURATION
        ----------------------------------------------------
        */

        const parsedDuration =
            Number(durationSeconds);

        if (
            !Number.isFinite(parsedDuration) ||
            parsedDuration < 1 ||
            parsedDuration > 86400
        ) {
            return res.status(400).json({
                success: false,
                error: "Invalid duration."
            });
        }

        /*
        ----------------------------------------------------
        OPTIONAL PUZZLE PROOF
        ----------------------------------------------------

        These values are accepted only for the future secure
        puzzle-verification implementation.

        They do NOT currently determine the reward.
        ----------------------------------------------------
        */

        if (
            matchedPairs !== undefined &&
            (
                !Number.isInteger(
                    Number(matchedPairs)
                ) ||
                Number(matchedPairs) < 0 ||
                Number(matchedPairs) > 100
            )
        ) {
            return res.status(400).json({
                success: false,
                error: "Invalid matchedPairs."
            });
        }

        if (
            moveSequence !== undefined &&
            !Array.isArray(moveSequence)
        ) {
            return res.status(400).json({
                success: false,
                error: "Invalid moveSequence."
            });
        }

        /*
        ----------------------------------------------------
        COMPLETE GAME
        ----------------------------------------------------

        IMPORTANT:

        No reward is supplied.

        No coin amount is supplied.

        No multiplier is supplied.

        The service determines the reward from the
        server-created game session.
        ----------------------------------------------------
        */

        const result = await completeGame({
            userId,

            gameId:
                normalizedGameId,

            completionToken:
                normalizedToken,

            moves:
                parsedMoves,

            durationSeconds:
                Math.floor(parsedDuration),

            /*
            Future proof data.
            The current service can safely ignore these.
            */
            matchedPairs:
                matchedPairs === undefined
                    ? undefined
                    : Number(matchedPairs),

            moveSequence:
                moveSequence === undefined
                    ? undefined
                    : moveSequence
        });

        /*
        ----------------------------------------------------
        KNOWN RESULT ERRORS
        ----------------------------------------------------
        */

        if (
            result?.success === false &&
            result?.error === "ALREADY_COMPLETED"
        ) {
            return res.status(409).json(result);
        }

        if (
            result?.success === false &&
            result?.error === "GAME_NOT_FOUND"
        ) {
            return res.status(404).json(result);
        }

        return res.status(200).json(result);

    } catch (error) {
        console.error(
            "Complete game error:",
            error
        );

        /*
        ----------------------------------------------------
        GAME SESSION
        ----------------------------------------------------
        */

        if (
            error.message ===
            "Game session not found"
        ) {
            return res.status(404).json({
                success: false,
                error:
                    "Game session not found."
            });
        }

        /*
        ----------------------------------------------------
        TOKEN
        ----------------------------------------------------
        */

        if (
            error.message ===
            "Invalid completion token"
        ) {
            return res.status(403).json({
                success: false,
                error:
                    "Invalid completion token."
            });
        }

        /*
        ----------------------------------------------------
        MOVES
        ----------------------------------------------------
        */

        if (
            error.message ===
            "Invalid moves"
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Invalid moves."
            });
        }

        /*
        ----------------------------------------------------
        DURATION
        ----------------------------------------------------
        */

        if (
            error.message ===
            "Invalid duration"
        ) {
            return res.status(400).json({
                success: false,
                error:
                    "Invalid duration."
            });
        }

        /*
        ----------------------------------------------------
        USER
        ----------------------------------------------------
        */

        if (
            error.message ===
            "User not found"
        ) {
            return res.status(404).json({
                success: false,
                error:
                    "User not found."
            });
        }

        /*
        ----------------------------------------------------
        GAME REWARD CONFIGURATION
        ----------------------------------------------------
        */

        if (
            error.message ===
            "Invalid game reward"
        ) {
            return res.status(500).json({
                success: false,
                error:
                    "Game reward configuration error."
            });
        }

        /*
        ----------------------------------------------------
        PUZZLE VERIFICATION
        ----------------------------------------------------
        */

        if (
            error.message ===
            "Invalid puzzle proof"
        ) {
            return res.status(403).json({
                success: false,
                error:
                    "Invalid puzzle proof."
            });
        }

        if (
            error.message ===
            "Puzzle not solved"
        ) {
            return res.status(403).json({
                success: false,
                error:
                    "Puzzle was not solved."
            });
        }

        /*
        ----------------------------------------------------
        GAME EXPIRED
        ----------------------------------------------------
        */

        if (
            error.message ===
            "Game session expired"
        ) {
            return res.status(409).json({
                success: false,
                error:
                    "Game session expired."
            });
        }

        /*
        ----------------------------------------------------
        UNKNOWN ERROR
        ----------------------------------------------------
        */

        return res.status(500).json({
            success: false,
            error:
                "Unable to complete game."
        });
    }
});

export default router;

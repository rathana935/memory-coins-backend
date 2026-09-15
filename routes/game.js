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
GET GAME STATUS
============================================================

GET /api/game/status

Returns:

- coins
- today's coins
- games played
- difficulty levels
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


        } catch (error) {

            console.error(
                "Game status error:",
                error
            );


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


            return res.status(500).json({
                success: false,
                error:
                    "Unable to load game status."
            });

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

IMPORTANT:
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
            Validate difficulty
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
            Start game
            ------------------------------------------------
            */

            const result =
                await startGame(
                    userId,
                    difficulty
                );


            /*
            ------------------------------------------------
            No lives
            ------------------------------------------------
            */

            if (
                result.success === false &&
                result.error === "NO_LIVES"
            ) {

                return res.status(409).json(
                    result
                );

            }


            return res.status(200).json(
                result
            );


        } catch (error) {

            console.error(
                "Start game error:",
                error
            );


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


            if (
                error.message ===
                "Invalid difficulty"
            ) {

                return res.status(400).json({
                    success: false,
                    error:
                        "Invalid difficulty."
                });

            }


            return res.status(500).json({
                success: false,
                error:
                    "Unable to start game."
            });

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

IMPORTANT SECURITY
------------------------------------------------------------
The client MUST NOT send:

- reward
- coins
- balance
- doubleRewardVerified
- rewardMultiplier

The server determines the reward from the game session.

Normal rewards:

Easy   = 10
Medium = 12
Hard   = 15
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


            /*
            ------------------------------------------------
            Read only allowed fields.
            ------------------------------------------------
            */

            const {
                gameId,
                completionToken,
                moves,
                durationSeconds
            } = req.body || {};


            /*
            ------------------------------------------------
            Game ID
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
            Completion token
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
            MOVES VALIDATION
            ------------------------------------------------
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

                return res.status(400).json({
                    success: false,
                    error:
                        "Invalid moves."
                });

            }


            /*
            ------------------------------------------------
            DURATION VALIDATION
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

            Notice:

            There is NO:

            doubleRewardVerified

            parameter.

            There is NO:

            reward

            parameter.

            There is NO:

            coins

            parameter.

            The service decides everything.
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
            Duplicate completion
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


        } catch (error) {

            console.error(
                "Complete game error:",
                error
            );


            /*
            ------------------------------------------------
            Known validation/security errors
            ------------------------------------------------
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
            ------------------------------------------------
            Unknown server error
            ------------------------------------------------

            Do NOT expose internal database details
            to the user.
            ------------------------------------------------
            */

            return res.status(500).json({
                success: false,
                error:
                    "Unable to complete game."
            });

        }

    }
);


export default router;

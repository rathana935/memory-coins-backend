import express from "express";

import {
    startGame,
    completeGame,
    getGameStatus
} from "../services/game.js";

const router = express.Router();


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

router.get("/status", async (req, res) => {

    try {

        /*
        IMPORTANT:
        Use req.user.user_id from auth middleware.

        The authentication middleware stores the
        PostgreSQL users.id value here.
        */

        const userId =
            req.user.user_id;


        if (!userId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authenticated user ID is missing."

            });

        }


        const result =
            await getGameStatus(
                userId
            );


        return res.json(result);

    } catch (error) {

        console.error(
            "Game status error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                error.message ||
                "Unable to load game status."

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

Possible difficulties:

easy
medium
hard

Starting a game consumes ONE life.
============================================================
*/

router.post("/start", async (req, res) => {

    try {

        /*
        Get authenticated PostgreSQL user ID.
        */

        const userId =
            req.user.user_id;


        if (!userId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authenticated user ID is missing."

            });

        }


        const {
            difficulty
        } = req.body;


        if (!difficulty) {

            return res.status(400).json({

                success: false,

                message:
                    "Difficulty is required."

            });

        }


        /*
        Validate difficulty before sending
        it to the game service.
        */

        const allowedDifficulties = [
            "easy",
            "medium",
            "hard"
        ];


        if (
            !allowedDifficulties.includes(
                String(difficulty).toLowerCase()
            )
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid difficulty. Use easy, medium, or hard."

            });

        }


        const result =
            await startGame(
                userId,
                String(difficulty).toLowerCase()
            );


        /*
        No lives available.
        */

        if (
            result.success === false &&
            result.error === "NO_LIVES"
        ) {

            return res.status(409).json(
                result
            );

        }


        return res.json(result);

    } catch (error) {

        console.error(
            "Start game error:",
            error
        );


        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to start game."

        });

    }

});


/*
============================================================
COMPLETE GAME
============================================================

POST /api/game/complete

Body:

{
    "gameId": "123",
    "completionToken": "...",
    "moves": 20,
    "durationSeconds": 25
}

IMPORTANT:

The frontend does NOT send the reward.

The backend gets the reward from the
database game session.

This prevents users from changing:

reward: 10

to:

reward: 100000
============================================================
*/

router.post("/complete", async (req, res) => {

    try {

        /*
        Get authenticated PostgreSQL user ID.
        */

        const userId =
            req.user.user_id;


        if (!userId) {

            return res.status(401).json({

                success: false,

                message:
                    "Authenticated user ID is missing."

            });

        }


        const {
            gameId,
            completionToken,
            moves,
            durationSeconds
        } = req.body;


        if (!gameId) {

            return res.status(400).json({

                success: false,

                message:
                    "gameId is required."

            });

        }


        if (!completionToken) {

            return res.status(400).json({

                success: false,

                message:
                    "completionToken is required."

            });

        }


        const result =
            await completeGame({

                userId,

                gameId,

                completionToken,

                moves,

                durationSeconds

            });


        /*
        Duplicate completion.
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


        return res.json(result);

    } catch (error) {

        console.error(
            "Complete game error:",
            error
        );


        return res.status(400).json({

            success: false,

            message:
                error.message ||
                "Unable to complete game."

        });

    }

});


export default router;

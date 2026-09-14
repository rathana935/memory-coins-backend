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

        const result =
            await getGameStatus(
                req.user.id
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


        const result =
            await startGame(
                req.user.id,
                difficulty
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

                userId:
                    req.user.id,

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

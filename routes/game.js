// routes/game.js

import express from "express";

import {
  startGame,
  completeGame,
  getGameStatus,
} from "../services/game.js";

const router = express.Router();

/* =========================================================
   HELPERS
========================================================= */

function getUserId(req) {
  return (
    req.user?.id ||
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

/*
  IMPORTANT:
  The public API uses:
    easy
    hard
    difficult

  There is NO "medium" difficulty.
*/

const VALID_DIFFICULTIES = ["easy", "hard", "difficult"];

/* =========================================================
   GET GAME STATUS
========================================================= */

router.get("/status", async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
        message: "Authentication required.",
      });
    }

    const result = await getGameStatus(userId);

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("GET /api/game/status error:", error);

    return res.status(500).json({
      success: false,
      error: "GAME_STATUS_FAILED",
      message: "Unable to get game status.",
    });
  }
});

/* =========================================================
   START GAME
========================================================= */

router.post("/start", async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
        message: "Authentication required.",
      });
    }

    const { difficulty } = req.body || {};

    /* -------------------------------------------------------
       Validate difficulty
    ------------------------------------------------------- */

    if (!VALID_DIFFICULTIES.includes(difficulty)) {
      return res.status(400).json({
        success: false,
        error: "INVALID_GAME_DIFFICULTY",
        message: "Invalid difficulty. Use easy, hard, or difficult.",
      });
    }

    /* -------------------------------------------------------
       Start game
       Reward, coins, lives and puzzle data are controlled
       by the backend service.
    ------------------------------------------------------- */

    const result = await startGame(userId, difficulty);

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("POST /api/game/start error:", error);

    const code = error?.code;

    switch (code) {
      case "INVALID_GAME_DIFFICULTY":
        return res.status(400).json({
          success: false,
          error: code,
          message: "Invalid difficulty. Use easy, hard, or difficult.",
        });

      case "NO_LIVES":
        return res.status(400).json({
          success: false,
          error: code,
          message: "You do not have any lives remaining.",
        });

      case "GAME_ALREADY_ACTIVE":
        return res.status(400).json({
          success: false,
          error: code,
          message: "You already have an active game.",
        });

      case "MAX_LEVEL_REACHED":
        return res.status(400).json({
          success: false,
          error: code,
          message: "You have completed all 100 levels.",
        });

      case "UNABLE_TO_CONSUME_LIFE":
        return res.status(500).json({
          success: false,
          error: code,
          message: "Unable to use a life. Please try again.",
        });

      case "GAME_SESSION_CREATE_FAILED":
        return res.status(500).json({
          success: false,
          error: code,
          message: "Unable to create game session.",
        });

      default:
        return res.status(500).json({
          success: false,
          error: "GAME_START_FAILED",
          message: "Unable to start game.",
        });
    }
  }
});

/* =========================================================
   COMPLETE GAME
========================================================= */

router.post("/complete", async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "UNAUTHORIZED",
        message: "Authentication required.",
      });
    }

    const {
      gameId,
      completionToken,
      difficulty,
      moves,
      duration,
      matchedPairs,
      matchedIndexes,
    } = req.body || {};

    /* -------------------------------------------------------
       Validate game ID
    ------------------------------------------------------- */

    if (!isValidUUID(gameId)) {
      return res.status(400).json({
        success: false,
        error: "INVALID_GAME_ID",
        message: "Invalid game ID.",
      });
    }

    /* -------------------------------------------------------
       Validate completion token
    ------------------------------------------------------- */

    if (
      typeof completionToken !== "string" ||
      completionToken.length < 10 ||
      completionToken.length > 500
    ) {
      return res.status(400).json({
        success: false,
        error: "INVALID_COMPLETION_TOKEN",
        message: "Invalid completion token.",
      });
    }

    /* -------------------------------------------------------
       Validate difficulty
    ------------------------------------------------------- */

    if (!VALID_DIFFICULTIES.includes(difficulty)) {
      return res.status(400).json({
        success: false,
        error: "INVALID_GAME_DIFFICULTY",
        message: "Invalid difficulty. Use easy, hard, or difficult.",
      });
    }

    /* -------------------------------------------------------
       Validate moves
    ------------------------------------------------------- */

    if (
      !Number.isInteger(moves) ||
      moves < 1 ||
      moves > 1000
    ) {
      return res.status(400).json({
        success: false,
        error: "INVALID_MOVES",
        message: "Invalid moves value.",
      });
    }

    /* -------------------------------------------------------
       Validate duration
    ------------------------------------------------------- */

    if (
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > 60 * 60
    ) {
      return res.status(400).json({
        success: false,
        error: "INVALID_DURATION",
        message: "Invalid game duration.",
      });
    }

    /* -------------------------------------------------------
       Validate matched pairs
       
       Easy      = 8
       Hard      = 12
       Difficult = 18
       
       Maximum = 18
    ------------------------------------------------------- */

    if (
      !Number.isInteger(matchedPairs) ||
      matchedPairs < 0 ||
      matchedPairs > 18
    ) {
      return res.status(400).json({
        success: false,
        error: "INVALID_MATCHED_PAIRS",
        message: "Invalid matched pairs value.",
      });
    }

    /* -------------------------------------------------------
       Validate matched indexes
       
       Maximum board:
       Difficult = 6 × 6 = 36 cards
       
       Therefore indexes are 0 - 35.
    ------------------------------------------------------- */

    if (
      !Array.isArray(matchedIndexes) ||
      matchedIndexes.length > 36
    ) {
      return res.status(400).json({
        success: false,
        error: "INVALID_MATCHED_INDEXES",
        message: "Invalid matched indexes.",
      });
    }

    for (const index of matchedIndexes) {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index > 35
      ) {
        return res.status(400).json({
          success: false,
          error: "INVALID_MATCHED_INDEX",
          message: "Invalid card index.",
        });
      }
    }

    /* -------------------------------------------------------
       SECURITY:
       Never accept reward/coin values from the frontend.
       
       DO NOT accept:
         reward
         coins
         multiplier
         doubleReward
         adReward
         bonus
       
       The service determines the reward from difficulty.
    ------------------------------------------------------- */

    const result = await completeGame(userId, {
      gameId,
      completionToken,
      difficulty,
      moves,
      duration,
      matchedPairs,
      matchedIndexes,
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("POST /api/game/complete error:", error);

    const code = error?.code;

    switch (code) {
      case "GAME_NOT_FOUND":
        return res.status(404).json({
          success: false,
          error: code,
          message: "Game not found.",
        });

      case "GAME_EXPIRED":
        return res.status(400).json({
          success: false,
          error: code,
          message: "This game has expired.",
        });

      case "GAME_ALREADY_COMPLETED":
        return res.status(400).json({
          success: false,
          error: code,
          message: "This game has already been completed.",
        });

      case "INVALID_COMPLETION_TOKEN":
        return res.status(400).json({
          success: false,
          error: code,
          message: "Invalid completion token.",
        });

      case "INVALID_GAME_DIFFICULTY":
        return res.status(400).json({
          success: false,
          error: code,
          message: "Invalid difficulty. Use easy, hard, or difficult.",
        });

      case "INVALID_GAME_SESSION":
        return res.status(400).json({
          success: false,
          error: code,
          message: "Invalid game session.",
        });

      case "INVALID_PUZZLE":
        return res.status(400).json({
          success: false,
          error: code,
          message: "Invalid puzzle.",
        });

      case "PUZZLE_NOT_COMPLETED":
        return res.status(400).json({
          success: false,
          error: code,
          message: "The puzzle has not been completed.",
        });

      case "INVALID_GAME_START_TIME":
        return res.status(400).json({
          success: false,
          error: code,
          message: "Invalid game start time.",
        });

      case "INVALID_MATCHED_PAIRS":
        return res.status(400).json({
          success: false,
          error: code,
          message: "Invalid matched pairs.",
        });

      case "LEVEL_ALREADY_COMPLETED":
        return res.status(400).json({
          success: false,
          error: code,
          message: "This level has already been completed.",
        });

      default:
        return res.status(500).json({
          success: false,
          error: "GAME_COMPLETE_FAILED",
          message: "Unable to complete game.",
        });
    }
  }
});

/* =========================================================
   EXPORT
========================================================= */

export default router;

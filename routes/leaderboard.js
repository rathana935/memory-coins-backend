import express from "express";
import {
  getLeaderboard
} from "../services/leaderboard.js";

const router = express.Router();

/*
GET /api/leaderboard

Query parameters:
  period = weekly | all_time
  limit  = 1-100
  offset = 0+

Example:
GET /api/leaderboard?period=weekly&limit=20&offset=0
*/

router.get("/", async (req, res) => {
  try {
    let period = String(req.query.period || "weekly").toLowerCase();

    if (!["weekly", "all_time"].includes(period)) {
      return res.status(400).json({
        success: false,
        error: "Invalid period. Use weekly or all_time."
      });
    }

    let limit = Number.parseInt(req.query.limit, 10);

    if (!Number.isInteger(limit)) {
      limit = 20;
    }

    limit = Math.min(Math.max(limit, 1), 100);

    let offset = Number.parseInt(req.query.offset, 10);

    if (!Number.isInteger(offset) || offset < 0) {
      offset = 0;
    }

    const userId = req.user.user_id;

    const result = await getLeaderboard(period, {
      limit,
      offset,
      userId
    });

    return res.json({
      success: true,
      period,
      data: result
    });

  } catch (error) {
    console.error("Leaderboard route error:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to load leaderboard."
    });
  }
});

export default router;

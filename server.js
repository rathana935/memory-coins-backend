import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

import pool from "./db/pool.js";

import authRoutes from "./routes/auth.js";
import gameRoutes from "./routes/game.js";
import rewardsRoutes from "./routes/rewards.js";
import leaderboardRoutes from "./routes/leaderboard.js";
import withdrawalRoutes from "./routes/withdrawals.js";
import referralRoutes from "./routes/referrals.js";

import { requireAuth } from "./middleware/auth.js";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

app.set("trust proxy", 1);

/* =========================================================
   SECURITY
========================================================= */

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);

/* =========================================================
   CORS
========================================================= */

const allowedOrigins = [
  "https://rathana935.github.io",
  "https://web.telegram.org",
  "https://webk.telegram.org"
];

if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (NODE_ENV !== "production") {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      if (
        origin.startsWith("https://web.telegram.org") ||
        origin.startsWith("https://webk.telegram.org")
      ) {
        return callback(null, true);
      }

      return callback(
        new Error("CORS: Origin not allowed")
      );
    },

    credentials: true,

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS"
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization"
    ]
  })
);

/* =========================================================
   BODY PARSING
========================================================= */

app.use(
  express.json({
    limit: "100kb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "100kb"
  })
);

/* =========================================================
   GLOBAL RATE LIMIT
========================================================= */

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,

  standardHeaders: "draft-7",
  legacyHeaders: false,

  message: {
    success: false,
    error:
      "Too many requests. Please try again later."
  }
});

app.use(globalLimiter);

/* =========================================================
   AUTH RATE LIMIT
========================================================= */

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,

  standardHeaders: "draft-7",
  legacyHeaders: false,

  message: {
    success: false,
    error:
      "Too many authentication requests."
  }
});

/* =========================================================
   GAME RATE LIMIT
========================================================= */

const gameLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,

  standardHeaders: "draft-7",
  legacyHeaders: false,

  message: {
    success: false,
    error:
      "Too many game requests."
  }
});

/* =========================================================
   REWARDS RATE LIMIT
========================================================= */

const rewardsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,

  standardHeaders: "draft-7",
  legacyHeaders: false,

  message: {
    success: false,
    error:
      "Too many reward requests."
  }
});

/* =========================================================
   LEADERBOARD RATE LIMIT
========================================================= */

const leaderboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,

  standardHeaders: "draft-7",
  legacyHeaders: false,

  message: {
    success: false,
    error:
      "Too many leaderboard requests."
  }
});

/* =========================================================
   WITHDRAWAL RATE LIMIT
========================================================= */

const withdrawalLimiter = rateLimit({
  windowMs: 60 * 1000,

  limit: 10,

  standardHeaders: "draft-7",
  legacyHeaders: false,

  message: {
    success: false,
    error:
      "Too many withdrawal requests. Please try again later."
  }
});

/* =========================================================
   REFERRAL RATE LIMIT
========================================================= */

const referralLimiter = rateLimit({
  windowMs: 60 * 1000,

  limit: 30,

  standardHeaders: "draft-7",
  legacyHeaders: false,

  message: {
    success: false,
    error:
      "Too many referral requests. Please try again later."
  }
});

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    return res.json({
      success: true,
      status: "ok",
      database: "connected",
      environment: NODE_ENV,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(
      "Health check database error:",
      error
    );

    return res.status(503).json({
      success: false,
      status: "error",
      database: "disconnected"
    });
  }
});

/* =========================================================
   ROOT
========================================================= */

app.get("/", (req, res) => {
  return res.json({
    success: true,
    name: "Memory Coins API",
    version: "1.0.0",
    status: "online"
  });
});

/* =========================================================
   AUTH
========================================================= */

app.use(
  "/api/auth",
  authLimiter,
  authRoutes
);

/* =========================================================
   GAME
========================================================= */

app.use(
  "/api/game",
  gameLimiter,
  requireAuth,
  gameRoutes
);

/* =========================================================
   REWARDS
========================================================= */

app.use(
  "/api/rewards",
  rewardsLimiter,
  requireAuth,
  rewardsRoutes
);

/* =========================================================
   LEADERBOARD
========================================================= */

app.use(
  "/api/leaderboard",
  leaderboardLimiter,
  requireAuth,
  leaderboardRoutes
);

/* =========================================================
   WITHDRAWALS
========================================================= */

app.use(
  "/api/withdrawals",
  withdrawalLimiter,
  requireAuth,
  withdrawalRoutes
);

/* =========================================================
   REFERRALS
========================================================= */

app.use(
  "/api/referrals",
  referralLimiter,
  requireAuth,
  referralRoutes
);

/* =========================================================
   404
========================================================= */

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    error: "Route not found.",
    path: req.originalUrl
  });
});

/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */

app.use((error, req, res, next) => {
  console.error(
    "Unhandled server error:",
    error
  );

  if (
    error.message?.startsWith("CORS:")
  ) {
    return res.status(403).json({
      success: false,
      error: "Origin not allowed."
    });
  }

  return res.status(500).json({
    success: false,
    error: "Internal server error."
  });
});

/* =========================================================
   START SERVER
========================================================= */

const server = app.listen(
  PORT,
  () => {
    console.log(
      "========================================"
    );

    console.log(
      "Memory Coins Backend"
    );

    console.log(
      "========================================"
    );

    console.log(
      `Environment: ${NODE_ENV}`
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `Server: http://localhost:${PORT}`
    );

    console.log(
      "Referral API: /api/referrals"
    );

    console.log(
      "========================================"
    );
  }
);

/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

async function shutdown(signal) {
  console.log(
    `${signal} received. Shutting down...`
  );

  server.close(async () => {
    try {
      await pool.end();

      console.log(
        "Database pool closed."
      );

      console.log(
        "Server stopped."
      );

      process.exit(0);

    } catch (error) {
      console.error(
        "Shutdown error:",
        error
      );

      process.exit(1);
    }
  });
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

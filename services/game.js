// services/game.js

import crypto from "crypto";
import pool from "../db/pool.js";

/* =========================================================
   GAME CONFIGURATION
========================================================= */

const GAME_CONFIG = {
  easy: {
    rows: 4,
    cols: 4,
    pairs: 8,
    reward: 10,
    maxGames: 100,
  },

  hard: {
    rows: 4,
    cols: 6,
    pairs: 12,
    reward: 12,
    maxGames: 100,
  },

  difficult: {
    rows: 6,
    cols: 6,
    pairs: 18,
    reward: 15,
    maxGames: 100,
  },
};

/* =========================================================
   LIFE CONFIGURATION
========================================================= */

const MAX_LIVES = 5;
const LIFE_COOLDOWN_SECONDS = 60 * 60;

/* =========================================================
   CARD SYMBOLS
========================================================= */

const CARD_SYMBOLS = [
  "🍎",
  "🍌",
  "🍇",
  "🍉",
  "🍓",
  "🍒",
  "🥝",
  "🍍",
  "🥭",
  "🍑",
  "🍊",
  "🍋",
  "🥥",
  "🍈",
  "🍏",
  "🫐",
  "🌽",
  "🥦",
];

/* =========================================================
   BASIC VALIDATION
========================================================= */

function isValidDifficulty(difficulty) {
  return Object.prototype.hasOwnProperty.call(
    GAME_CONFIG,
    difficulty
  );
}

function getConfig(difficulty) {
  if (!isValidDifficulty(difficulty)) {
    const error = new Error("Invalid game difficulty.");
    error.code = "INVALID_GAME_DIFFICULTY";
    throw error;
  }

  return GAME_CONFIG[difficulty];
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

/* =========================================================
   SECURE SHUFFLE
========================================================= */

function secureShuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const random = crypto.randomInt(0, i + 1);

    const temp = result[i];
    result[i] = result[random];
    result[random] = temp;
  }

  return result;
}

/* =========================================================
   GENERATE PUZZLE
========================================================= */

function generatePuzzle(pairCount) {
  if (
    !Number.isInteger(pairCount) ||
    pairCount < 1 ||
    pairCount > CARD_SYMBOLS.length
  ) {
    const error = new Error("Invalid pair count.");
    error.code = "INVALID_PAIR_COUNT";
    throw error;
  }

  const selectedSymbols = CARD_SYMBOLS.slice(0, pairCount);

  const cards = [];

  for (const symbol of selectedSymbols) {
    cards.push(symbol);
    cards.push(symbol);
  }

  return secureShuffle(cards);
}

/* =========================================================
   PUZZLE HASH
========================================================= */

function hashPuzzle(cards) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(cards))
    .digest("hex");
}

/* =========================================================
   CREATE PUZZLE DATA
========================================================= */

function createPuzzleData(difficulty) {
  const config = getConfig(difficulty);

  const cards = generatePuzzle(config.pairs);

  return {
    cards,
    puzzleHash: hashPuzzle(cards),
    rows: config.rows,
    cols: config.cols,
    pairs: config.pairs,
  };
}

/* =========================================================
   VERIFY PUZZLE SOLUTION
========================================================= */

function verifyPuzzleSolution({
  cards,
  matchedIndexes,
  matchedPairs,
}) {
  if (!Array.isArray(cards)) {
    return false;
  }

  if (!Array.isArray(matchedIndexes)) {
    return false;
  }

  if (!Number.isInteger(matchedPairs)) {
    return false;
  }

  const expectedPairs = cards.length / 2;

  if (cards.length === 0 || cards.length % 2 !== 0) {
    return false;
  }

  if (matchedPairs !== expectedPairs) {
    return false;
  }

  if (matchedIndexes.length !== cards.length) {
    return false;
  }

  const uniqueIndexes = new Set(matchedIndexes);

  if (uniqueIndexes.size !== cards.length) {
    return false;
  }

  for (let i = 0; i < cards.length; i++) {
    if (!uniqueIndexes.has(i)) {
      return false;
    }
  }

  for (let i = 0; i < cards.length; i += 2) {
    const firstIndex = matchedIndexes[i];
    const secondIndex = matchedIndexes[i + 1];

    if (cards[firstIndex] !== cards[secondIndex]) {
      return false;
    }
  }

  return true;
}

/* =========================================================
   LIFE RECOVERY
========================================================= */

function calculateRecoveredLives(lives, lastLifeAt) {
  let currentLives = Number(lives ?? 0);

  if (currentLives >= MAX_LIVES) {
    return {
      lives: MAX_LIVES,
      recovered: 0,
      nextLifeAt: null,
    };
  }

  if (!lastLifeAt) {
    return {
      lives: currentLives,
      recovered: 0,
      nextLifeAt: null,
    };
  }

  const lastTime = new Date(lastLifeAt).getTime();
  const now = Date.now();

  if (!Number.isFinite(lastTime)) {
    return {
      lives: currentLives,
      recovered: 0,
      nextLifeAt: null,
    };
  }

  const elapsedSeconds = Math.floor(
    (now - lastTime) / 1000
  );

  if (elapsedSeconds < LIFE_COOLDOWN_SECONDS) {
    return {
      lives: currentLives,
      recovered: 0,
      nextLifeAt:
        new Date(
          lastTime + LIFE_COOLDOWN_SECONDS * 1000
        ).toISOString(),
    };
  }

  const recovered = Math.min(
    MAX_LIVES - currentLives,
    Math.floor(
      elapsedSeconds / LIFE_COOLDOWN_SECONDS
    )
  );

  currentLives += recovered;

  if (currentLives >= MAX_LIVES) {
    return {
      lives: MAX_LIVES,
      recovered,
      nextLifeAt: null,
    };
  }

  const remainingSeconds =
    LIFE_COOLDOWN_SECONDS -
    (elapsedSeconds % LIFE_COOLDOWN_SECONDS);

  return {
    lives: currentLives,
    recovered,
    nextLifeAt: new Date(
      now + remainingSeconds * 1000
    ).toISOString(),
  };
}

/* =========================================================
   UPDATE / RECOVER USER LIVES
========================================================= */

async function refreshUserLives(userId) {
  const result = await pool.query(
    `
    SELECT
      id,
      lives,
      last_life_at
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId]
  );

  if (result.rowCount === 0) {
    const error = new Error("User not found.");
    error.code = "USER_NOT_FOUND";
    throw error;
  }

  const user = result.rows[0];

  const recovery = calculateRecoveredLives(
    user.lives,
    user.last_life_at
  );

  if (recovery.recovered > 0) {
    let newLastLifeAt = user.last_life_at;

    if (recovery.lives >= MAX_LIVES) {
      newLastLifeAt = null;
    } else {
      newLastLifeAt = new Date();
    }

    await pool.query(
      `
      UPDATE users
      SET
        lives = $1,
        last_life_at = $2
      WHERE id = $3
      `,
      [
        recovery.lives,
        newLastLifeAt,
        userId,
      ]
    );
  }

  return {
    lives: recovery.lives,
    nextLifeAt: recovery.nextLifeAt,
  };
}

/* =========================================================
   GET USER PROGRESS
========================================================= */

async function getUserProgress(userId) {
  const result = await pool.query(
    `
    SELECT
      easy_level,
      medium_level,
      hard_level,
      easy_games,
      medium_games,
      hard_games
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId]
  );

  if (result.rowCount === 0) {
    const error = new Error("User not found.");
    error.code = "USER_NOT_FOUND";
    throw error;
  }

  const user = result.rows[0];

  return {
    easy: {
      level: Number(user.easy_level ?? 1),
      games: Number(user.easy_games ?? 0),
    },

    hard: {
      level: Number(user.medium_level ?? 1),
      games: Number(user.medium_games ?? 0),
    },

    difficult: {
      level: Number(user.hard_level ?? 1),
      games: Number(user.hard_games ?? 0),
    },
  };
}

/* =========================================================
   START GAME
========================================================= */

export async function startGame(userId, difficulty) {
  const config = getConfig(difficulty);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `
      SELECT
        id,
        lives,
        last_life_at,
        easy_level,
        medium_level,
        hard_level,
        easy_games,
        medium_games,
        hard_games
      FROM users
      WHERE id = $1
      FOR UPDATE
      `,
      [userId]
    );

    if (userResult.rowCount === 0) {
      const error = new Error("User not found.");
      error.code = "USER_NOT_FOUND";
      throw error;
    }

    const user = userResult.rows[0];

    /* -------------------------------------------------------
       Recover lives before starting
    ------------------------------------------------------- */

    const recovery = calculateRecoveredLives(
      user.lives,
      user.last_life_at
    );

    let lives = recovery.lives;
    let lastLifeAt = user.last_life_at;

    if (recovery.recovered > 0) {
      if (lives >= MAX_LIVES) {
        lastLifeAt = null;
      } else {
        lastLifeAt = new Date();
      }

      await client.query(
        `
        UPDATE users
        SET
          lives = $1,
          last_life_at = $2
        WHERE id = $3
        `,
        [
          lives,
          lastLifeAt,
          userId,
        ]
      );
    }

    /* -------------------------------------------------------
       Check lives
    ------------------------------------------------------- */

    if (lives <= 0) {
      const error = new Error(
        "No lives remaining."
      );
      error.code = "NO_LIVES";
      throw error;
    }

    /* -------------------------------------------------------
       Determine current level
       
       Public:
         easy      -> easy_level
         hard      -> medium_level
         difficult -> hard_level
    ------------------------------------------------------- */

    let currentLevel;

    if (difficulty === "easy") {
      currentLevel = Number(
        user.easy_level ?? 1
      );
    } else if (difficulty === "hard") {
      currentLevel = Number(
        user.medium_level ?? 1
      );
    } else {
      currentLevel = Number(
        user.hard_level ?? 1
      );
    }

    /* -------------------------------------------------------
       Check 100-level limit
    ------------------------------------------------------- */

    if (currentLevel > config.maxGames) {
      const error = new Error(
        "Maximum level reached."
      );
      error.code = "MAX_LEVEL_REACHED";
      throw error;
    }

    /* -------------------------------------------------------
       Prevent multiple active games
    ------------------------------------------------------- */

    const activeGame = await client.query(
      `
      SELECT id
      FROM game_sessions
      WHERE
        user_id = $1
        AND completed_at IS NULL
        AND expires_at > NOW()
      LIMIT 1
      `,
      [userId]
    );

    if (activeGame.rowCount > 0) {
      const error = new Error(
        "Game already active."
      );
      error.code = "GAME_ALREADY_ACTIVE";
      throw error;
    }

    /* -------------------------------------------------------
       Generate server-side puzzle
    ------------------------------------------------------- */

    const puzzle = createPuzzleData(
      difficulty
    );

    const gameId = crypto.randomUUID();

    const completionToken = createToken();

    const expiresAt = new Date(
      Date.now() + 15 * 60 * 1000
    );

    /* -------------------------------------------------------
       Consume one life
    ------------------------------------------------------- */

    const newLives = lives - 1;

    /*
      If the player was at MAX_LIVES and starts a game,
      begin the 1-hour recovery timer.

      If a timer is already running, keep it.
    */

    if (
      newLives < MAX_LIVES &&
      !lastLifeAt
    ) {
      lastLifeAt = new Date();
    }

    await client.query(
      `
      UPDATE users
      SET
        lives = $1,
        last_life_at = $2
      WHERE id = $3
      `,
      [
        newLives,
        lastLifeAt,
        userId,
      ]
    );

    /* -------------------------------------------------------
       Save game session
    ------------------------------------------------------- */

    await client.query(
      `
      INSERT INTO game_sessions (
        id,
        user_id,
        difficulty,
        level,
        rows,
        cols,
        pairs,
        reward,
        puzzle,
        puzzle_hash,
        completion_token,
        started_at,
        expires_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        NOW(),
        $12
      )
      `,
      [
        gameId,
        userId,
        difficulty,
        currentLevel,
        puzzle.rows,
        puzzle.cols,
        puzzle.pairs,
        config.reward,
        JSON.stringify(puzzle.cards),
        puzzle.puzzleHash,
        completionToken,
        expiresAt,
      ]
    );

    await client.query("COMMIT");

    /* -------------------------------------------------------
       Return puzzle to frontend
       
       The completion token is required to complete this
       exact server-created game.
    ------------------------------------------------------- */

    return {
      gameId,
      difficulty,
      level: currentLevel,

      rows: puzzle.rows,
      cols: puzzle.cols,
      pairs: puzzle.pairs,

      cards: puzzle.cards,

      reward: config.reward,

      lives: newLives,

      nextLifeAt:
        lastLifeAt && newLives < MAX_LIVES
          ? new Date(
              new Date(lastLifeAt).getTime() +
                LIFE_COOLDOWN_SECONDS * 1000
            ).toISOString()
          : null,

      completionToken,

      expiresAt:
        expiresAt.toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

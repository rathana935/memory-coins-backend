import crypto from "crypto";
import pool from "../db/pool.js";

/* =========================================================
   CONFIG
========================================================= */

const MAX_LIVES = 5;
const LIFE_REGEN_SECONDS = 60 * 60; // 1 hour
const SESSION_SECONDS = 15 * 60;    // 15 minutes

const DIFFICULTIES = {
  easy: {
    rows: 4,
    cols: 4,
    pairs: 8,
    reward: 10,
    levelColumn: "easy_level"
  },

  hard: {
    rows: 4,
    cols: 6,
    pairs: 12,
    reward: 12,
    levelColumn: "hard_level"
  },

  difficult: {
    rows: 6,
    cols: 6,
    pairs: 18,
    reward: 15,
    levelColumn: "difficult_level"
  }
};

/* =========================================================
   HELPERS
========================================================= */

function getDifficultyConfig(difficulty) {
  return (
    DIFFICULTIES[
      String(difficulty || "").toLowerCase()
    ] || null
  );
}

function normalizeDifficulty(difficulty) {
  return String(difficulty || "")
    .trim()
    .toLowerCase();
}

function randomInt(max) {
  return crypto.randomInt(0, max);
}

function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);

    [result[i], result[j]] = [
      result[j],
      result[i]
    ];
  }

  return result;
}

function createPuzzle(pairs) {
  const deck = [];

  for (let i = 0; i < pairs; i++) {
    const value = i + 1;

    deck.push({
      id: `${value}a`,
      pairId: value
    });

    deck.push({
      id: `${value}b`,
      pairId: value
    });
  }

  return shuffle(deck);
}

function hashPuzzle(puzzle) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(puzzle))
    .digest("hex");
}

function calculateLives(lives, lastLifeAt) {
  let currentLives = Math.max(
    0,
    Math.min(MAX_LIVES, Number(lives || 0))
  );

  if (currentLives >= MAX_LIVES) {
    return {
      lives: MAX_LIVES,
      lastLifeAt: lastLifeAt || null
    };
  }

  if (!lastLifeAt) {
    return {
      lives: currentLives,
      lastLifeAt: null
    };
  }

  const last = new Date(lastLifeAt).getTime();

  if (!Number.isFinite(last)) {
    return {
      lives: currentLives,
      lastLifeAt: null
    };
  }

  const now = Date.now();

  const elapsedSeconds = Math.floor(
    (now - last) / 1000
  );

  const recovered = Math.floor(
    elapsedSeconds / LIFE_REGEN_SECONDS
  );

  if (recovered <= 0) {
    return {
      lives: currentLives,
      lastLifeAt
    };
  }

  currentLives = Math.min(
    MAX_LIVES,
    currentLives + recovered
  );

  if (currentLives >= MAX_LIVES) {
    return {
      lives: MAX_LIVES,
      lastLifeAt: null
    };
  }

  const consumedRecoverySeconds =
    recovered * LIFE_REGEN_SECONDS;

  const newLastLifeAt = new Date(
    last +
      consumedRecoverySeconds * 1000
  );

  return {
    lives: currentLives,
    lastLifeAt: newLastLifeAt
  };
}

function getNextLifeAt(lives, lastLifeAt) {
  if (Number(lives) >= MAX_LIVES) {
    return null;
  }

  if (!lastLifeAt) {
    return new Date(
      Date.now() +
        LIFE_REGEN_SECONDS * 1000
    ).toISOString();
  }

  return new Date(
    new Date(lastLifeAt).getTime() +
      LIFE_REGEN_SECONDS * 1000
  ).toISOString();
}

function sanitizePuzzle(puzzle) {
  if (!Array.isArray(puzzle)) {
    return [];
  }

  return puzzle.map((card, index) => ({
    index,
    id: String(card.id),
    pairId: Number(card.pairId)
  }));
}

function verifyPuzzleSolution(
  puzzle,
  matchedIndexes,
  matchedPairs
) {
  if (!Array.isArray(puzzle)) {
    return false;
  }

  if (!Array.isArray(matchedIndexes)) {
    return false;
  }

  const expectedPairs =
    puzzle.length / 2;

  if (
    Number(matchedPairs) !==
    expectedPairs
  ) {
    return false;
  }

  const indexes = matchedIndexes
    .map(Number)
    .filter(Number.isInteger);

  if (indexes.length !== puzzle.length) {
    return false;
  }

  const uniqueIndexes = new Set(indexes);

  if (uniqueIndexes.size !== puzzle.length) {
    return false;
  }

  for (const index of indexes) {
    if (
      index < 0 ||
      index >= puzzle.length
    ) {
      return false;
    }
  }

  const pairCounts = new Map();

  for (const index of indexes) {
    const card = puzzle[index];

    if (!card) {
      return false;
    }

    const pairId = Number(card.pairId);

    pairCounts.set(
      pairId,
      (pairCounts.get(pairId) || 0) + 1
    );
  }

  for (const count of pairCounts.values()) {
    if (count !== 2) {
      return false;
    }
  }

  return (
    pairCounts.size === expectedPairs
  );
}

/* =========================================================
   START GAME
========================================================= */

export async function startGame({
  userId,
  difficulty,
  level
}) {
  const client = await pool.connect();

  try {
    const normalizedDifficulty =
      normalizeDifficulty(difficulty);

    const config =
      getDifficultyConfig(
        normalizedDifficulty
      );

    if (!config) {
      const error = new Error(
        "Invalid difficulty."
      );

      error.code =
        "INVALID_DIFFICULTY";

      throw error;
    }

    const requestedLevel =
      Number(level);

    if (
      !Number.isInteger(requestedLevel) ||
      requestedLevel < 1 ||
      requestedLevel > 100
    ) {
      const error = new Error(
        "Invalid level."
      );

      error.code =
        "INVALID_LEVEL";

      throw error;
    }

    await client.query("BEGIN");

    /* -------------------------------------------------------
       LOCK USER
    ------------------------------------------------------- */

    const userResult =
      await client.query(
        `
        SELECT
          id,
          telegram_id,
          coins,
          lives,
          last_life_at,
          easy_level,
          hard_level,
          difficult_level
        FROM users
        WHERE id = $1
        FOR UPDATE
        `,
        [userId]
      );

    if (userResult.rowCount === 0) {
      const error = new Error(
        "User not found."
      );

      error.code =
        "USER_NOT_FOUND";

      throw error;
    }

    const user =
      userResult.rows[0];

    /* -------------------------------------------------------
       RECOVER LIVES
    ------------------------------------------------------- */

    const recovered =
      calculateLives(
        user.lives,
        user.last_life_at
      );

    let lives =
      recovered.lives;

    let lastLifeAt =
      recovered.lastLifeAt;

    /* -------------------------------------------------------
       UPDATE RECOVERED LIVES
    ------------------------------------------------------- */

    if (
      lives !== Number(user.lives) ||
      String(lastLifeAt || "") !==
        String(user.last_life_at || "")
    ) {
      await client.query(
        `
        UPDATE users
        SET
          lives = $1,
          last_life_at = $2,
          updated_at = NOW()
        WHERE id = $3
        `,
        [
          lives,
          lastLifeAt,
          userId
        ]
      );
    }

    /* -------------------------------------------------------
       CHECK LIVES
    ------------------------------------------------------- */

    if (lives <= 0) {
      await client.query(
        "ROLLBACK"
      );

      const error = new Error(
        "No lives available."
      );

      error.code =
        "NO_LIVES";

      error.lives = 0;

      error.nextLifeAt =
        getNextLifeAt(
          lives,
          lastLifeAt
        );

      throw error;
    }

    /* -------------------------------------------------------
       CHECK CURRENT LEVEL
    ------------------------------------------------------- */

    const currentLevel =
      Number(
        user[config.levelColumn] || 1
      );

    if (
      requestedLevel >
      currentLevel
    ) {
      await client.query(
        "ROLLBACK"
      );

      const error = new Error(
        "Level is locked."
      );

      error.code =
        "LEVEL_LOCKED";

      error.currentLevel =
        currentLevel;

      throw error;
    }

    /* -------------------------------------------------------
       CHECK ACTIVE GAME
    ------------------------------------------------------- */

    const activeResult =
      await client.query(
        `
        SELECT id
        FROM game_sessions
        WHERE
          user_id = $1
          AND status = 'started'
          AND expires_at > NOW()
        LIMIT 1
        `,
        [userId]
      );

    if (activeResult.rowCount > 0) {
      await client.query(
        "ROLLBACK"
      );

      const error = new Error(
        "You already have an active game."
      );

      error.code =
        "ACTIVE_GAME_EXISTS";

      throw error;
    }

    /* -------------------------------------------------------
       CREATE PUZZLE
    ------------------------------------------------------- */

    const puzzle =
      createPuzzle(config.pairs);

    const puzzleHash =
      hashPuzzle(puzzle);

    const completionToken =
      crypto.randomUUID();

    const expiresAt =
      new Date(
        Date.now() +
          SESSION_SECONDS * 1000
      );

    /* -------------------------------------------------------
       CONSUME LIFE
    ------------------------------------------------------- */

    lives -= 1;

    if (lives < MAX_LIVES) {
      lastLifeAt = new Date();
    }

    /* -------------------------------------------------------
       CREATE GAME SESSION

       IMPORTANT:
       Both reward and reward_coins are written.

       reward_coins exists as a legacy NOT NULL column
       in your current PostgreSQL database.
    ------------------------------------------------------- */

    const sessionResult =
      await client.query(
        `
        INSERT INTO game_sessions (
          user_id,
          difficulty,
          level,
          pairs,
          reward,
          reward_coins,
          status,
          started_at,
          expires_at,
          rows,
          cols,
          puzzle,
          puzzle_hash,
          completion_token,
          matched_pairs,
          matched_indexes
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $5,
          'started',
          NOW(),
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          NULL,
          NULL
        )
        RETURNING
          id,
          completion_token,
          expires_at
        `,
        [
          userId,
          normalizedDifficulty,
          requestedLevel,
          config.pairs,
          config.reward,
          expiresAt,
          config.rows,
          config.cols,
          JSON.stringify(puzzle),
          puzzleHash,
          completionToken
        ]
      );

    const session =
      sessionResult.rows[0];

    /* -------------------------------------------------------
       SAVE LIFE
    ------------------------------------------------------- */

    await client.query(
      `
      UPDATE users
      SET
        lives = $1,
        last_life_at = $2,
        updated_at = NOW()
      WHERE id = $3
      `,
      [
        lives,
        lastLifeAt,
        userId
      ]
    );

    await client.query(
      "COMMIT"
    );

    return {
      success: true,

      gameSessionId:
        session.id,

      difficulty:
        normalizedDifficulty,

      level:
        requestedLevel,

      rows:
        config.rows,

      cols:
        config.cols,

      pairs:
        config.pairs,

      reward:
        config.reward,

      puzzle:
        sanitizePuzzle(puzzle),

      completionToken:
        session.completion_token,

      expiresAt:
        session.expires_at,

      lives,

      nextLifeAt:
        getNextLifeAt(
          lives,
          lastLifeAt
        )
    };
  } catch (error) {
    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

/* =========================================================
   COMPLETE GAME
========================================================= */

export async function completeGame({
  userId,
  gameSessionId,
  completionToken,
  moves,
  durationSeconds,
  matchedPairs,
  matchedIndexes
}) {
  const client = await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    /* -------------------------------------------------------
       GET GAME SESSION
    ------------------------------------------------------- */

    const sessionResult =
      await client.query(
        `
        SELECT
          id,
          user_id,
          difficulty,
          level,
          pairs,
          reward,
          reward_coins,
          status,
          started_at,
          expires_at,
          completion_token,
          puzzle,
          puzzle_hash
        FROM game_sessions
        WHERE id = $1
        FOR UPDATE
        `,
        [gameSessionId]
      );

    if (sessionResult.rowCount === 0) {
      const error = new Error(
        "Game session not found."
      );

      error.code =
        "SESSION_NOT_FOUND";

      throw error;
    }

    const session =
      sessionResult.rows[0];

    /* -------------------------------------------------------
       OWNERSHIP
    ------------------------------------------------------- */

    if (
      String(session.user_id) !==
      String(userId)
    ) {
      const error = new Error(
        "Invalid game session."
      );

      error.code =
        "INVALID_SESSION";

      throw error;
    }

    /* -------------------------------------------------------
       STATUS
    ------------------------------------------------------- */

    if (
      session.status !==
      "started"
    ) {
      const error = new Error(
        "Game session is no longer active."
      );

      error.code =
        "SESSION_NOT_ACTIVE";

      throw error;
    }

    /* -------------------------------------------------------
       COMPLETION TOKEN
    ------------------------------------------------------- */

    if (
      String(session.completion_token) !==
      String(completionToken)
    ) {
      const error = new Error(
        "Invalid completion token."
      );

      error.code =
        "INVALID_COMPLETION_TOKEN";

      throw error;
    }

    /* -------------------------------------------------------
       EXPIRATION
    ------------------------------------------------------- */

    if (
      session.expires_at &&
      new Date(session.expires_at)
        .getTime() < Date.now()
    ) {
      await client.query(
        `
        UPDATE game_sessions
        SET
          status = 'expired',
          completed_at = NOW()
        WHERE id = $1
        `,
        [gameSessionId]
      );

      await client.query(
        "COMMIT"
      );

      const error = new Error(
        "Game session expired."
      );

      error.code =
        "SESSION_EXPIRED";

      throw error;
    }

    /* -------------------------------------------------------
       VALIDATE MOVES
    ------------------------------------------------------- */

    const totalMoves =
      Number(moves);

    if (
      !Number.isInteger(totalMoves) ||
      totalMoves <= 0 ||
      totalMoves > 10000
    ) {
      const error = new Error(
        "Invalid moves."
      );

      error.code =
        "INVALID_MOVES";

      throw error;
    }

    /* -------------------------------------------------------
       VALIDATE DURATION
    ------------------------------------------------------- */

    const duration =
      Number(durationSeconds);

    if (
      !Number.isFinite(duration) ||
      duration < 0 ||
      duration > SESSION_SECONDS + 60
    ) {
      const error = new Error(
        "Invalid game duration."
      );

      error.code =
        "INVALID_DURATION";

      throw error;
    }

    /* -------------------------------------------------------
       PUZZLE
    ------------------------------------------------------- */

    let puzzle =
      session.puzzle;

    if (
      typeof puzzle === "string"
    ) {
      try {
        puzzle =
          JSON.parse(puzzle);
      } catch {
        const error = new Error(
          "Invalid puzzle data."
        );

        error.code =
          "INVALID_PUZZLE";

        throw error;
      }
    }

    if (!Array.isArray(puzzle)) {
      const error = new Error(
        "Invalid puzzle."
      );

      error.code =
        "INVALID_PUZZLE";

      throw error;
    }

    /* -------------------------------------------------------
       VERIFY PUZZLE HASH
    ------------------------------------------------------- */

    const calculatedHash =
      hashPuzzle(puzzle);

    if (
      String(calculatedHash) !==
      String(session.puzzle_hash)
    ) {
      const error = new Error(
        "Puzzle verification failed."
      );

      error.code =
        "PUZZLE_HASH_MISMATCH";

      throw error;
    }

    /* -------------------------------------------------------
       VERIFY SOLUTION
    ------------------------------------------------------- */

    const solutionValid =
      verifyPuzzleSolution(
        puzzle,
        matchedIndexes,
        matchedPairs
      );

    if (!solutionValid) {
      const error = new Error(
        "Invalid puzzle solution."
      );

      error.code =
        "INVALID_SOLUTION";

      throw error;
    }

    /* -------------------------------------------------------
       LOCK USER
    ------------------------------------------------------- */

    const userResult =
      await client.query(
        `
        SELECT
          id,
          coins,
          lives,
          last_life_at,
          games_played,
          easy_level,
          hard_level,
          difficult_level
        FROM users
        WHERE id = $1
        FOR UPDATE
        `,
        [userId]
      );

    if (userResult.rowCount === 0) {
      const error = new Error(
        "User not found."
      );

      error.code =
        "USER_NOT_FOUND";

      throw error;
    }

    const user =
      userResult.rows[0];

    /* -------------------------------------------------------
       RECOVER LIVES
    ------------------------------------------------------- */

    const recovered =
      calculateLives(
        user.lives,
        user.last_life_at
      );

    const lives =
      recovered.lives;

    const lastLifeAt =
      recovered.lastLifeAt;

    /* -------------------------------------------------------
       REWARD
    ------------------------------------------------------- */

    const reward =
      Number(
        session.reward ??
        session.reward_coins ??
        0
      );

    if (
      !Number.isInteger(reward) ||
      reward <= 0
    ) {
      const error = new Error(
        "Invalid reward."
      );

      error.code =
        "INVALID_REWARD";

      throw error;
    }

    /* -------------------------------------------------------
       NEXT LEVEL
    ------------------------------------------------------- */

    const config =
      getDifficultyConfig(
        session.difficulty
      );

    if (!config) {
      const error = new Error(
        "Invalid difficulty."
      );

      error.code =
        "INVALID_DIFFICULTY";

      throw error;
    }

    const completedLevel =
      Number(session.level);

    const maxLevel = 100;

    const currentLevel =
      Number(
        user[config.levelColumn] || 1
      );

    let nextLevel =
      currentLevel;

    let completedAllLevels =
      false;

    if (
      completedLevel >= currentLevel
    ) {
      nextLevel =
        Math.min(
          maxLevel + 1,
          completedLevel + 1
        );
    }

    if (
      completedLevel >= maxLevel
    ) {
      completedAllLevels = true;
      nextLevel = maxLevel + 1;
    }

    /* -------------------------------------------------------
       UPDATE USER
    ------------------------------------------------------- */

    const newCoins =
      Number(user.coins || 0) +
      reward;

    const newGamesPlayed =
      Number(user.games_played || 0) +
      1;

    await client.query(
      `
      UPDATE users
      SET
        coins = $1,
        games_played = $2,
        ${config.levelColumn} = $3,
        lives = $4,
        last_life_at = $5,
        updated_at = NOW()
      WHERE id = $6
      `,
      [
        newCoins,
        newGamesPlayed,
        nextLevel,
        lives,
        lastLifeAt,
        userId
      ]
    );

    /* -------------------------------------------------------
       COMPLETE SESSION
    ------------------------------------------------------- */

    await client.query(
      `
      UPDATE game_sessions
      SET
        status = 'completed',
        completed_at = NOW(),
        moves = $1,
        duration_seconds = $2,
        matched_pairs = $3,
        matched_indexes = $4
      WHERE id = $5
      `,
      [
        totalMoves,
        Math.floor(duration),
        Number(matchedPairs),
        JSON.stringify(
          matchedIndexes
        ),
        gameSessionId
      ]
    );

    /* -------------------------------------------------------
       GAME RESULT
    ------------------------------------------------------- */

    await client.query(
      `
      INSERT INTO game_results (
        user_id,
        game_session_id,
        difficulty,
        level,
        reward_coins,
        moves,
        duration_seconds,
        created_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        NOW()
      )
      ON CONFLICT (game_session_id)
      DO NOTHING
      `,
      [
        userId,
        gameSessionId,
        session.difficulty,
        completedLevel,
        reward,
        totalMoves,
        Math.floor(duration)
      ]
    );

    /* -------------------------------------------------------
       COIN TRANSACTION
    ------------------------------------------------------- */

    await client.query(
      `
      INSERT INTO coin_transactions (
        user_id,
        amount,
        type,
        reference_id,
        created_at
      )
      VALUES (
        $1,
        $2,
        'game_reward',
        $3,
        NOW()
      )
      `,
      [
        userId,
        reward,
        String(gameSessionId)
      ]
    );

    await client.query(
      "COMMIT"
    );

    return {
      success: true,

      completedLevel,

      nextLevel,

      completedAllLevels,

      reward,

      coins:
        newCoins,

      lives,

      nextLifeAt:
        getNextLifeAt(
          lives,
          lastLifeAt
        ),

      doubleRewardAvailable: true
    };
  } catch (error) {
    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

/* =========================================================
   GET GAME STATUS
========================================================= */

export async function getGameStatus({
  userId
}) {
  const result =
    await pool.query(
      `
      SELECT
        id,
        difficulty,
        level,
        pairs,
        reward,
        reward_coins,
        status,
        started_at,
        expires_at,
        completion_token,
        puzzle,
        rows,
        cols,
        puzzle_hash,
        matched_pairs,
        matched_indexes
      FROM game_sessions
      WHERE
        user_id = $1
        AND status = 'started'
      ORDER BY started_at DESC
      LIMIT 1
      `,
      [userId]
    );

  if (result.rowCount === 0) {
    return {
      active: false,
      session: null
    };
  }

  const session =
    result.rows[0];

  /* -------------------------------------------------------
     CHECK EXPIRATION
  ------------------------------------------------------- */

  if (
    session.expires_at &&
    new Date(session.expires_at)
      .getTime() <= Date.now()
  ) {
    await pool.query(
      `
      UPDATE game_sessions
      SET
        status = 'expired',
        completed_at = COALESCE(
          completed_at,
          NOW()
        )
      WHERE id = $1
        AND status = 'started'
      `,
      [session.id]
    );

    return {
      active: false,
      session: null
    };
  }

  /* -------------------------------------------------------
     PARSE PUZZLE
  ------------------------------------------------------- */

  let puzzle =
    session.puzzle;

  if (
    typeof puzzle === "string"
  ) {
    try {
      puzzle =
        JSON.parse(puzzle);
    } catch {
      puzzle = [];
    }
  }

  return {
    active: true,

    session: {
      gameSessionId:
        session.id,

      difficulty:
        session.difficulty,

      level:
        Number(session.level),

      pairs:
        Number(session.pairs),

      rows:
        Number(session.rows),

      cols:
        Number(session.cols),

      reward:
        Number(
          session.reward ??
          session.reward_coins ??
          0
        ),

      puzzle:
        sanitizePuzzle(puzzle),

      puzzleHash:
        session.puzzle_hash,

      completionToken:
        session.completion_token,

      startedAt:
        session.started_at,

      expiresAt:
        session.expires_at,

      matchedPairs:
        session.matched_pairs,

      matchedIndexes:
        session.matched_indexes
    }
  };
}

/* =========================================================
   EXPORTS
========================================================= */

export {
  getDifficultyConfig,
  normalizeDifficulty,
  calculateLives,
  getNextLifeAt,
  sanitizePuzzle,
  verifyPuzzleSolution
};

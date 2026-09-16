// services/game.js

import crypto from "crypto";
import pool from "../db/pool.js";

/* =========================================================
   GAME CONFIGURATION
========================================================= */

const MAX_LEVELS = 100;

const GAME_CONFIG = {
  easy: {
    rows: 4,
    cols: 4,
    pairs: 8,
    reward: 10,
    maxLevels: MAX_LEVELS,
  },

  hard: {
    rows: 4,
    cols: 6,
    pairs: 12,
    reward: 12,
    maxLevels: MAX_LEVELS,
  },

  difficult: {
    rows: 6,
    cols: 6,
    pairs: 18,
    reward: 15,
    maxLevels: MAX_LEVELS,
  },
};

/* =========================================================
   LIVES
========================================================= */

const MAX_LIVES = 5;

const LIFE_COOLDOWN_MINUTES = 60;

const LIFE_COOLDOWN_SECONDS =
  LIFE_COOLDOWN_MINUTES * 60;

const LIFE_COOLDOWN_MS =
  LIFE_COOLDOWN_SECONDS * 1000;

/* =========================================================
   CARD SYMBOLS
   18 symbols = enough for Difficult 6 x 6
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
   HELPERS
========================================================= */

function isValidDifficulty(difficulty) {
  return (
    typeof difficulty === "string" &&
    Object.prototype.hasOwnProperty.call(
      GAME_CONFIG,
      difficulty
    )
  );
}

function getConfig(difficulty) {
  if (!isValidDifficulty(difficulty)) {
    const error = new Error(
      "Invalid game difficulty."
    );

    error.code = "INVALID_GAME_DIFFICULTY";

    throw error;
  }

  return GAME_CONFIG[difficulty];
}

function createToken() {
  return crypto
    .randomBytes(32)
    .toString("hex");
}

function secureShuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const randomIndex = crypto.randomInt(
      0,
      i + 1
    );

    const temp = result[i];

    result[i] = result[randomIndex];

    result[randomIndex] = temp;
  }

  return result;
}

/* =========================================================
   PUZZLE
========================================================= */

function generatePuzzle(pairCount) {
  if (
    !Number.isInteger(pairCount) ||
    pairCount < 1 ||
    pairCount > CARD_SYMBOLS.length
  ) {
    const error = new Error(
      "Invalid pair count."
    );

    error.code = "INVALID_PAIR_COUNT";

    throw error;
  }

  const selectedSymbols =
    CARD_SYMBOLS.slice(0, pairCount);

  const cards = [];

  for (const symbol of selectedSymbols) {
    cards.push(symbol);
    cards.push(symbol);
  }

  return secureShuffle(cards);
}

function hashPuzzle(cards) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(cards))
    .digest("hex");
}

function createPuzzleData(difficulty) {
  const config = getConfig(difficulty);

  const cards = generatePuzzle(
    config.pairs
  );

  return {
    cards,
    puzzleHash: hashPuzzle(cards),
    rows: config.rows,
    cols: config.cols,
    pairs: config.pairs,
  };
}

/* =========================================================
   VERIFY PUZZLE
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

  if (
    cards.length === 0 ||
    cards.length % 2 !== 0
  ) {
    return false;
  }

  const expectedPairs =
    cards.length / 2;

  if (
    matchedPairs !== expectedPairs
  ) {
    return false;
  }

  if (
    matchedIndexes.length !==
    cards.length
  ) {
    return false;
  }

  const uniqueIndexes =
    new Set(matchedIndexes);

  if (
    uniqueIndexes.size !==
    cards.length
  ) {
    return false;
  }

  for (let i = 0; i < cards.length; i++) {
    if (!uniqueIndexes.has(i)) {
      return false;
    }
  }

  for (
    let i = 0;
    i < matchedIndexes.length;
    i += 2
  ) {
    const firstIndex =
      matchedIndexes[i];

    const secondIndex =
      matchedIndexes[i + 1];

    if (
      cards[firstIndex] !==
      cards[secondIndex]
    ) {
      return false;
    }
  }

  return true;
}

/* =========================================================
   LIFE RECOVERY
========================================================= */

function calculateRecoveredLives(
  lives,
  lastLifeAt
) {
  let currentLives = Number(
    lives ?? 0
  );

  if (!Number.isFinite(currentLives)) {
    currentLives = 0;
  }

  currentLives = Math.max(
    0,
    Math.min(MAX_LIVES, currentLives)
  );

  if (currentLives >= MAX_LIVES) {
    return {
      lives: MAX_LIVES,
      recovered: 0,
      nextLifeAt: null,
      newLastLifeAt: null,
    };
  }

  if (!lastLifeAt) {
    return {
      lives: currentLives,
      recovered: 0,
      nextLifeAt: null,
      newLastLifeAt: null,
    };
  }

  const lastTime =
    new Date(lastLifeAt).getTime();

  if (!Number.isFinite(lastTime)) {
    return {
      lives: currentLives,
      recovered: 0,
      nextLifeAt: null,
      newLastLifeAt: null,
    };
  }

  const now = Date.now();

  const elapsedMs =
    Math.max(0, now - lastTime);

  const recovered = Math.min(
    MAX_LIVES - currentLives,
    Math.floor(
      elapsedMs /
        LIFE_COOLDOWN_MS
    )
  );

  const newLives =
    currentLives + recovered;

  if (newLives >= MAX_LIVES) {
    return {
      lives: MAX_LIVES,
      recovered,
      nextLifeAt: null,
      newLastLifeAt: null,
    };
  }

  const nextLifeAt =
    lastTime +
    LIFE_COOLDOWN_MS;

  return {
    lives: newLives,
    recovered,
    nextLifeAt:
      new Date(
        nextLifeAt
      ).toISOString(),
    newLastLifeAt:
      lastLifeAt,
  };
}

/* =========================================================
   REFRESH LIVES
========================================================= */

async function refreshUserLives(
  userId
) {
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
    const error = new Error(
      "User not found."
    );

    error.code = "USER_NOT_FOUND";

    throw error;
  }

  const user = result.rows[0];

  const recovery =
    calculateRecoveredLives(
      user.lives,
      user.last_life_at
    );

  if (
    recovery.recovered > 0
  ) {
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
        recovery.newLastLifeAt,
        userId,
      ]
    );
  }

  return {
    lives: recovery.lives,
    nextLifeAt:
      recovery.nextLifeAt,
  };
}

/* =========================================================
   USER PROGRESS
========================================================= */

async function getUserProgress(
  userId
) {
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
    const error = new Error(
      "User not found."
    );

    error.code = "USER_NOT_FOUND";

    throw error;
  }

  const user = result.rows[0];

  /*
    Existing database columns are preserved:

    easy      -> easy_*
    hard      -> medium_*
    difficult -> hard_*
  */

  return {
    easy: {
      level: Number(
        user.easy_level ?? 1
      ),
      games: Number(
        user.easy_games ?? 0
      ),
    },

    hard: {
      level: Number(
        user.medium_level ?? 1
      ),
      games: Number(
        user.medium_games ?? 0
      ),
    },

    difficult: {
      level: Number(
        user.hard_level ?? 1
      ),
      games: Number(
        user.hard_games ?? 0
      ),
    },
  };
}

/* =========================================================
   START GAME
========================================================= */

export async function startGame(
  userId,
  difficulty
) {
  const config =
    getConfig(difficulty);

  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    /* -----------------------------------------------------
       Get user
    ----------------------------------------------------- */

    const userResult =
      await client.query(
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
      const error = new Error(
        "User not found."
      );

      error.code = "USER_NOT_FOUND";

      throw error;
    }

    const user =
      userResult.rows[0];

    /* -----------------------------------------------------
       Recover lives
    ----------------------------------------------------- */

    const recovery =
      calculateRecoveredLives(
        user.lives,
        user.last_life_at
      );

    let lives =
      recovery.lives;

    let lastLifeAt =
      recovery.newLastLifeAt;

    if (
      recovery.recovered > 0
    ) {
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

    /* -----------------------------------------------------
       No lives
    ----------------------------------------------------- */

    if (lives <= 0) {
      const error = new Error(
        "No lives remaining."
      );

      error.code = "NO_LIVES";

      throw error;
    }

    /* -----------------------------------------------------
       Get current level
    ----------------------------------------------------- */

    let currentLevel;

    if (difficulty === "easy") {
      currentLevel = Number(
        user.easy_level ?? 1
      );
    } else if (
      difficulty === "hard"
    ) {
      /*
        Public Hard uses
        existing medium columns.
      */

      currentLevel = Number(
        user.medium_level ?? 1
      );
    } else {
      /*
        Public Difficult uses
        existing hard columns.
      */

      currentLevel = Number(
        user.hard_level ?? 1
      );
    }

    /* -----------------------------------------------------
       Check level
    ----------------------------------------------------- */

    if (
      currentLevel < 1 ||
      currentLevel > MAX_LEVELS
    ) {
      const error = new Error(
        "Maximum level reached."
      );

      error.code =
        "MAX_LEVEL_REACHED";

      throw error;
    }

    /* -----------------------------------------------------
       Prevent multiple active games
    ----------------------------------------------------- */

    const activeGame =
      await client.query(
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

    if (
      activeGame.rowCount > 0
    ) {
      const error = new Error(
        "Game already active."
      );

      error.code =
        "GAME_ALREADY_ACTIVE";

      throw error;
    }

    /* -----------------------------------------------------
       Create server-side puzzle
    ----------------------------------------------------- */

    const puzzle =
      createPuzzleData(
        difficulty
      );

    const gameId =
      crypto.randomUUID();

    const completionToken =
      createToken();

    const expiresAt =
      new Date(
        Date.now() +
          15 * 60 * 1000
      );

    /* -----------------------------------------------------
       Consume one life
    ----------------------------------------------------- */

    const newLives =
      lives - 1;

    /*
      If there is no active life timer,
      start one after using a life.

      This gives:
        5 -> 4
        1 hour -> 5
    */

    if (
      newLives < MAX_LIVES &&
      !lastLifeAt
    ) {
      lastLifeAt =
        new Date();
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

    /* -----------------------------------------------------
       Save game session
    ----------------------------------------------------- */

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
        JSON.stringify(
          puzzle.cards
        ),
        puzzle.puzzleHash,
        completionToken,
        expiresAt,
      ]
    );

    await client.query(
      "COMMIT"
    );

    /* -----------------------------------------------------
       Next life
    ----------------------------------------------------- */

    let nextLifeAt = null;

    if (
      lastLifeAt &&
      newLives < MAX_LIVES
    ) {
      nextLifeAt =
        new Date(
          new Date(
            lastLifeAt
          ).getTime() +
            LIFE_COOLDOWN_MS
        ).toISOString();
    }

    /* -----------------------------------------------------
       Return game
    ----------------------------------------------------- */

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

      maxLives: MAX_LIVES,

      lifeCooldownMinutes:
        LIFE_COOLDOWN_MINUTES,

      lifeCooldownSeconds:
        LIFE_COOLDOWN_SECONDS,

      nextLifeAt,

      completionToken,

      expiresAt:
        expiresAt.toISOString(),
    };
  } catch (error) {
    await client.query(
      "ROLLBACK"
    );

    throw error;
  } finally {
    client.release();
  }
}

/* =========================================================
   COMPLETE GAME
========================================================= */

export async function completeGame(
  userId,
  data
) {
  const {
    gameId,
    completionToken,
    difficulty,
    moves,
    duration,
    durationSeconds,
    matchedPairs,
    matchedIndexes,
  } = data || {};

  /*
    Support both:
      duration
      durationSeconds

    This prevents a frontend naming mismatch.
  */

  const finalDuration =
    Number.isInteger(duration)
      ? duration
      : Number(durationSeconds);

  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    /* -----------------------------------------------------
       Get and lock game
    ----------------------------------------------------- */

    const gameResult =
      await client.query(
        `
        SELECT
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
          expires_at,
          completed_at
        FROM game_sessions
        WHERE id = $1
        FOR UPDATE
        `,
        [gameId]
      );

    if (
      gameResult.rowCount === 0
    ) {
      const error = new Error(
        "Game not found."
      );

      error.code =
        "GAME_NOT_FOUND";

      throw error;
    }

    const game =
      gameResult.rows[0];

    /* -----------------------------------------------------
       Ownership
    ----------------------------------------------------- */

    if (
      String(game.user_id) !==
      String(userId)
    ) {
      const error = new Error(
        "Invalid game session."
      );

      error.code =
        "INVALID_GAME_SESSION";

      throw error;
    }

    /* -----------------------------------------------------
       Difficulty
    ----------------------------------------------------- */

    if (
      !isValidDifficulty(
        game.difficulty
      )
    ) {
      const error = new Error(
        "Invalid game difficulty."
      );

      error.code =
        "INVALID_GAME_DIFFICULTY";

      throw error;
    }

    if (
      game.difficulty !==
      difficulty
    ) {
      const error = new Error(
        "Invalid game difficulty."
      );

      error.code =
        "INVALID_GAME_DIFFICULTY";

      throw error;
    }

    const config =
      getConfig(difficulty);

    /* -----------------------------------------------------
       Completion token
    ----------------------------------------------------- */

    if (
      typeof completionToken !==
        "string" ||
      completionToken !==
        game.completion_token
    ) {
      const error = new Error(
        "Invalid completion token."
      );

      error.code =
        "INVALID_COMPLETION_TOKEN";

      throw error;
    }

    /* -----------------------------------------------------
       Already completed
    ----------------------------------------------------- */

    if (game.completed_at) {
      const error = new Error(
        "Game already completed."
      );

      error.code =
        "GAME_ALREADY_COMPLETED";

      throw error;
    }

    /* -----------------------------------------------------
       Expiration
    ----------------------------------------------------- */

    const expiresAt =
      new Date(
        game.expires_at
      ).getTime();

    if (
      !Number.isFinite(
        expiresAt
      ) ||
      Date.now() > expiresAt
    ) {
      const error = new Error(
        "Game has expired."
      );

      error.code =
        "GAME_EXPIRED";

      throw error;
    }

    /* -----------------------------------------------------
       Validate moves
    ----------------------------------------------------- */

    if (
      !Number.isInteger(moves) ||
      moves < 1 ||
      moves > 1000
    ) {
      const error = new Error(
        "Invalid moves."
      );

      error.code =
        "INVALID_MOVES";

      throw error;
    }

    /* -----------------------------------------------------
       Validate duration
    ----------------------------------------------------- */

    if (
      !Number.isInteger(
        finalDuration
      ) ||
      finalDuration < 1 ||
      finalDuration > 3600
    ) {
      const error = new Error(
        "Invalid game duration."
      );

      error.code =
        "INVALID_GAME_DURATION";

      throw error;
    }

    /* -----------------------------------------------------
       Read stored puzzle
    ----------------------------------------------------- */

    let cards;

    try {
      cards =
        typeof game.puzzle ===
        "string"
          ? JSON.parse(
              game.puzzle
            )
          : game.puzzle;
    } catch {
      const error = new Error(
        "Invalid stored puzzle."
      );

      error.code =
        "INVALID_PUZZLE";

      throw error;
    }

    if (
      !Array.isArray(cards)
    ) {
      const error = new Error(
        "Invalid stored puzzle."
      );

      error.code =
        "INVALID_PUZZLE";

      throw error;
    }

    /* -----------------------------------------------------
       Verify puzzle hash
    ----------------------------------------------------- */

    const calculatedHash =
      hashPuzzle(cards);

    if (
      calculatedHash !==
      game.puzzle_hash
    ) {
      const error = new Error(
        "Puzzle integrity check failed."
      );

      error.code =
        "INVALID_PUZZLE";

      throw error;
    }

    /* -----------------------------------------------------
       Verify board configuration
    ----------------------------------------------------- */

    if (
      Number(game.rows) !==
        config.rows ||
      Number(game.cols) !==
        config.cols ||
      Number(game.pairs) !==
        config.pairs ||
      cards.length !==
        config.rows *
          config.cols
    ) {
      const error = new Error(
        "Game configuration mismatch."
      );

      error.code =
        "INVALID_GAME_SESSION";

      throw error;
    }

    /* -----------------------------------------------------
       Verify matched pairs
    ----------------------------------------------------- */

    if (
      !Number.isInteger(
        matchedPairs
      ) ||
      matchedPairs !==
        config.pairs
    ) {
      const error = new Error(
        "Invalid matched pairs."
      );

      error.code =
        "INVALID_MATCHED_PAIRS";

      throw error;
    }

    /* -----------------------------------------------------
       Verify indexes
    ----------------------------------------------------- */

    if (
      !Array.isArray(
        matchedIndexes
      )
    ) {
      const error = new Error(
        "Invalid matched indexes."
      );

      error.code =
        "INVALID_MATCHED_INDEXES";

      throw error;
    }

    if (
      matchedIndexes.length !==
      cards.length
    ) {
      const error = new Error(
        "Invalid matched indexes."
      );

      error.code =
        "INVALID_MATCHED_INDEXES";

      throw error;
    }

    for (
      const index of matchedIndexes
    ) {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= cards.length
      ) {
        const error = new Error(
          "Invalid card index."
        );

        error.code =
          "INVALID_MATCHED_INDEX";

        throw error;
      }
    }

    /* -----------------------------------------------------
       Verify actual solution
    ----------------------------------------------------- */

    const solved =
      verifyPuzzleSolution({
        cards,
        matchedIndexes,
        matchedPairs,
      });

    if (!solved) {
      const error = new Error(
        "Puzzle not completed."
      );

      error.code =
        "PUZZLE_NOT_COMPLETED";

      throw error;
    }

    /* -----------------------------------------------------
       Verify server duration
    ----------------------------------------------------- */

    const startedAt =
      new Date(
        game.started_at
      ).getTime();

    if (
      !Number.isFinite(
        startedAt
      )
    ) {
      const error = new Error(
        "Invalid game start time."
      );

      error.code =
        "INVALID_GAME_START_TIME";

      throw error;
    }

    const serverDuration =
      Math.floor(
        (Date.now() -
          startedAt) /
          1000
      );

    /*
      Allow 15 seconds of network/
      clock tolerance.
    */

    if (
      finalDuration <
      Math.max(
        1,
        serverDuration - 15
      )
    ) {
      const error = new Error(
        "Invalid game duration."
      );

      error.code =
        "INVALID_GAME_DURATION";

      throw error;
    }

    /* -----------------------------------------------------
       Verify level
    ----------------------------------------------------- */

    const level =
      Number(game.level);

    if (
      !Number.isInteger(level) ||
      level < 1 ||
      level > MAX_LEVELS
    ) {
      const error = new Error(
        "Invalid game level."
      );

      error.code =
        "INVALID_GAME_LEVEL";

      throw error;
    }

    /* -----------------------------------------------------
       Get user and lock row
    ----------------------------------------------------- */

    const userResult =
      await client.query(
        `
        SELECT
          id,
          coins,
          lives,

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

    if (
      userResult.rowCount ===
      0
    ) {
      const error = new Error(
        "User not found."
      );

      error.code =
        "USER_NOT_FOUND";

      throw error;
    }

    const user =
      userResult.rows[0];

    /* -----------------------------------------------------
       Get current unlocked level
    ----------------------------------------------------- */

    let currentLevel;

    if (difficulty === "easy") {
      currentLevel = Number(
        user.easy_level ?? 1
      );
    } else if (
      difficulty === "hard"
    ) {
      currentLevel = Number(
        user.medium_level ?? 1
      );
    } else {
      currentLevel = Number(
        user.hard_level ?? 1
      );
    }

    if (
      level !== currentLevel
    ) {
      const error = new Error(
        "Level is not currently unlocked."
      );

      error.code =
        "LEVEL_NOT_UNLOCKED";

      throw error;
    }

    /* -----------------------------------------------------
       SERVER-SIDE REWARD
       
       Easy      +10
       Hard      +12
       Difficult +15
    ----------------------------------------------------- */

    const reward =
      config.reward;

    const currentCoins =
      Number(user.coins ?? 0);

    const newCoins =
      currentCoins + reward;

    /* -----------------------------------------------------
       Update progress
    ----------------------------------------------------- */

    let updatedUser;

    if (difficulty === "easy") {
      updatedUser =
        await client.query(
          `
          UPDATE users
          SET
            coins = $1,
            easy_games =
              easy_games + 1,
            easy_level =
              LEAST(
                easy_level + 1,
                $2
              )
          WHERE id = $3
          RETURNING
            coins,
            lives,
            easy_level,
            easy_games,
            medium_level,
            medium_games,
            hard_level,
            hard_games
          `,
          [
            newCoins,
            MAX_LEVELS + 1,
            userId,
          ]
        );
    } else if (
      difficulty === "hard"
    ) {
      updatedUser =
        await client.query(
          `
          UPDATE users
          SET
            coins = $1,
            medium_games =
              medium_games + 1,
            medium_level =
              LEAST(
                medium_level + 1,
                $2
              )
          WHERE id = $3
          RETURNING
            coins,
            lives,
            easy_level,
            easy_games,
            medium_level,
            medium_games,
            hard_level,
            hard_games
          `,
          [
            newCoins,
            MAX_LEVELS + 1,
            userId,
          ]
        );
    } else {
      updatedUser =
        await client.query(
          `
          UPDATE users
          SET
            coins = $1,
            hard_games =
              hard_games + 1,
            hard_level =
              LEAST(
                hard_level + 1,
                $2
              )
          WHERE id = $3
          RETURNING
            coins,
            lives,
            easy_level,
            easy_games,
            medium_level,
            medium_games,
            hard_level,
            hard_games
          `,
          [
            newCoins,
            MAX_LEVELS + 1,
            userId,
          ]
        );
    }

    if (
      updatedUser.rowCount ===
      0
    ) {
      const error = new Error(
        "Unable to update user."
      );

      error.code =
        "USER_UPDATE_FAILED";

      throw error;
    }

    /* -----------------------------------------------------
       Mark session completed
    ----------------------------------------------------- */

    await client.query(
      `
      UPDATE game_sessions
      SET
        completed_at = NOW(),
        moves = $1,
        duration_seconds = $2,
        matched_pairs = $3
      WHERE id = $4
      `,
      [
        moves,
        finalDuration,
        matchedPairs,
        gameId,
      ]
    );

    await client.query(
      "COMMIT"
    );

    const resultUser =
      updatedUser.rows[0];

    /* -----------------------------------------------------
       Next level
    ----------------------------------------------------- */

    let nextLevel;

    if (difficulty === "easy") {
      nextLevel = Number(
        resultUser.easy_level
      );
    } else if (
      difficulty === "hard"
    ) {
      nextLevel = Number(
        resultUser.medium_level
      );
    } else {
      nextLevel = Number(
        resultUser.hard_level
      );
    }

    const completedAllLevels =
      level >= MAX_LEVELS;

    return {
      success: true,

      gameId,

      difficulty,

      completedLevel: level,

      nextLevel:
        completedAllLevels
          ? null
          : nextLevel,

      completedAllLevels,

      reward,

      coins: Number(
        resultUser.coins
      ),

      lives: Number(
        resultUser.lives ?? 0
      ),

      /*
        Double Reward is handled
        separately by the AdsGram
        reward system.
      */

      doubleRewardAvailable:
        true,
    };
  } catch (error) {
    await client.query(
      "ROLLBACK"
    );

    throw error;
  } finally {
    client.release();
  }
}

/* =========================================================
   GAME STATUS
========================================================= */

export async function getGameStatus(
  userId
) {
  const result =
    await pool.query(
      `
      SELECT
        coins,
        lives,
        last_life_at,

        easy_level,
        easy_games,

        medium_level,
        medium_games,

        hard_level,
        hard_games
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

  if (result.rowCount === 0) {
    const error = new Error(
      "User not found."
    );

    error.code =
      "USER_NOT_FOUND";

    throw error;
  }

  const user =
    result.rows[0];

  /* -------------------------------------------------------
     Recover lives
  ------------------------------------------------------- */

  const recovery =
    calculateRecoveredLives(
      user.lives,
      user.last_life_at
    );

  if (
    recovery.recovered > 0
  ) {
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
        recovery.newLastLifeAt,
        userId,
      ]
    );
  }

  /* -------------------------------------------------------
     Public status
     
     IMPORTANT:
     There is no "medium" here.
  ------------------------------------------------------- */

  return {
    coins: Number(
      user.coins ?? 0
    ),

    lives: recovery.lives,

    maxLives: MAX_LIVES,

    nextLifeAt:
      recovery.nextLifeAt,

    lifeCooldownMinutes:
      LIFE_COOLDOWN_MINUTES,

    lifeCooldownSeconds:
      LIFE_COOLDOWN_SECONDS,

    games: {
      easy: {
        level: Number(
          user.easy_level ?? 1
        ),

        completed: Number(
          user.easy_games ?? 0
        ),

        maxLevels: 100,

        rows: 4,

        cols: 4,

        pairs: 8,

        reward: 10,
      },

      hard: {
        level: Number(
          user.medium_level ?? 1
        ),

        completed: Number(
          user.medium_games ?? 0
        ),

        maxLevels: 100,

        rows: 4,

        cols: 6,

        pairs: 12,

        reward: 12,
      },

      difficult: {
        level: Number(
          user.hard_level ?? 1
        ),

        completed: Number(
          user.hard_games ?? 0
        ),

        maxLevels: 100,

        rows: 6,

        cols: 6,

        pairs: 18,

        reward: 15,
      },
    },
  };
}

/* =========================================================
   EXPORTS
========================================================= */

export {
  GAME_CONFIG,
  MAX_LEVELS,
  MAX_LIVES,
  LIFE_COOLDOWN_MINUTES,
  LIFE_COOLDOWN_SECONDS,
  generatePuzzle,
  verifyPuzzleSolution,
  calculateRecoveredLives,
  refreshUserLives,
  getUserProgress,
};

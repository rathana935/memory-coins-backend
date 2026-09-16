// =========================================================
// COMPLETE GAME
// =========================================================

export async function completeGame(
  userId,
  {
    gameId,
    completionToken,
    difficulty,
    moves,
    duration,
    matchedPairs,
    matchedIndexes,
  }
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* -------------------------------------------------------
       Lock the game session
    ------------------------------------------------------- */

    const gameResult = await client.query(
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

    if (gameResult.rowCount === 0) {
      const error = new Error("Game not found.");
      error.code = "GAME_NOT_FOUND";
      throw error;
    }

    const game = gameResult.rows[0];

    /* -------------------------------------------------------
       Verify ownership
    ------------------------------------------------------- */

    if (String(game.user_id) !== String(userId)) {
      const error = new Error("Invalid game session.");
      error.code = "INVALID_GAME_SESSION";
      throw error;
    }

    /* -------------------------------------------------------
       Verify difficulty
    ------------------------------------------------------- */

    if (!isValidDifficulty(game.difficulty)) {
      const error = new Error("Invalid game difficulty.");
      error.code = "INVALID_GAME_DIFFICULTY";
      throw error;
    }

    if (game.difficulty !== difficulty) {
      const error = new Error("Invalid game difficulty.");
      error.code = "INVALID_GAME_DIFFICULTY";
      throw error;
    }

    const config = getConfig(difficulty);

    /* -------------------------------------------------------
       Verify completion token
    ------------------------------------------------------- */

    if (
      typeof completionToken !== "string" ||
      completionToken !== game.completion_token
    ) {
      const error = new Error(
        "Invalid completion token."
      );
      error.code = "INVALID_COMPLETION_TOKEN";
      throw error;
    }

    /* -------------------------------------------------------
       Prevent duplicate completion
    ------------------------------------------------------- */

    if (game.completed_at) {
      const error = new Error(
        "Game already completed."
      );
      error.code = "GAME_ALREADY_COMPLETED";
      throw error;
    }

    /* -------------------------------------------------------
       Check expiration
    ------------------------------------------------------- */

    const expiresAt =
      new Date(game.expires_at).getTime();

    if (
      !Number.isFinite(expiresAt) ||
      Date.now() > expiresAt
    ) {
      const error = new Error(
        "Game has expired."
      );
      error.code = "GAME_EXPIRED";
      throw error;
    }

    /* -------------------------------------------------------
       Verify stored puzzle
    ------------------------------------------------------- */

    let cards;

    try {
      cards =
        typeof game.puzzle === "string"
          ? JSON.parse(game.puzzle)
          : game.puzzle;
    } catch {
      const error = new Error(
        "Invalid stored puzzle."
      );
      error.code = "INVALID_PUZZLE";
      throw error;
    }

    if (!Array.isArray(cards)) {
      const error = new Error(
        "Invalid stored puzzle."
      );
      error.code = "INVALID_PUZZLE";
      throw error;
    }

    /* -------------------------------------------------------
       Verify puzzle hash
    ------------------------------------------------------- */

    const calculatedHash = hashPuzzle(cards);

    if (
      calculatedHash !== game.puzzle_hash
    ) {
      const error = new Error(
        "Puzzle integrity check failed."
      );
      error.code = "INVALID_PUZZLE";
      throw error;
    }

    /* -------------------------------------------------------
       Verify board dimensions
    ------------------------------------------------------- */

    if (
      Number(game.rows) !== config.rows ||
      Number(game.cols) !== config.cols ||
      Number(game.pairs) !== config.pairs ||
      cards.length !== config.rows * config.cols
    ) {
      const error = new Error(
        "Game configuration does not match."
      );
      error.code = "INVALID_GAME_SESSION";
      throw error;
    }

    /* -------------------------------------------------------
       Verify matched pair count
    ------------------------------------------------------- */

    if (
      !Number.isInteger(matchedPairs) ||
      matchedPairs !== config.pairs
    ) {
      const error = new Error(
        "Invalid matched pairs."
      );
      error.code = "INVALID_MATCHED_PAIRS";
      throw error;
    }

    /* -------------------------------------------------------
       Verify puzzle solution
    ------------------------------------------------------- */

    const solved = verifyPuzzleSolution({
      cards,
      matchedIndexes,
      matchedPairs,
    });

    if (!solved) {
      const error = new Error(
        "Puzzle was not correctly solved."
      );
      error.code = "PUZZLE_NOT_COMPLETED";
      throw error;
    }

    /* -------------------------------------------------------
       Verify duration against server time
    ------------------------------------------------------- */

    const startedAt =
      new Date(game.started_at).getTime();

    if (!Number.isFinite(startedAt)) {
      const error = new Error(
        "Invalid game start time."
      );
      error.code = "INVALID_GAME_START_TIME";
      throw error;
    }

    const serverDurationSeconds = Math.floor(
      (Date.now() - startedAt) / 1000
    );

    /*
      Allow some clock/network tolerance.

      The client duration is never trusted for rewards.
    */

    const minimumDuration = Math.max(
      1,
      serverDurationSeconds - 15
    );

    if (duration < minimumDuration) {
      const error = new Error(
        "Invalid game duration."
      );
      error.code = "INVALID_GAME_DURATION";
      throw error;
    }

    /* -------------------------------------------------------
       Verify level
    ------------------------------------------------------- */

    const level = Number(game.level);

    if (
      !Number.isInteger(level) ||
      level < 1 ||
      level > config.maxGames
    ) {
      const error = new Error(
        "Invalid game level."
      );
      error.code = "INVALID_GAME_LEVEL";
      throw error;
    }

    /* -------------------------------------------------------
       Lock user
    ------------------------------------------------------- */

    const userResult = await client.query(
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

    if (userResult.rowCount === 0) {
      const error = new Error(
        "User not found."
      );
      error.code = "USER_NOT_FOUND";
      throw error;
    }

    const user = userResult.rows[0];

    /* -------------------------------------------------------
       Determine user's current level
    ------------------------------------------------------- */

    let currentLevel;
    let currentGames;

    if (difficulty === "easy") {
      currentLevel = Number(
        user.easy_level ?? 1
      );

      currentGames = Number(
        user.easy_games ?? 0
      );
    } else if (difficulty === "hard") {
      /*
        Public "hard" uses the existing medium DB columns.
      */

      currentLevel = Number(
        user.medium_level ?? 1
      );

      currentGames = Number(
        user.medium_games ?? 0
      );
    } else {
      /*
        Public "difficult" uses the existing hard DB columns.
      */

      currentLevel = Number(
        user.hard_level ?? 1
      );

      currentGames = Number(
        user.hard_games ?? 0
      );
    }

    /* -------------------------------------------------------
       Make sure this is the currently unlocked level
    ------------------------------------------------------- */

    if (level !== currentLevel) {
      const error = new Error(
        "Level is not currently unlocked."
      );
      error.code = "LEVEL_NOT_UNLOCKED";
      throw error;
    }

    /* -------------------------------------------------------
       Calculate server-side reward
       
       Easy      = +10
       Hard      = +12
       Difficult = +15
    ------------------------------------------------------- */

    const reward = config.reward;

    const currentCoins =
      Number(user.coins ?? 0);

    const newCoins =
      currentCoins + reward;

    /* -------------------------------------------------------
       Update difficulty progress
    ------------------------------------------------------- */

    let updateQuery;
    let updateParams;

    if (difficulty === "easy") {
      updateQuery = `
        UPDATE users
        SET
          coins = $1,
          easy_games = easy_games + 1,
          easy_level = LEAST(
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
      `;

      updateParams = [
        newCoins,
        config.maxGames + 1,
        userId,
      ];
    } else if (difficulty === "hard") {
      updateQuery = `
        UPDATE users
        SET
          coins = $1,
          medium_games = medium_games + 1,
          medium_level = LEAST(
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
      `;

      updateParams = [
        newCoins,
        config.maxGames + 1,
        userId,
      ];
    } else {
      updateQuery = `
        UPDATE users
        SET
          coins = $1,
          hard_games = hard_games + 1,
          hard_level = LEAST(
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
      `;

      updateParams = [
        newCoins,
        config.maxGames + 1,
        userId,
      ];
    }

    const updatedUser =
      await client.query(
        updateQuery,
        updateParams
      );

    if (updatedUser.rowCount === 0) {
      const error = new Error(
        "Unable to update user."
      );
      error.code = "USER_UPDATE_FAILED";
      throw error;
    }

    /* -------------------------------------------------------
       Mark game completed
    ------------------------------------------------------- */

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
        duration,
        matchedPairs,
        gameId,
      ]
    );

    await client.query("COMMIT");

    const resultUser =
      updatedUser.rows[0];

    /* -------------------------------------------------------
       Determine next level
    ------------------------------------------------------- */

    let nextLevel;

    if (difficulty === "easy") {
      nextLevel = Number(
        resultUser.easy_level
      );
    } else if (difficulty === "hard") {
      nextLevel = Number(
        resultUser.medium_level
      );
    } else {
      nextLevel = Number(
        resultUser.hard_level
      );
    }

    const completedAllLevels =
      level >= config.maxGames;

    /*
      The frontend can show "Next Level" when there
      is another level available.

      If level 100 is completed, there is no level 101.
    */

    return {
      success: true,

      gameId,

      difficulty,

      completedLevel: level,

      nextLevel: completedAllLevels
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
        Double Reward remains available for the
        separate AdsGram reward flow.
      */

      doubleRewardAvailable: true,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/* =========================================================
   GAME STATUS
========================================================= */

export async function getGameStatus(userId) {
  const userResult = await pool.query(
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

  if (userResult.rowCount === 0) {
    const error = new Error(
      "User not found."
    );
    error.code = "USER_NOT_FOUND";
    throw error;
  }

  const user = userResult.rows[0];

  /* -------------------------------------------------------
     Recover lives
  ------------------------------------------------------- */

  const recovery =
    calculateRecoveredLives(
      user.lives,
      user.last_life_at
    );

  if (recovery.recovered > 0) {
    let newLastLifeAt =
      user.last_life_at;

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

  /* -------------------------------------------------------
     Return public game status
     
     IMPORTANT:
     No "medium" is exposed to frontend.
  ------------------------------------------------------- */

  return {
    coins: Number(
      user.coins ?? 0
    ),

    lives: recovery.lives,

    nextLifeAt:
      recovery.nextLifeAt,

    maxLives: MAX_LIVES,

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
   EXPORT CONFIG
========================================================= */

export {
  GAME_CONFIG,
  MAX_LIVES,
  LIFE_COOLDOWN_SECONDS,
  generatePuzzle,
  verifyPuzzleSolution,
};

-- ============================================================
-- MEMORY COINS
-- GAME + LIFE SYSTEM MIGRATION
-- ============================================================

BEGIN;

-- ============================================================
-- 1. USERS
-- ============================================================

ALTER TABLE users
ADD COLUMN IF NOT EXISTS lives INTEGER NOT NULL DEFAULT 5;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS last_life_lost_at TIMESTAMPTZ;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS easy_games INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS medium_games INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS hard_games INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS easy_level INTEGER NOT NULL DEFAULT 1;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS medium_level INTEGER NOT NULL DEFAULT 1;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS hard_level INTEGER NOT NULL DEFAULT 1;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS games_played INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS today_coins NUMERIC(20,2) NOT NULL DEFAULT 0;

-- Make sure lives always stay between 0 and 5.
UPDATE users
SET lives = LEAST(GREATEST(lives, 0), 5);

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_lives_check;

ALTER TABLE users
ADD CONSTRAINT users_lives_check
CHECK (lives >= 0 AND lives <= 5);


-- ============================================================
-- 2. GAME SESSIONS
-- ============================================================

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS difficulty VARCHAR(20);

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS level INTEGER;

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS pairs INTEGER;

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS reward NUMERIC(20,2);

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS moves INTEGER;

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS completion_token TEXT;


-- ============================================================
-- 3. GAME RESULTS
-- ============================================================

ALTER TABLE game_results
ADD COLUMN IF NOT EXISTS user_id BIGINT;

ALTER TABLE game_results
ADD COLUMN IF NOT EXISTS game_session_id BIGINT;

ALTER TABLE game_results
ADD COLUMN IF NOT EXISTS difficulty VARCHAR(20);

ALTER TABLE game_results
ADD COLUMN IF NOT EXISTS level INTEGER;

ALTER TABLE game_results
ADD COLUMN IF NOT EXISTS moves INTEGER;

ALTER TABLE game_results
ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

ALTER TABLE game_results
ADD COLUMN IF NOT EXISTS coins_earned NUMERIC(20,2);

ALTER TABLE game_results
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();


-- ============================================================
-- 4. COIN TRANSACTIONS
-- ============================================================

ALTER TABLE coin_transactions
ADD COLUMN IF NOT EXISTS user_id BIGINT;

ALTER TABLE coin_transactions
ADD COLUMN IF NOT EXISTS amount NUMERIC(20,2);

ALTER TABLE coin_transactions
ADD COLUMN IF NOT EXISTS type VARCHAR(50);

ALTER TABLE coin_transactions
ADD COLUMN IF NOT EXISTS reference_id BIGINT;

ALTER TABLE coin_transactions
ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE coin_transactions
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();


-- ============================================================
-- 5. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS
idx_game_sessions_user_id
ON game_sessions(user_id);

CREATE INDEX IF NOT EXISTS
idx_game_sessions_status
ON game_sessions(status);

CREATE INDEX IF NOT EXISTS
idx_game_sessions_completion_token
ON game_sessions(completion_token);

CREATE INDEX IF NOT EXISTS
idx_game_results_user_id
ON game_results(user_id);

CREATE INDEX IF NOT EXISTS
idx_coin_transactions_user_id
ON coin_transactions(user_id);

CREATE INDEX IF NOT EXISTS
idx_users_lives
ON users(lives);


-- ============================================================
-- 6. DEFAULT GAME SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_settings
    (key, value)
VALUES
    ('exchange_rate', '10000'),
    ('minimum_withdrawal', '2500'),
    ('daily_bonus', '100'),
    ('easy_reward', '10'),
    ('medium_reward', '12'),
    ('hard_reward', '15'),
    ('life_max', '5'),
    ('life_recovery_minutes', '60')
ON CONFLICT (key)
DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = NOW();


-- ============================================================
-- 7. NORMALIZE EXISTING USERS
-- ============================================================

UPDATE users
SET
    lives = LEAST(GREATEST(COALESCE(lives, 5), 0), 5),
    games_played = COALESCE(games_played, 0),
    easy_games = COALESCE(easy_games, 0),
    medium_games = COALESCE(medium_games, 0),
    hard_games = COALESCE(hard_games, 0),
    easy_level = GREATEST(COALESCE(easy_level, 1), 1),
    medium_level = GREATEST(COALESCE(medium_level, 1), 1),
    hard_level = GREATEST(COALESCE(hard_level, 1), 1),
    today_coins = COALESCE(today_coins, 0);


COMMIT;

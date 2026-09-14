-- ============================================================
-- MEMORY COINS
-- PostgreSQL Production Schema
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE IF NOT EXISTS users (

id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

telegram_id BIGINT NOT NULL UNIQUE,

username VARCHAR(64),

first_name VARCHAR(255),

last_name VARCHAR(255),

photo_url TEXT,

language_code VARCHAR(20),

is_premium BOOLEAN NOT NULL
    DEFAULT FALSE,

coins BIGINT NOT NULL
    DEFAULT 0
    CHECK (coins >= 0),

today_coins BIGINT NOT NULL
    DEFAULT 0
    CHECK (today_coins >= 0),

games_played INTEGER NOT NULL
    DEFAULT 0
    CHECK (games_played >= 0),

easy_games INTEGER NOT NULL
    DEFAULT 0
    CHECK (easy_games >= 0),

medium_games INTEGER NOT NULL
    DEFAULT 0
    CHECK (medium_games >= 0),

hard_games INTEGER NOT NULL
    DEFAULT 0
    CHECK (hard_games >= 0),

easy_level INTEGER NOT NULL
    DEFAULT 1
    CHECK (easy_level BETWEEN 1 AND 100),

medium_level INTEGER NOT NULL
    DEFAULT 1
    CHECK (medium_level BETWEEN 1 AND 100),

hard_level INTEGER NOT NULL
    DEFAULT 1
    CHECK (hard_level BETWEEN 1 AND 100),

lives INTEGER NOT NULL
    DEFAULT 5
    CHECK (lives BETWEEN 0 AND 5),

last_life_at TIMESTAMPTZ,

daily_streak INTEGER NOT NULL
    DEFAULT 0
    CHECK (daily_streak >= 0),

last_daily_claim DATE,

is_blocked BOOLEAN NOT NULL
    DEFAULT FALSE,

created_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW(),

updated_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW(),

last_seen_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW()

);

CREATE INDEX IF NOT EXISTS idx_users_username
ON users(username);

CREATE INDEX IF NOT EXISTS idx_users_coins
ON users(coins DESC);

CREATE INDEX IF NOT EXISTS idx_users_last_seen
ON users(last_seen_at);

-- ============================================================
-- AUTH SESSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS auth_sessions (

id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

user_id UUID NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

token_hash CHAR(64) NOT NULL UNIQUE,

expires_at TIMESTAMPTZ NOT NULL,

created_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW(),

last_used_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW(),

user_agent TEXT,

ip_address INET

);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
ON auth_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
ON auth_sessions(expires_at);

-- ============================================================
-- GAME SESSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS game_sessions (

id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

user_id UUID NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

difficulty VARCHAR(20) NOT NULL
    CHECK (
        difficulty IN (
            'easy',
            'medium',
            'hard'
        )
    ),

level INTEGER NOT NULL
    CHECK (level BETWEEN 1 AND 100),

pairs INTEGER NOT NULL
    CHECK (pairs > 0),

reward_coins INTEGER NOT NULL
    CHECK (reward_coins >= 0),

status VARCHAR(20) NOT NULL
    DEFAULT 'started'
    CHECK (
        status IN (
            'started',
            'completed',
            'abandoned',
            'expired'
        )
    ),

started_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW(),

completed_at TIMESTAMPTZ,

moves INTEGER,

duration_seconds INTEGER,

completion_token UUID NOT NULL
    DEFAULT gen_random_uuid(),

created_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW()

);

CREATE INDEX IF NOT EXISTS idx_game_sessions_user
ON game_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_game_sessions_status
ON game_sessions(status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_completion_token
ON game_sessions(completion_token);

-- ============================================================
-- GAME RESULTS
-- ============================================================

CREATE TABLE IF NOT EXISTS game_results (

id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

user_id UUID NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

game_session_id UUID NOT NULL UNIQUE
    REFERENCES game_sessions(id)
    ON DELETE CASCADE,

difficulty VARCHAR(20) NOT NULL,

level INTEGER NOT NULL,

reward_coins INTEGER NOT NULL,

moves INTEGER NOT NULL,

duration_seconds INTEGER NOT NULL,

completed_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW()

);

CREATE INDEX IF NOT EXISTS idx_game_results_user
ON game_results(user_id);

CREATE INDEX IF NOT EXISTS idx_game_results_completed
ON game_results(completed_at);

-- ============================================================
-- DAILY BONUS
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_bonus_claims (

id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

user_id UUID NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

claim_date DATE NOT NULL,

day_number INTEGER NOT NULL
    CHECK (day_number BETWEEN 1 AND 7),

reward_coins INTEGER NOT NULL
    CHECK (reward_coins > 0),

created_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW(),

UNIQUE(
    user_id,
    claim_date
)

);

CREATE INDEX IF NOT EXISTS idx_daily_bonus_user
ON daily_bonus_claims(user_id);

-- ============================================================
-- LUCKY ROLLS
-- ============================================================

CREATE TABLE IF NOT EXISTS lucky_rolls (

id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

user_id UUID NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

roll_number INTEGER NOT NULL
    CHECK (
        roll_number BETWEEN 1 AND 99999
    ),

reward_coins INTEGER NOT NULL
    CHECK (reward_coins >= 0),

ad_required BOOLEAN NOT NULL
    DEFAULT TRUE,

ad_completed BOOLEAN NOT NULL
    DEFAULT FALSE,

rolled_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW()

);

CREATE INDEX IF NOT EXISTS idx_lucky_rolls_user
ON lucky_rolls(user_id);

CREATE INDEX IF NOT EXISTS idx_lucky_rolls_date
ON lucky_rolls(rolled_at);

-- ============================================================
-- ADSGRAM AD REWARDS
-- ============================================================

CREATE TABLE IF NOT EXISTS ad_rewards (

id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

user_id UUID NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

provider VARCHAR(50) NOT NULL,

ad_type VARCHAR(50) NOT NULL,

external_reward_id VARCHAR(255),

reward_coins NUMERIC(20,4) NOT NULL
    CHECK (reward_coins >= 0),

status VARCHAR(20) NOT NULL
    DEFAULT 'pending'
    CHECK (
        status IN (
            'pending',
            'confirmed',
            'rejected'
        )
    ),

created_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW(),

confirmed_at TIMESTAMPTZ,

UNIQUE(
    provider,
    external_reward_id
)

);

CREATE INDEX IF NOT EXISTS idx_ad_rewards_user
ON ad_rewards(user_id);

CREATE INDEX IF NOT EXISTS idx_ad_rewards_provider
ON ad_rewards(provider);

-- ============================================================
-- ACHIEVEMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS achievements (

id VARCHAR(50) PRIMARY KEY,

title VARCHAR(255) NOT NULL,

description TEXT NOT NULL,

icon VARCHAR(20),

requirement_type VARCHAR(50) NOT NULL,

requirement_value INTEGER NOT NULL,

reward_coins INTEGER NOT NULL
    DEFAULT 0

);

CREATE TABLE IF NOT EXISTS user_achievements (

user_id UUID NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

achievement_id VARCHAR(50) NOT NULL
    REFERENCES achievements(id)
    ON DELETE CASCADE,

progress INTEGER NOT NULL
    DEFAULT 0,

unlocked_at TIMESTAMPTZ,

PRIMARY KEY(
    user_id,
    achievement_id
)

);

-- ============================================================
-- COIN TRANSACTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS coin_transactions (

id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

user_id UUID NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

type VARCHAR(50) NOT NULL,

amount BIGINT NOT NULL,

balance_before BIGINT NOT NULL,

balance_after BIGINT NOT NULL,

reference_id UUID,

description TEXT,

created_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW()

);

CREATE INDEX IF NOT EXISTS idx_transactions_user
ON coin_transactions(user_id);

CREATE INDEX IF NOT EXISTS idx_transactions_created
ON coin_transactions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_type
ON coin_transactions(type);

-- ============================================================
-- WITHDRAWALS
-- ============================================================

CREATE TABLE IF NOT EXISTS withdrawals (

id UUID PRIMARY KEY
    DEFAULT gen_random_uuid(),

user_id UUID NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

provider VARCHAR(50) NOT NULL
    DEFAULT 'faucetpay',

amount_coins BIGINT NOT NULL
    CHECK (amount_coins >= 2500),

amount_usd NUMERIC(20,8) NOT NULL,

faucetpay_email TEXT NOT NULL,

status VARCHAR(30) NOT NULL
    DEFAULT 'pending'
    CHECK (
        status IN (
            'pending',
            'processing',
            'paid',
            'failed',
            'cancelled',
            'refunded'
        )
    ),

provider_transaction_id TEXT,

failure_reason TEXT,

requested_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW(),

processed_at TIMESTAMPTZ,

updated_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW()

);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user
ON withdrawals(user_id);

CREATE INDEX IF NOT EXISTS idx_withdrawals_status
ON withdrawals(status);

CREATE INDEX IF NOT EXISTS idx_withdrawals_created
ON withdrawals(requested_at DESC);

-- ============================================================
-- LEADERBOARD
-- ============================================================

CREATE TABLE IF NOT EXISTS leaderboard_scores (

user_id UUID NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

period_type VARCHAR(20) NOT NULL
    CHECK (
        period_type IN (
            'weekly',
            'all_time'
        )
    ),

period_start DATE,

coins BIGINT NOT NULL
    DEFAULT 0,

updated_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW(),

PRIMARY KEY(
    user_id,
    period_type,
    period_start
)

);

-- ============================================================
-- APP SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (

key VARCHAR(100) PRIMARY KEY,

value JSONB NOT NULL,

updated_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW()

);

-- ============================================================
-- DEFAULT ACHIEVEMENTS
-- ============================================================

INSERT INTO achievements
(
id,
title,
description,
icon,
requirement_type,
requirement_value,
reward_coins
)

VALUES

(
'first',
'First Game',
'Complete your first game.',
'🎮',
'games_played',
1,
0
),

(
'five',
'5 Games',
'Complete 5 games.',
'🔥',
'games_played',
5,
0
),

(
'fast',
'Memory Master',
'Complete a game under 30 seconds.',
'⚡',
'fast_game',
30,
0
),

(
'coins',
'Coin Collector',
'Collect 10,000 coins.',
'💰',
'coins',
10000,
0
)

ON CONFLICT (id)
DO NOTHING;

-- ============================================================
-- DEFAULT ECONOMY SETTINGS
-- ============================================================

INSERT INTO app_settings
(
key,
value
)

VALUES

(
'economy',

'{
    "coins_per_usd": 10000,
    "minimum_withdrawal": 2500,
    "daily_bonus": 100
}'::jsonb

),

-- ============================================================
-- GAME LEVEL SETTINGS
-- ============================================================

(
'levels',

'{
    "easy": {
        "pairs": 4,
        "cards": 8,
        "reward": 10,
        "max_levels": 100
    },

    "medium": {
        "pairs": 6,
        "cards": 12,
        "reward": 12,
        "max_levels": 100
    },

    "hard": {
        "pairs": 8,
        "cards": 16,
        "reward": 15,
        "max_levels": 100
    }
}'::jsonb

),

-- ============================================================
-- LUCKY ROLL SETTINGS
-- ============================================================

(
'lucky_roll',

'{
    "cooldown_seconds": 300,
    "minimum": 1,
    "maximum": 99999,

    "rewards": {
        "default": 5,
        "90000": 8,
        "95000": 12,
        "99500": 18,
        "99997": 82,
        "99999": 10000
    }
}'::jsonb

)

ON CONFLICT (key)
DO NOTHING;

-- ============================================================
-- UPDATED_AT FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()

RETURNS TRIGGER AS $$

BEGIN

NEW.updated_at = NOW();

RETURN NEW;

END;

$$ LANGUAGE plpgsql;

-- ============================================================
-- USERS UPDATED_AT TRIGGER
-- ============================================================

DROP TRIGGER IF EXISTS users_updated_at
ON users;

CREATE TRIGGER users_updated_at

BEFORE UPDATE ON users

FOR EACH ROW

EXECUTE FUNCTION
update_updated_at_column();

-- ============================================================
-- WITHDRAWALS UPDATED_AT TRIGGER
-- ============================================================

DROP TRIGGER IF EXISTS withdrawals_updated_at
ON withdrawals;

CREATE TRIGGER withdrawals_updated_at

BEFORE UPDATE ON withdrawals

FOR EACH ROW

EXECUTE FUNCTION
update_updated_at_column();

-- ============================================================
-- FINISH
-- ============================================================

COMMIT;

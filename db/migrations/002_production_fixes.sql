-- ============================================================
-- MEMORY CARD
-- Production Database Fixes
-- Migration: 002
--
-- SAFE MIGRATION
-- Does NOT delete users, coins, games, or withdrawals.
-- ============================================================

BEGIN;


/* ============================================================
   1. USERS
============================================================ */

ALTER TABLE users
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ
DEFAULT NOW();

ALTER TABLE users
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
DEFAULT NOW();

ALTER TABLE users
ADD COLUMN IF NOT EXISTS lives INTEGER
DEFAULT 5;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS last_life_at TIMESTAMPTZ;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS today_coins BIGINT
DEFAULT 0;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS daily_streak INTEGER
DEFAULT 0;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS last_daily_claim DATE;


/* ============================================================
   2. NORMALIZE NULL USER VALUES
============================================================ */

UPDATE users
SET lives = 5
WHERE lives IS NULL;

UPDATE users
SET today_coins = 0
WHERE today_coins IS NULL;

UPDATE users
SET daily_streak = 0
WHERE daily_streak IS NULL;

UPDATE users
SET updated_at = NOW()
WHERE updated_at IS NULL;

UPDATE users
SET last_seen_at = NOW()
WHERE last_seen_at IS NULL;


/* ============================================================
   3. USERS CHECK CONSTRAINT
============================================================ */

DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'users'::regclass
        AND conname = 'users_lives_check'
    ) THEN

        ALTER TABLE users
        ADD CONSTRAINT users_lives_check
        CHECK (lives BETWEEN 0 AND 5);

    END IF;

END
$$;


/* ============================================================
   4. ADSGRAM REWARD FIELDS
============================================================ */

ALTER TABLE ad_rewards
ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

ALTER TABLE ad_rewards
ADD COLUMN IF NOT EXISTS metadata JSONB
NOT NULL
DEFAULT '{}'::jsonb;


/* ============================================================
   5. ADSGRAM INDEXES
============================================================ */

CREATE INDEX IF NOT EXISTS idx_ad_rewards_pending
ON ad_rewards(
    user_id,
    ad_type,
    status,
    created_at
);

CREATE INDEX IF NOT EXISTS idx_ad_rewards_consumed
ON ad_rewards(
    user_id,
    ad_type,
    consumed_at
);


/* ============================================================
   6. GAME SESSION SAFETY
============================================================ */

DO $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE indexname = 'idx_game_completion_token'
    ) THEN

        CREATE UNIQUE INDEX idx_game_completion_token
        ON game_sessions(completion_token);

    END IF;

END
$$;


/* ============================================================
   7. WITHDRAWAL INDEXES
============================================================ */

CREATE INDEX IF NOT EXISTS idx_withdrawals_user
ON withdrawals(user_id);

CREATE INDEX IF NOT EXISTS idx_withdrawals_status
ON withdrawals(status);

CREATE INDEX IF NOT EXISTS idx_withdrawals_provider
ON withdrawals(provider);

CREATE INDEX IF NOT EXISTS idx_withdrawals_created
ON withdrawals(requested_at DESC);


/* ============================================================
   8. CHECK FOR DUPLICATE ACTIVE WITHDRAWALS
============================================================

   We do NOT automatically delete or cancel withdrawals.

   If duplicates exist, the migration stops safely and shows
   which user has multiple active withdrawals.

============================================================ */

DO $$
DECLARE
    duplicate_count INTEGER;
BEGIN

    SELECT COUNT(*)
    INTO duplicate_count
    FROM (
        SELECT user_id
        FROM withdrawals
        WHERE status IN ('pending', 'processing')
        GROUP BY user_id
        HAVING COUNT(*) > 1
    ) duplicates;

    IF duplicate_count > 0 THEN

        RAISE EXCEPTION
            'Migration 002 stopped: % user(s) have multiple pending/processing withdrawals. Review withdrawals before creating idx_one_active_withdrawal_per_user.',
            duplicate_count;

    END IF;

END
$$;


/* ============================================================
   9. PREVENT MULTIPLE ACTIVE WITHDRAWALS
============================================================ */

CREATE UNIQUE INDEX IF NOT EXISTS
idx_one_active_withdrawal_per_user
ON withdrawals(user_id)
WHERE status IN (
    'pending',
    'processing'
);


/* ============================================================
   10. COIN TRANSACTION INDEXES
============================================================ */

CREATE INDEX IF NOT EXISTS idx_transactions_user
ON coin_transactions(user_id);

CREATE INDEX IF NOT EXISTS idx_transactions_created
ON coin_transactions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_type
ON coin_transactions(type);


/* ============================================================
   11. REFERRAL INDEXES
============================================================ */

CREATE INDEX IF NOT EXISTS idx_referrals_referrer
ON referrals(referrer_user_id);

CREATE INDEX IF NOT EXISTS idx_referrals_referred
ON referrals(referred_user_id);


/* ============================================================
   12. AUTH SESSION INDEXES
============================================================ */

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
ON auth_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
ON auth_sessions(expires_at);


/* ============================================================
   13. LUCKY ROLL INDEXES
============================================================ */

CREATE INDEX IF NOT EXISTS idx_lucky_rolls_user
ON lucky_rolls(user_id);

CREATE INDEX IF NOT EXISTS idx_lucky_rolls_date
ON lucky_rolls(rolled_at DESC);

CREATE INDEX IF NOT EXISTS idx_lucky_rolls_user_date
ON lucky_rolls(
    user_id,
    rolled_at DESC
);


/* ============================================================
   14. UPDATED_AT FUNCTION
============================================================ */

CREATE OR REPLACE FUNCTION update_updated_at_column()

RETURNS TRIGGER AS $$

BEGIN

    NEW.updated_at = NOW();

    RETURN NEW;

END;

$$ LANGUAGE plpgsql;


/* ============================================================
   15. USERS UPDATED_AT TRIGGER
============================================================ */

DROP TRIGGER IF EXISTS users_updated_at
ON users;

CREATE TRIGGER users_updated_at

BEFORE UPDATE ON users

FOR EACH ROW

EXECUTE FUNCTION update_updated_at_column();


/* ============================================================
   16. WITHDRAWALS UPDATED_AT TRIGGER
============================================================ */

DROP TRIGGER IF EXISTS withdrawals_updated_at
ON withdrawals;

CREATE TRIGGER withdrawals_updated_at

BEFORE UPDATE ON withdrawals

FOR EACH ROW

EXECUTE FUNCTION update_updated_at_column();


/* ============================================================
   FINISH
============================================================ */

COMMIT;

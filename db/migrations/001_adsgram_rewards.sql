/* ========================================================= MEMORY COINS ADSGRAM REWARD MIGRATION Migration: 001 ========================================================= */

BEGIN;


/* ========================================================= SAFETY CHECK The ad_rewards table must already exist. ========================================================= */

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'ad_rewards'
    ) THEN
        RAISE EXCEPTION
            'Required table "ad_rewards" does not exist.';
    END IF;
END
$$;


/* ========================================================= CONSUMED TIMESTAMP Used to prevent a verified ad reward from being consumed more than once. ========================================================= */

ALTER TABLE ad_rewards
ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;


/* ========================================================= METADATA Stores additional provider/ad information. ========================================================= */

ALTER TABLE ad_rewards
ADD COLUMN IF NOT EXISTS metadata JSONB
NOT NULL
DEFAULT '{}'::jsonb;


/* ========================================================= INDEX FOR PENDING REWARDS Used when looking for unconfirmed AdsGram reward intents for a specific user/ad type. ========================================================= */

CREATE INDEX IF NOT EXISTS idx_ad_rewards_pending
ON ad_rewards (
    user_id,
    ad_type,
    status,
    created_at
);


/* ========================================================= INDEX FOR CONSUMED REWARDS Used when checking reward consumption history. ========================================================= */

CREATE INDEX IF NOT EXISTS idx_ad_rewards_consumed
ON ad_rewards (
    user_id,
    ad_type,
    consumed_at
);


COMMIT;

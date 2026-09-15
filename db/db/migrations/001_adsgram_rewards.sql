ALTER TABLE ad_rewards
ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

ALTER TABLE ad_rewards
ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ad_rewards_pending
ON ad_rewards(user_id, ad_type, status, created_at);

CREATE INDEX IF NOT EXISTS idx_ad_rewards_consumed
ON ad_rewards(user_id, ad_type, consumed_at);

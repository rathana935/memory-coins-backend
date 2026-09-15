BEGIN;

-- =========================================================
-- 1. ADD ABA WITHDRAWAL FIELDS
-- =========================================================

ALTER TABLE withdrawals
ADD COLUMN IF NOT EXISTS aba_account_name TEXT;

ALTER TABLE withdrawals
ADD COLUMN IF NOT EXISTS aba_account_number TEXT;


-- =========================================================
-- 2. MAKE FAUCETPAY EMAIL OPTIONAL
--
-- It must be optional because ABA withdrawals
-- do not use a FaucetPay email.
-- =========================================================

ALTER TABLE withdrawals
ALTER COLUMN faucetpay_email DROP NOT NULL;


-- =========================================================
-- 3. UPDATE WITHDRAWAL PROVIDER
-- =========================================================

ALTER TABLE withdrawals
DROP CONSTRAINT IF EXISTS withdrawals_provider_check;

ALTER TABLE withdrawals
ADD CONSTRAINT withdrawals_provider_check
CHECK (
    provider IN ('faucetpay', 'aba')
);


-- =========================================================
-- 4. PROVIDER-SPECIFIC VALIDATION
--
-- FaucetPay:
--   email required
--   ABA fields must be empty
--
-- ABA:
--   account name required
--   account number required
--   FaucetPay email must be empty
-- =========================================================

ALTER TABLE withdrawals
DROP CONSTRAINT IF EXISTS withdrawals_provider_details_check;

ALTER TABLE withdrawals
ADD CONSTRAINT withdrawals_provider_details_check
CHECK (
    (
        provider = 'faucetpay'
        AND faucetpay_email IS NOT NULL
        AND LENGTH(TRIM(faucetpay_email)) > 0
        AND aba_account_name IS NULL
        AND aba_account_number IS NULL
    )
    OR
    (
        provider = 'aba'
        AND aba_account_name IS NOT NULL
        AND LENGTH(TRIM(aba_account_name)) >= 2
        AND aba_account_number IS NOT NULL
        AND LENGTH(TRIM(aba_account_number)) >= 6
        AND faucetpay_email IS NULL
    )
);


-- =========================================================
-- 5. CREATE REFERRALS TABLE
-- =========================================================

CREATE TABLE IF NOT EXISTS referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    referrer_user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    referred_user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    reward_coins INTEGER NOT NULL DEFAULT 250
        CHECK (reward_coins > 0),

    status VARCHAR(20) NOT NULL DEFAULT 'completed'
        CHECK (
            status IN (
                'pending',
                'completed',
                'cancelled'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    completed_at TIMESTAMPTZ,

    CONSTRAINT referrals_not_self
        CHECK (
            referrer_user_id <> referred_user_id
        ),

    CONSTRAINT referrals_unique_referred
        UNIQUE (referred_user_id),

    CONSTRAINT referrals_unique_pair
        UNIQUE (
            referrer_user_id,
            referred_user_id
        )
);


-- =========================================================
-- 6. REFERRAL INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_referrals_referrer
ON referrals(referrer_user_id);

CREATE INDEX IF NOT EXISTS idx_referrals_referred
ON referrals(referred_user_id);

CREATE INDEX IF NOT EXISTS idx_referrals_status
ON referrals(status);


-- =========================================================
-- 7. ECONOMY SETTING
-- =========================================================

INSERT INTO app_settings (
    key,
    value
)
VALUES (
    'referral_reward_coins',
    '250'
)
ON CONFLICT (key)
DO UPDATE SET
    value = EXCLUDED.value;


-- =========================================================
-- 8. REFERRAL SYSTEM ENABLED
-- =========================================================

INSERT INTO app_settings (
    key,
    value
)
VALUES (
    'referral_enabled',
    'true'
)
ON CONFLICT (key)
DO UPDATE SET
    value = EXCLUDED.value;


COMMIT;

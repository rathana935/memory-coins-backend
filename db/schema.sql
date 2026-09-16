/* ============================================================
   WITHDRAWALS
============================================================ */

CREATE TABLE IF NOT EXISTS withdrawals (

    id UUID PRIMARY KEY
        DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    provider VARCHAR(50) NOT NULL
        DEFAULT 'faucetpay'
        CHECK (
            provider = 'faucetpay'
        ),

    amount_coins BIGINT NOT NULL
        CHECK (amount_coins >= 2500),

    amount_usd NUMERIC(20,8) NOT NULL
        CHECK (amount_usd > 0),

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
        DEFAULT NOW(),

    CHECK (
        LENGTH(TRIM(faucetpay_email)) > 0
    )

);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user
ON withdrawals(user_id);

CREATE INDEX IF NOT EXISTS idx_withdrawals_status
ON withdrawals(status);

CREATE INDEX IF NOT EXISTS idx_withdrawals_provider
ON withdrawals(provider);

CREATE INDEX IF NOT EXISTS idx_withdrawals_created
ON withdrawals(requested_at DESC);


/*
   Prevent more than one active withdrawal per user.
*/

CREATE UNIQUE INDEX IF NOT EXISTS
idx_one_active_withdrawal_per_user
ON withdrawals(user_id)
WHERE status IN (
    'pending',
    'processing'
);

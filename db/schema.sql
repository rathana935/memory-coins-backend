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
                'hard',
                'difficult'
            )
        ),

    level INTEGER NOT NULL
        CHECK (level BETWEEN 1 AND 100),

    rows INTEGER NOT NULL
        CHECK (rows > 0),

    cols INTEGER NOT NULL
        CHECK (cols > 0),

    pairs INTEGER NOT NULL
        CHECK (pairs > 0),

    reward INTEGER NOT NULL
        CHECK (reward >= 0),

    puzzle JSONB NOT NULL,

    puzzle_hash VARCHAR(128) NOT NULL,

    completion_token UUID NOT NULL
        DEFAULT gen_random_uuid(),

    started_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW(),

    expires_at TIMESTAMPTZ NOT NULL,

    completed_at TIMESTAMPTZ,

    moves INTEGER
        CHECK (
            moves IS NULL OR moves >= 0
        ),

    duration_seconds INTEGER
        CHECK (
            duration_seconds IS NULL
            OR duration_seconds >= 0
        ),

    matched_pairs INTEGER
        CHECK (
            matched_pairs IS NULL
            OR matched_pairs >= 0
        ),

    matched_indexes JSONB,

    created_at TIMESTAMPTZ NOT NULL
        DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_user
ON game_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_game_sessions_status
ON game_sessions(completed_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_completion_token
ON game_sessions(completion_token);

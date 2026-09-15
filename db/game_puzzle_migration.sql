BEGIN;

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS puzzle_deck JSONB;

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS puzzle_version INTEGER
NOT NULL
DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'game_sessions'::regclass
        AND conname = 'game_sessions_puzzle_version_check'
    ) THEN
        ALTER TABLE game_sessions
        ADD CONSTRAINT game_sessions_puzzle_version_check
        CHECK (puzzle_version >= 1);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS
idx_game_sessions_puzzle_version
ON game_sessions(puzzle_version);

DO $$
DECLARE
    current_type TEXT;
BEGIN
    SELECT data_type
    INTO current_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'game_sessions'
      AND column_name = 'completion_token';

    IF current_type = 'uuid' THEN
        ALTER TABLE game_sessions
        ALTER COLUMN completion_token TYPE VARCHAR(128)
        USING completion_token::text;
    END IF;
END
$$;

UPDATE game_sessions
SET completion_token =
    encode(
        gen_random_bytes(32),
        'hex'
    )
WHERE completion_token IS NULL;

ALTER TABLE game_sessions
ALTER COLUMN completion_token
SET DEFAULT encode(
    gen_random_bytes(32),
    'hex'
);

ALTER TABLE game_sessions
ALTER COLUMN completion_token
SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
idx_game_completion_token
ON game_sessions(completion_token);

COMMIT

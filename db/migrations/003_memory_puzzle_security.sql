BEGIN;

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS puzzle_deck JSONB;

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS puzzle_version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_game_sessions_puzzle
ON game_sessions (id, user_id, status);

COMMIT;

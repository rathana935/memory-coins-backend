BEGIN;

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS puzzle_deck JSONB;

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS puzzle_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE game_sessions
ADD CONSTRAINT game_sessions_puzzle_version_check
CHECK (puzzle_version >= 1);

CREATE INDEX IF NOT EXISTS idx_game_sessions_puzzle_version
ON game_sessions(puzzle_version);

COMMIT;

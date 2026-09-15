-- ============================================================
-- MEMORY CARD
-- Production Database Fixes
-- Migration: 003
--
-- Adds server-authoritative puzzle storage.
-- Safely handles existing game_sessions.
-- ============================================================

BEGIN;


/* ============================================================
   1. ADD SERVER PUZZLE STORAGE
============================================================ */

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS puzzle_deck JSONB;


/* ============================================================
   2. ADD PUZZLE VERSION
============================================================ */

ALTER TABLE game_sessions
ADD COLUMN IF NOT EXISTS puzzle_version INTEGER
NOT NULL
DEFAULT 1;


/* ============================================================
   3. PUZZLE VERSION VALIDATION
============================================================ */

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


/* ============================================================
   4. PUZZLE VERSION INDEX
============================================================ */

CREATE INDEX IF NOT EXISTS
idx_game_sessions_puzzle_version
ON game_sessions(puzzle_version);


/* ============================================================
   5. COMPLETION TOKEN
============================================================

   New game.js creates a 64-character hexadecimal token:

   crypto.randomBytes(32).toString("hex")

   Therefore completion_token must support strings,
   not only UUID values.

   We only change the column type if necessary.
============================================================ */

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


/* ============================================================
   6. ENSURE COMPLETION TOKEN IS NOT NULL
============================================================ */

UPDATE game_sessions
SET completion_token =
    encode(
        gen_random_bytes(32),
        'hex'
    )
WHERE completion_token IS NULL;


/* ============================================================
   7. COMPLETION TOKEN DEFAULT
============================================================ */

ALTER TABLE game_sessions
ALTER COLUMN completion_token
SET DEFAULT encode(
    gen_random_bytes(32),
    'hex'
);


/* ============================================================
   8. COMPLETION TOKEN NOT NULL
============================================================ */

ALTER TABLE game_sessions
ALTER COLUMN completion_token
SET NOT NULL;


/* ============================================================
   9. COMPLETION TOKEN UNIQUE INDEX
============================================================ */

CREATE UNIQUE INDEX IF NOT EXISTS
idx_game_completion_token
ON game_sessions(completion_token);


/* ============================================================
   FINISH
============================================================ */

COMMIT;

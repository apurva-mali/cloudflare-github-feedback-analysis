-- Triage, highlights, closing the loop, notes, themes and weekly digests.
-- Apply with:  npm run db:migrate
-- (wrangler records applied migrations, so each file runs exactly once.)

-- Triage and praise handling on each feedback item
ALTER TABLE feedback ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feedback ADD COLUMN reviewed_at TEXT;        -- NULL = still in the inbox
ALTER TABLE feedback ADD COLUMN dismissed_reason TEXT;   -- set when feedback_status = 'Dismissed'
ALTER TABLE feedback ADD COLUMN highlight_tags TEXT;     -- JSON array; non-empty = saved to Highlights
ALTER TABLE feedback ADD COLUMN responded_at TEXT;       -- someone replied to the author upstream
ALTER TABLE feedback ADD COLUMN theme_id INTEGER;
ALTER TABLE feedback ADD COLUMN theme_checked INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_feedback_theme ON feedback (theme_id);
CREATE INDEX IF NOT EXISTS idx_feedback_inbox ON feedback (reviewed_at, feedback_status);

-- Groups of similar feedback
CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  product TEXT,
  titled_at_count INTEGER NOT NULL DEFAULT 0,  -- member count when the title was last written
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A ticket can cover a whole theme
ALTER TABLE tickets ADD COLUMN theme_id INTEGER;

-- Internal notes on feedback
CREATE TABLE IF NOT EXISTS feedback_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id TEXT NOT NULL,
  body TEXT NOT NULL,
  author TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_feedback ON feedback_notes (feedback_id);

-- Weekly digests (one row per week; body is JSON)
CREATE TABLE IF NOT EXISTS digests (
  week_start TEXT PRIMARY KEY,   -- Monday, YYYY-MM-DD (UTC)
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

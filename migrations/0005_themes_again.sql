-- Bring back themes (groups of similar feedback). Existing items are grouped
-- in batches by the hourly sync.
-- Apply with:  npm run db:migrate

ALTER TABLE feedback ADD COLUMN theme_id INTEGER;
ALTER TABLE feedback ADD COLUMN theme_checked INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_feedback_theme ON feedback (theme_id);

CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  product TEXT,
  titled_at_count INTEGER NOT NULL DEFAULT 0,  -- member count when the title was last written
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

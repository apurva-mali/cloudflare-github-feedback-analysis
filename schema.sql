-- Full schema for a NEW database (drops everything).
-- Fresh install:   npx wrangler d1 execute feedback-github-db --remote --file=./schema.sql
-- Existing install: npm run db:migrate   (applies migrations/ in order, once each)
--
-- Keep this file equal to the result of applying every file in migrations/.

DROP TABLE IF EXISTS feedback;
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  feedback_timestamp TEXT,
  user_id TEXT,
  source TEXT,
  product_category TEXT,
  user_type TEXT,
  urgency_level TEXT,
  feedback_type TEXT,
  region TEXT,
  summary TEXT,
  recommended_action TEXT,
  feedback_status TEXT,          -- Open | Ticket Raised | Resolved | Dismissed
  original_text TEXT,
  sentiment_score INTEGER,
  nps_class TEXT,

  -- Provenance for real (non-synthetic) feedback
  external_id TEXT UNIQUE,       -- "gh:cloudflare/workers-sdk#1234" | "hn:41234567"; NULL for manual /ingest items
  source_url TEXT,               -- link back to the original post
  title TEXT,
  repo TEXT,                     -- e.g. "cloudflare/workers-sdk"
  labels TEXT,                   -- JSON array of label names
  source_state TEXT,             -- upstream state: open | closed
  reactions INTEGER DEFAULT 0,   -- GitHub reactions / HN points (rough "how many people care" signal)
  comments_count INTEGER DEFAULT 0,
  source_updated_at TEXT,
  ingested_at TEXT,

  -- Triage
  starred INTEGER NOT NULL DEFAULT 0,
  reviewed_at TEXT,              -- NULL = still in the inbox
  dismissed_reason TEXT,
  highlight_tags TEXT,           -- JSON array; non-empty = saved to Highlights
  responded_at TEXT,             -- someone replied to the author upstream
  theme_id INTEGER,
  theme_checked INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_feedback_timestamp ON feedback (feedback_timestamp);
CREATE INDEX idx_feedback_source ON feedback (source);
CREATE INDEX idx_feedback_theme ON feedback (theme_id);
CREATE INDEX idx_feedback_inbox ON feedback (reviewed_at, feedback_status);

-- Fetched items judged not to be product feedback, so they are never re-analyzed.
DROP TABLE IF EXISTS skipped_items;
CREATE TABLE skipped_items (
  external_id TEXT PRIMARY KEY,
  reason TEXT,
  skipped_at TEXT
);

-- Support tickets raised from feedback (shown as CV-<id>).
DROP TABLE IF EXISTS tickets;
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id TEXT NOT NULL UNIQUE,       -- one ticket per piece of feedback
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'P2',    -- P0 | P1 | P2 | P3
  team TEXT,
  assignee TEXT,
  status TEXT NOT NULL DEFAULT 'Open',    -- Open | In Progress | Resolved
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  theme_id INTEGER                        -- set when the ticket covers a whole theme
);
CREATE INDEX idx_tickets_status ON tickets (status);

-- Groups of similar feedback
DROP TABLE IF EXISTS themes;
CREATE TABLE themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  product TEXT,
  titled_at_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Internal notes on feedback
DROP TABLE IF EXISTS feedback_notes;
CREATE TABLE feedback_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id TEXT NOT NULL,
  body TEXT NOT NULL,
  author TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notes_feedback ON feedback_notes (feedback_id);

-- Weekly digests
DROP TABLE IF EXISTS digests;
CREATE TABLE digests (
  week_start TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- One row per ingestion stream, remembering how far we have read.
DROP TABLE IF EXISTS sync_state;
CREATE TABLE sync_state (
  stream TEXT PRIMARY KEY,       -- e.g. "github:cloudflare/workers-sdk"
  cursor TEXT,                   -- where the next run continues from
  last_run_at TEXT,
  last_result TEXT               -- JSON summary of the last run
);

-- Schema for the GitHub-backed feedback dashboard.
-- Apply with:  npx wrangler d1 execute feedback-github-db --remote --file=./schema.sql
-- WARNING: drops existing data. For an existing database, use migrations/ instead.

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
  feedback_status TEXT,          -- PM workflow status: Open | Ticket Raised | Resolved
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
  ingested_at TEXT
);

CREATE INDEX idx_feedback_timestamp ON feedback (feedback_timestamp);
CREATE INDEX idx_feedback_source ON feedback (source);

-- Fetched items judged not to be product feedback, so they are never re-analyzed.
DROP TABLE IF EXISTS skipped_items;
CREATE TABLE skipped_items (
  external_id TEXT PRIMARY KEY,
  reason TEXT,
  skipped_at TEXT
);

-- One row per ingestion stream, remembering how far we have read.
DROP TABLE IF EXISTS sync_state;
CREATE TABLE sync_state (
  stream TEXT PRIMARY KEY,       -- e.g. "github:cloudflare/workers-sdk"
  cursor TEXT,                   -- ISO timestamp of the last processed issue's updated_at
  last_run_at TEXT,
  last_result TEXT               -- JSON summary of the last run
);

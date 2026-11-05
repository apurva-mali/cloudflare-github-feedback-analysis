-- Adds support tickets raised from feedback.
-- Apply with:  npm run db:migrate:tickets:remote
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,   -- shown as CV-<id>
  feedback_id TEXT NOT NULL UNIQUE,       -- one ticket per piece of feedback
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'P2',    -- P0 | P1 | P2 | P3
  team TEXT,                              -- usually the product, e.g. "R2"
  assignee TEXT,
  status TEXT NOT NULL DEFAULT 'Open',    -- Open | In Progress | Resolved
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);

-- Upgrade an existing database (created from the first version of schema.sql).
-- Apply with:  npm run db:migrate:remote
-- Safe to run more than once.

-- Items fetched but judged not to be product feedback (e.g. HN comments that
-- only mention Cloudflare in passing), so they are never re-analyzed.
CREATE TABLE IF NOT EXISTS skipped_items (
  external_id TEXT PRIMARY KEY,
  reason TEXT,
  skipped_at TEXT
);

-- Re-bucket sentiment: 1-4 Detractor, 5-7 Passive, 8-10 Promoter.
UPDATE feedback SET nps_class = CASE
  WHEN sentiment_score >= 8 THEN 'Promoter'
  WHEN sentiment_score >= 5 THEN 'Passive'
  ELSE 'Detractor'
END;

-- Cloudflare-relevance check, per-product AI summaries, and removal of
-- themes and weekly digests.
-- Apply with:  npm run db:migrate

-- What each item's opinion is actually about, and whether it has been
-- checked for being about Cloudflare (existing rows get re-checked).
ALTER TABLE feedback ADD COLUMN subject TEXT;
ALTER TABLE feedback ADD COLUMN relevance_checked INTEGER NOT NULL DEFAULT 0;

-- Cached AI summary per product (last 30 days of feedback)
CREATE TABLE IF NOT EXISTS product_summaries (
  product TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  generated_at TEXT NOT NULL
);

-- Themes and digests were removed from the product
DROP INDEX IF EXISTS idx_feedback_theme;
ALTER TABLE feedback DROP COLUMN theme_id;
ALTER TABLE feedback DROP COLUMN theme_checked;
ALTER TABLE tickets DROP COLUMN theme_id;
DROP TABLE IF EXISTS themes;
DROP TABLE IF EXISTS digests;

# Cloudflare Voice: GitHub Feedback Edition

A copy of the [Cloudflare Voice feedback dashboard](https://github.com/apurva-mali/cloudflare-dashboard). This version runs on **real public feedback**: GitHub Issues from Cloudflare's open-source repos (by default [`cloudflare/workers-sdk`](https://github.com/cloudflare/workers-sdk)), instead of synthetic data.

The dashboard itself (Feedback Log, KPI Dashboard, Clustered Issues, semantic search) is unchanged. What's new is a scheduled ingestion layer in front of it, plus a few dashboard additions:

- links back to each GitHub issue
- the issue's labels, reactions, comments and open/closed state
- "Raise Ticket" and "Resolve" now save to D1 instead of resetting on reload

## Why GitHub Issues first

GitHub issues come with structure that free text from social sites doesn't have:

| GitHub signal | Dashboard field | How |
|---|---|---|
| `product:d1`, `r2`, `pages`, `package:wrangler`, … labels | **Product Category** | Deterministic label map; AI only fills gaps |
| `bug` / `regression` / `enhancement` / `documentation` / `question` | **Feedback Type** | Deterministic |
| `priority: p0`, `regression`, `breaking change`, ≥20 reactions | **Urgency** | Deterministic; AI otherwise |
| `author_association` | **User Type** (Community / Contributor) | Deterministic. Cloudflare staff issues are skipped as internal |
| Title and body | **Sentiment, NPS, Summary, Recommended Action** | Workers AI |
| `html_url`, `state`, `reactions`, `comments` | New provenance columns | Stored and refreshed on every sync |

Because so much comes straight from labels, the model has much less to guess. Categories stay consistent from run to run.

## Architecture

```mermaid
graph LR
    Cron["⏰ Cron Trigger<br/>(hourly)"] --> Sync["GitHub sync<br/>src/github.js"]
    Manual["POST /sync/github"] --> Sync
    Sync -->|"issues since cursor"| GH[("GitHub REST API")]
    Sync -->|"filter PRs / bots / staff<br/>map labels"| Pipe["Shared pipeline<br/>src/pipeline.js"]
    Ingest["POST /ingest<br/>(manual items)"] --> Pipe
    Pipe -->|"1 call per new issue"| LLM["Workers AI<br/>GLM 4.7 Flash"]
    Pipe -->|"1 batched call"| Emb["Workers AI<br/>BGE embeddings"]
    Pipe --> D1[("D1<br/>feedback + sync_state")]
    Pipe --> Vec[("Vectorize")]
    UI["React dashboard"] -->|"/all, /search, PATCH /feedback/:id"| D1
```

**How a sync run works (`src/github.js`):**

1. For each repo in `GITHUB_REPOS`, it reads issues updated since the saved cursor, oldest first. A first run looks back `GITHUB_BACKFILL_DAYS`.
2. Issues already stored only get their metadata refreshed (state, reactions, comments, labels). There is no second AI call for them.
3. New issues go through a filter that drops pull requests, bots, and staff (`OWNER`, `MEMBER`, `COLLABORATOR`). Their bodies are cleaned (template comments, code and log blocks, and images removed) and then analyzed.
4. Each run analyzes at most `GITHUB_MAX_NEW_PER_RUN` new issues. The cursor only moves past issues that were fully handled, so nothing is skipped when a run hits its cap. The next run continues where this one stopped.
5. `external_id` (e.g. `gh:cloudflare/workers-sdk#1234`) is `UNIQUE` in D1, so an issue can never be stored twice.

Embeddings, D1 writes and Vectorize writes are batched. Each run uses roughly one subrequest per new issue plus a handful of fixed ones, which fits within Workers' per-invocation limits.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/all` | none | All feedback rows (labels returned as an array) |
| GET | `/search?q=` | none | Semantic search via Vectorize |
| GET | `/sync/status` | none | Cursor and last run result per repo |
| POST | `/sync/github?max=N` | `ADMIN_TOKEN` | Run a sync now (optionally override the per-run cap) |
| POST | `/ingest` | `ADMIN_TOKEN` | Ingest one manual item (same body as the original project) |
| PATCH | `/feedback/:id` | none | `{"feedback_status": "Open" \| "Ticket Raised" \| "Resolved"}` |

`ADMIN_TOKEN` is sent as `Authorization: Bearer <token>`. If the secret isn't set (typical for local dev), these routes are open.

## Setup

Prerequisites: Node 20+, a Cloudflare account, and `npx wrangler login`.

```bash
npm install
npm --prefix frontend install

# 1. Create this project's own D1 database and Vectorize index
#    (separate from the original dashboard's, so that one keeps its data)
npx wrangler d1 create feedback-github-db
#    → paste the printed database_id into wrangler.jsonc
npx wrangler vectorize create feedback-github-index --dimensions=768 --metric=cosine
npm run db:init:remote          # applies schema.sql

# 2. Secrets
npx wrangler secret put GITHUB_TOKEN   # fine-grained PAT, "Public repositories (read-only)"
npx wrangler secret put ADMIN_TOKEN    # any long random string

# 3. Build the dashboard and deploy
npm run build
npm run deploy

# 4. Trigger a first sync instead of waiting for the hourly cron
curl -X POST "https://cloudflare-github-feedback.<your-subdomain>.workers.dev/sync/github?max=15" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Local development

```bash
cp .dev.vars.example .dev.vars     # add GITHUB_TOKEN (optional) there
npm run db:init                    # local D1
npm run dev                        # Worker on :8787 (Workers AI and Vectorize run remotely)
curl -X POST localhost:8787/sync/github?max=5
npm --prefix frontend run dev      # dashboard on :5173, proxied to :8787
```

To test the cron handler locally, run `npx wrangler dev --test-scheduled` and then `curl "localhost:8787/cdn-cgi/handler/scheduled?cron=17+*+*+*+*"`.

The original synthetic items can still be loaded alongside the real data: `npm run load-data` (they come in through `/ingest`, so set `ADMIN_TOKEN` in your shell if you've configured one).

### Tests

```bash
npm test
```

The tests run in Node against the real `schema.sql`. D1, Workers AI, Vectorize and the GitHub API are replaced with in-memory fakes, so no Cloudflare account or network access is needed. They cover:

- label mapping and issue filtering
- model-output parsing and the defaults used when the AI fails
- budgeted, resumable, duplicate-free syncing, including metadata refresh
- admin auth on write routes and persisted ticket status

## Configuration (`wrangler.jsonc` → `vars`)

| Var | Default | Notes |
|---|---|---|
| `GITHUB_REPOS` | `cloudflare/workers-sdk` | Comma-separated. Good additions: `cloudflare/workerd`, `cloudflare/cloudflare-docs`, `cloudflare/agents` |
| `GITHUB_BACKFILL_DAYS` | `14` | First run only |
| `GITHUB_MAX_NEW_PER_RUN` | `15` | Upper bound on LLM calls per run |
| `GITHUB_INCLUDE_STAFF` | `false` | Include issues opened by Cloudflare org members |
| `AI_MODEL` | `@cf/zai-org/glm-4.7-flash` | The original's `@cf/meta/llama-3-8b-instruct` was [deprecated on Workers AI on 2026-05-30](https://developers.cloudflare.com/changelog/post/2026-05-08-planned-model-deprecations/) |

Changes from the original project:

- Its own Worker name, D1 database and Vectorize index.
- Removed the Wrangler log files (they contained account details).
- Moved the PRD to `docs/` and the synthetic data loader to `scripts/`.
- The dashboard now calls its API on the same origin, instead of a hardcoded `localhost:8787`.

## Known limitations and next steps

- **Region** is always "Unknown", because GitHub doesn't expose author location.
- **Sentiment skews negative**, since issue trackers are mostly bug reports. Compare products against each other rather than reading the absolute NPS.
- **No dashboard auth.** Anyone with the URL can view the dashboard and change statuses. Put it behind Cloudflare Access before sharing it.
- **"Raise Ticket" only saves a status.** A natural next step is creating a real issue or Jira ticket and storing its link.
- **More sources.** `src/pipeline.js` doesn't depend on the source, so Stack Overflow, Hacker News or the Cloudflare Community forum would each be another fetcher module like `src/github.js`.

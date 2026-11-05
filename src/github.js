/**
 * GitHub Issues ingestion.
 *
 * Reads issues from public Cloudflare repos, keeps only community feedback
 * (no PRs, bots, or Cloudflare staff by default), derives as much as possible
 * from GitHub's own structure (labels, state, reactions), and hands the rest
 * to the shared AI pipeline.
 */

import { analyzeFeedback, buildRecord, storeRecords } from './pipeline.js';

const GITHUB_API = 'https://api.github.com';
const DEFAULT_REPOS = ['cloudflare/workers-sdk'];
const DEFAULT_MAX_NEW_PER_RUN = 15;
const DEFAULT_BACKFILL_DAYS = 14;
const MAX_PAGES_PER_REPO = 4;
const PER_PAGE = 50;

// Authors whose issues are internal, not customer feedback.
const STAFF_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

// ---------------------------------------------------------------------------
// Label → dashboard field mapping (labels as used in cloudflare/workers-sdk)
// ---------------------------------------------------------------------------

const PRODUCT_LABELS = {
	d1: 'D1',
	r2: 'R2',
	kv: 'KV',
	'workers kv': 'KV',
	pages: 'Pages',
	'pages-functions': 'Pages',
	'durable objects': 'Durable Objects',
	'durable-objects': 'Durable Objects',
	queues: 'Queues',
	vectorize: 'Vectorize',
	hyperdrive: 'Hyperdrive',
	containers: 'Containers',
	workflows: 'Workflows',
	'workers ai': 'Workers AI',
	'workers-ai': 'Workers AI',
	'ai gateway': 'AI Gateway',
	'ai-gateway': 'AI Gateway',
	'analytics engine': 'Analytics Engine',
	'analytics-engine': 'Analytics Engine',
	'workers for platforms': 'Workers for Platforms',
	'workers-for-platforms': 'Workers for Platforms',
	'secrets-store': 'Secrets Store',
	'secrets store': 'Secrets Store',
	agents: 'Agents',
	browser: 'Browser Rendering',
	email: 'Email Workers',
	pipelines: 'Pipelines',
	sandboxes: 'Sandboxes',
	access: 'Zero Trust',
	'workers-builds': 'Workers Builds',
	'workers + assets': 'Workers Assets',
	'workers-assets': 'Workers Assets',
	observability: 'Observability',
	// Tooling
	wrangler: 'Wrangler',
	miniflare: 'Wrangler',
	c3: 'Wrangler',
	'vite-plugin': 'Wrangler',
	vitest: 'Wrangler',
};

// Fallback product when no label says otherwise.
const REPO_DEFAULT_PRODUCT = {
	'cloudflare/workers-sdk': 'Wrangler',
	'cloudflare/workerd': 'Workers',
	'cloudflare/cloudflare-docs': 'Docs',
	'cloudflare/agents': 'Agents',
};

/** Normalise "product:d1" / "package:wrangler" / "feature:workers-builds" → lookup key. */
function labelKey(name) {
	return name.toLowerCase().replace(/^(product|package|feature):/, '').trim();
}

export function productFromLabels(labels, repo) {
	for (const name of labels) {
		const hit = PRODUCT_LABELS[labelKey(name)];
		// Prefer a real product over tooling: keep scanning if we only found Wrangler.
		if (hit && hit !== 'Wrangler') return hit;
	}
	if (labels.some((n) => PRODUCT_LABELS[labelKey(n)] === 'Wrangler')) return 'Wrangler';
	return null;
}

/** Product precedence: explicit label > AI's reading of the text > repo default. */
export function resolveProduct(item, aiProduct) {
	return (
		productFromLabels(item.labels, item.repo) ||
		(aiProduct && aiProduct !== 'Unknown' ? aiProduct : null) ||
		REPO_DEFAULT_PRODUCT[item.repo] ||
		'Unknown'
	);
}

export function feedbackTypeFromLabels(labels) {
	const set = new Set(labels.map((l) => l.toLowerCase()));
	if (set.has('bug') || set.has('regression')) return 'Bug';
	if (set.has('enhancement') || set.has('feature') || set.has('feature request')) return 'Feature Request';
	if (set.has('documentation') || set.has('docs')) return 'Docs';
	if (set.has('question')) return 'Question';
	return null; // let the AI decide
}

export function urgencyFromSignals(labels, reactions) {
	const set = new Set(labels.map((l) => l.toLowerCase()));
	if (set.has('priority: p0') || set.has('regression') || set.has('breaking change') || set.has('breaking-change')) return 'High';
	if (reactions >= 20) return 'High';
	if (set.has('priority: p2')) return 'Low';
	return null; // let the AI decide
}

/**
 * Strip noise from issue bodies before they reach the LLM / dashboard:
 * HTML comments (issue templates), fenced code and log blocks, image markup.
 */
export function cleanIssueBody(body) {
	if (!body) return '';
	return body
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/```[\s\S]*?```/g, '[code omitted]')
		.replace(/<details>[\s\S]*?<\/details>/gi, '[details omitted]')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Should this GitHub issue count as customer feedback? */
export function isCommunityIssue(issue, { includeStaff = false } = {}) {
	if (issue.pull_request) return false;
	if (issue.user?.type === 'Bot') return false;
	if (!includeStaff && STAFF_ASSOCIATIONS.has(issue.author_association)) return false;
	return true;
}

/** Map a GitHub issue to the pipeline's raw item shape. */
export function issueToItem(issue, repo) {
	const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean);
	const body = cleanIssueBody(issue.body);
	return {
		text: body ? `${issue.title}\n\n${body}` : issue.title,
		source: 'GitHub',
		user_id: issue.user?.login ? `@${issue.user.login}` : null,
		region: null, // GitHub does not expose location
		timestamp: issue.created_at,
		external_id: `gh:${repo}#${issue.number}`,
		source_url: issue.html_url,
		title: issue.title,
		repo,
		labels,
		source_state: issue.state,
		reactions: issue.reactions?.total_count ?? 0,
		comments_count: issue.comments ?? 0,
		source_updated_at: issue.updated_at,
		author_association: issue.author_association,
	};
}

/** Fields we can fill without the AI (null = let the AI decide). */
export function deterministicFields(item, ai = {}) {
	return {
		product_category: resolveProduct(item, ai.product_category),
		// Docs-repo issues are about documentation unless a label says bug/feature.
		feedback_type: feedbackTypeFromLabels(item.labels) || (item.repo === 'cloudflare/cloudflare-docs' ? 'Docs' : null),
		urgency_level: urgencyFromSignals(item.labels, item.reactions),
		user_type: item.author_association === 'CONTRIBUTOR' ? 'Contributor' : 'Community',
	};
}

// ---------------------------------------------------------------------------
// GitHub API
// ---------------------------------------------------------------------------

async function fetchIssuesPage(env, repo, since, page) {
	const params = new URLSearchParams({
		state: 'all',
		sort: 'updated',
		direction: 'asc',
		since,
		per_page: String(PER_PAGE),
		page: String(page),
	});
	const headers = {
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28',
		'User-Agent': 'cloudflare-feedback-dashboard',
	};
	if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

	const res = await fetch(`${GITHUB_API}/repos/${repo}/issues?${params}`, { headers });
	if (!res.ok) {
		const remaining = res.headers.get('x-ratelimit-remaining');
		throw new Error(`GitHub ${res.status} for ${repo}${remaining === '0' ? ' (rate limited — set GITHUB_TOKEN)' : ''}: ${(await res.text()).slice(0, 200)}`);
	}
	return res.json();
}

function parseRepos(env) {
	const raw = env.GITHUB_REPOS;
	const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : DEFAULT_REPOS;
	return list.map((r) => r.trim()).filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r));
}

async function getCursor(env, stream) {
	const row = await env.DB.prepare('SELECT cursor FROM sync_state WHERE stream = ?').bind(stream).first();
	return row?.cursor || null;
}

async function saveCursor(env, stream, cursor, result) {
	await env.DB.prepare(
		`INSERT INTO sync_state (stream, cursor, last_run_at, last_result) VALUES (?, ?, ?, ?)
		 ON CONFLICT(stream) DO UPDATE SET cursor = excluded.cursor, last_run_at = excluded.last_run_at, last_result = excluded.last_result`
	)
		.bind(stream, cursor, new Date().toISOString(), JSON.stringify(result))
		.run();
}

/**
 * Sync one repo: walk issues updated since the cursor (oldest first),
 * refresh metadata on issues we already have, and analyze up to `budget` new ones.
 * The cursor only advances past issues we fully handled, so nothing is skipped
 * when a run hits its budget.
 */
async function syncRepo(env, repo, budget, opts) {
	const stream = `github:${repo}`;
	const backfillDays = Number(env.GITHUB_BACKFILL_DAYS) || DEFAULT_BACKFILL_DAYS;
	// `since` stays fixed for every page of this run; `cursor` tracks progress.
	// A one-off deeper backfill (?since_days=N) restarts from N days ago; already-stored
	// issues are only refreshed, never re-analyzed or duplicated.
	const since = opts.sinceDays
		? new Date(Date.now() - opts.sinceDays * 86400000).toISOString()
		: (await getCursor(env, stream)) || new Date(Date.now() - backfillDays * 86400000).toISOString();
	let cursor = since;

	const result = { repo, seen: 0, skipped: 0, updated: 0, created: 0, ai_failures: 0, done: false };

	for (let page = 1; page <= MAX_PAGES_PER_REPO; page++) {
		const issues = await fetchIssuesPage(env, repo, since, page);
		if (!issues.length) {
			result.done = true;
			break;
		}

		// Which of these do we already store?
		const items = issues.map((issue) => ({ issue, item: issueToItem(issue, repo) }));
		const ids = items.map(({ item }) => item.external_id);
		const existing = await env.DB.prepare(
			`SELECT external_id FROM feedback WHERE external_id IN (${ids.map(() => '?').join(',')})`
		)
			.bind(...ids)
			.all();
		const known = new Set(existing.results.map((r) => r.external_id));

		const refreshStmts = [];
		const toAnalyze = [];
		let newCursor = cursor;
		let stoppedEarly = false;

		for (const { issue, item } of items) {
			result.seen++;
			if (known.has(item.external_id)) {
				refreshStmts.push(
					env.DB.prepare(
						`UPDATE feedback SET source_state = ?, reactions = ?, comments_count = ?, labels = ?, title = ?, source_updated_at = ?
						 WHERE external_id = ?`
					).bind(item.source_state, item.reactions, item.comments_count, JSON.stringify(item.labels), item.title, item.source_updated_at, item.external_id)
				);
				result.updated++;
			} else if (!isCommunityIssue(issue, opts)) {
				result.skipped++;
			} else if (toAnalyze.length < budget - result.created) {
				toAnalyze.push(item);
			} else {
				stoppedEarly = true;
				break;
			}
			newCursor = item.source_updated_at;
		}

		if (refreshStmts.length) await env.DB.batch(refreshStmts);

		// AI calls run one at a time to stay gentle on Workers AI rate limits.
		const records = [];
		for (const item of toAnalyze) {
			const context = `Source: GitHub issue in ${item.repo}. Labels: ${item.labels.join(', ') || 'none'}. Reactions: ${item.reactions}. State: ${item.source_state}.`;
			const ai = await analyzeFeedback(env, item.text, context);
			if (!ai._ai_ok) result.ai_failures++;
			records.push(buildRecord(item, ai, deterministicFields(item, ai)));
		}
		await storeRecords(env, records);
		result.created += records.length;

		cursor = newCursor;
		if (stoppedEarly || result.created >= budget) break;
		if (issues.length < PER_PAGE) {
			result.done = true;
			break;
		}
	}

	await saveCursor(env, stream, cursor, result);
	return { ...result, cursor };
}

/** Entry point for the cron trigger and POST /sync/github. */
export async function syncGitHub(env, { maxNew, sinceDays } = {}) {
	const repos = parseRepos(env);
	// Each repo gets its own budget so one busy repo can't starve the others.
	const perRepo = Number(maxNew) || Number(env.GITHUB_MAX_NEW_PER_REPO) || Number(env.GITHUB_MAX_NEW_PER_RUN) || DEFAULT_MAX_NEW_PER_RUN;
	const days = Math.min(Math.max(Number(sinceDays) || 0, 0), 365);
	const opts = { includeStaff: String(env.GITHUB_INCLUDE_STAFF) === 'true', sinceDays: days || null };
	const results = [];

	for (const repo of repos) {
		try {
			const r = await syncRepo(env, repo, perRepo, opts);
			results.push(r);
		} catch (err) {
			console.error(`GitHub sync failed for ${repo}:`, err?.message || err);
			results.push({ repo, error: err?.message || String(err) });
		}
	}
	return { ran_at: new Date().toISOString(), results };
}

/**
 * Hacker News ingestion via the free Algolia HN Search API (no key needed).
 *
 * Unlike GitHub Issues, HN is where developers say what they *like* as well as
 * what's broken ("moved to R2, egress bill went to zero"), so it balances the
 * dashboard. It is also noisier, so every candidate passes two filters:
 *   1. a cheap keyword check (must name a Cloudflare product, long enough to say something)
 *   2. the AI's `relevant` flag (opinion/experience about Cloudflare vs. passing mention)
 * Rejected items are remembered in `skipped_items` so they are never re-analyzed.
 */

import { analyzeFeedback, buildRecord, storeRecords } from './pipeline.js';

const HN_API = 'https://hn.algolia.com/api/v1/search_by_date';
const DEFAULT_QUERIES = [
	'Cloudflare Workers',
	'Cloudflare R2',
	'Cloudflare Pages',
	'Cloudflare D1',
	'Durable Objects',
	'Cloudflare Workers AI',
	'Cloudflare Zero Trust',
	'wrangler cloudflare',
];
const DEFAULT_MAX_NEW_PER_RUN = 15;
const DEFAULT_BACKFILL_DAYS = 7;
const HITS_PER_PAGE = 200;
const MAX_PAGES = 3;
const MIN_TEXT_LENGTH = 60;
const STREAM = 'hackernews';

// Keyword → product, used as a fallback when the AI answers "Unknown".
// Order matters: more specific products first.
const PRODUCT_KEYWORDS = [
	[/workers\s*ai\b/i, 'Workers AI'],
	[/durable\s*objects?/i, 'Durable Objects'],
	[/\bR2\b/, 'R2'],
	[/\bD1\b/, 'D1'],
	[/workers\s*kv|\bKV\b/, 'KV'],
	[/vectorize/i, 'Vectorize'],
	[/hyperdrive/i, 'Hyperdrive'],
	[/\bqueues\b/i, 'Queues'],
	[/zero\s*trust|cloudflare\s*access|cloudflared|cloudflare\s*tunnel|\bWARP\b/i, 'Zero Trust'],
	[/cloudflare\s*pages|\bpages\.dev\b/i, 'Pages'],
	[/wrangler/i, 'Wrangler'],
	[/workers?\b|workerd/i, 'Workers'],
];

const CLOUDFLARE_MENTION = /cloudflare|wrangler|workerd|durable\s*objects?|\bR2\b|\bD1\b|pages\.dev|workers\.dev/i;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
		if (code[0] === '#') {
			const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
			return Number.isFinite(n) ? String.fromCodePoint(n) : m;
		}
		return ENTITIES[code.toLowerCase()] ?? m;
	});
}

/** HN comment_text is HTML: <p> paragraphs, <a>, <i>, <pre><code>. */
export function cleanHnText(html) {
	if (!html) return '';
	const text = html
		.replace(/<pre>[\s\S]*?<\/pre>/gi, ' [code omitted] ')
		.replace(/<p>/gi, '\n\n')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '');
	return decodeEntities(text).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function productFromText(text) {
	for (const [re, product] of PRODUCT_KEYWORDS) if (re.test(text)) return product;
	return null;
}

/** Cheap pre-filter before spending an AI call. */
export function passesKeywordFilter(item) {
	return item.text.length >= MIN_TEXT_LENGTH && CLOUDFLARE_MENTION.test(item.text);
}

/** Map an Algolia hit (story or comment) to the pipeline's raw item shape. */
export function hitToItem(hit) {
	const isComment = (hit._tags || []).includes('comment') || hit.comment_text != null;
	const body = cleanHnText(isComment ? hit.comment_text : hit.story_text);
	const storyTitle = hit.story_title || hit.title || null;
	const text = isComment ? body : [hit.title, body].filter(Boolean).join('\n\n');
	return {
		text,
		source: 'Hacker News',
		user_id: hit.author ? `@${hit.author}` : null,
		region: null,
		timestamp: hit.created_at,
		created_at_i: hit.created_at_i,
		external_id: `hn:${hit.objectID}`,
		source_url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
		title: isComment ? (storyTitle ? `Re: ${storyTitle}` : null) : hit.title,
		repo: null,
		labels: [isComment ? 'comment' : 'story'],
		source_state: null,
		reactions: hit.points ?? 0,
		comments_count: hit.num_comments ?? 0,
		source_updated_at: hit.updated_at || hit.created_at,
	};
}

// ---------------------------------------------------------------------------
// Fetch + sync
// ---------------------------------------------------------------------------

/** All hits for `query` since `sinceEpoch` (newest first), paging until exhausted or MAX_PAGES. */
async function fetchHits(query, sinceEpoch) {
	const hits = [];
	for (let page = 0; page < MAX_PAGES; page++) {
		const params = new URLSearchParams({
			query,
			tags: '(story,comment)',
			numericFilters: `created_at_i>=${sinceEpoch}`,
			hitsPerPage: String(HITS_PER_PAGE),
			page: String(page),
		});
		const res = await fetch(`${HN_API}?${params}`, { headers: { 'User-Agent': 'cloudflare-feedback-dashboard' } });
		if (!res.ok) throw new Error(`HN search ${res.status} for "${query}": ${(await res.text()).slice(0, 200)}`);
		const data = await res.json();
		hits.push(...(data.hits || []));
		if (!data.nbPages || page + 1 >= data.nbPages) break;
	}
	return hits;
}

function parseQueries(env) {
	const raw = env.HN_QUERIES;
	const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : DEFAULT_QUERIES;
	return list.map((q) => q.trim()).filter(Boolean);
}

// D1 allows at most 100 bound parameters per query.
const D1_MAX_PARAMS = 100;

/** external_ids from `ids` that are already stored or already rejected. */
async function findKnown(env, ids) {
	const known = new Set();
	for (const table of ['feedback', 'skipped_items']) {
		for (let i = 0; i < ids.length; i += D1_MAX_PARAMS) {
			const chunk = ids.slice(i, i + D1_MAX_PARAMS);
			const { results } = await env.DB.prepare(
				`SELECT external_id FROM ${table} WHERE external_id IN (${chunk.map(() => '?').join(',')})`
			)
				.bind(...chunk)
				.all();
			for (const r of results) known.add(r.external_id);
		}
	}
	return known;
}

async function markSkipped(env, entries) {
	if (!entries.length) return;
	const now = new Date().toISOString();
	const stmt = env.DB.prepare('INSERT OR IGNORE INTO skipped_items (external_id, reason, skipped_at) VALUES (?, ?, ?)');
	await env.DB.batch(entries.map(([id, reason]) => stmt.bind(id, reason, now)));
}

/**
 * One run: gather recent hits for every query, dedupe, process oldest first
 * up to the AI budget. The cursor (a unix timestamp) only advances past items
 * that were fully handled, so a run that hits its budget resumes next time.
 */
export async function syncHackerNews(env, { maxNew } = {}) {
	const budget = Number(maxNew) || Number(env.HN_MAX_NEW_PER_RUN) || DEFAULT_MAX_NEW_PER_RUN;
	const backfillDays = Number(env.HN_BACKFILL_DAYS) || DEFAULT_BACKFILL_DAYS;

	const state = await env.DB.prepare('SELECT cursor FROM sync_state WHERE stream = ?').bind(STREAM).first();
	const since = state?.cursor ? Number(state.cursor) : Math.floor(Date.now() / 1000) - backfillDays * 86400;

	const result = { source: 'hackernews', fetched: 0, already_known: 0, filtered_keyword: 0, filtered_ai: 0, created: 0, ai_failures: 0, errors: [], done: false };

	// 1. Gather + dedupe across queries
	const pool = new Map();
	for (const query of parseQueries(env)) {
		try {
			for (const hit of await fetchHits(query, since)) {
				if (!hit.objectID || pool.has(hit.objectID)) continue;
				pool.set(hit.objectID, hitToItem(hit));
			}
		} catch (err) {
			console.error(err?.message || err);
			result.errors.push(err?.message || String(err));
		}
	}
	const items = [...pool.values()].sort((a, b) => a.created_at_i - b.created_at_i);
	result.fetched = items.length;

	// If every query failed, don't move the cursor.
	if (!items.length && result.errors.length) {
		return { ...result, cursor: since };
	}

	const known = items.length ? await findKnown(env, items.map((i) => i.external_id)) : new Set();

	// 2. Walk oldest → newest
	let cursor = since;
	const skipped = [];
	const records = [];
	let stoppedEarly = false;

	for (const item of items) {
		if (known.has(item.external_id)) {
			result.already_known++;
		} else if (!passesKeywordFilter(item)) {
			result.filtered_keyword++;
			skipped.push([item.external_id, 'keyword']);
		} else if (records.length + result.filtered_ai >= budget) {
			// Budget counts AI calls, including ones that end up irrelevant.
			stoppedEarly = true;
			break;
		} else {
			const context = `Source: Hacker News ${item.labels[0]}${item.title ? ` in the thread "${item.title.replace(/^Re: /, '')}"` : ''}. Points: ${item.reactions}.`;
			const ai = await analyzeFeedback(env, item.text, context);
			if (!ai._ai_ok) result.ai_failures++;
			if (!ai.relevant) {
				result.filtered_ai++;
				skipped.push([item.external_id, 'not_feedback']);
			} else {
				const product =
					ai.product_category && ai.product_category !== 'Unknown' ? ai.product_category : productFromText(item.text) || 'Unknown';
				records.push(buildRecord(item, ai, { product_category: product, user_type: 'Community' }));
			}
		}
		cursor = item.created_at_i;
	}
	if (!stoppedEarly) result.done = true;

	await markSkipped(env, skipped);
	await storeRecords(env, records);
	result.created = records.length;

	await env.DB.prepare(
		`INSERT INTO sync_state (stream, cursor, last_run_at, last_result) VALUES (?, ?, ?, ?)
		 ON CONFLICT(stream) DO UPDATE SET cursor = excluded.cursor, last_run_at = excluded.last_run_at, last_result = excluded.last_result`
	)
		.bind(STREAM, String(cursor), new Date().toISOString(), JSON.stringify(result))
		.run();

	return { ...result, cursor };
}

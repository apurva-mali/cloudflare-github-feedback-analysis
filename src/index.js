/**
 * Cloudflare Voice — GitHub feedback edition.
 *
 * Routes
 *   GET   /all                 all feedback rows (dashboard)
 *   GET   /search?q=           semantic search via Vectorize
 *   GET   /sync/status         last GitHub sync result per repo
 *   POST  /sync/github         run a GitHub sync now           (admin)
 *   POST  /ingest              ingest one manual feedback item (admin)
 *   PATCH /feedback/:id        set PM status: Open | Ticket Raised | Resolved
 *
 * Cron: the `scheduled` handler runs the GitHub sync (see triggers in wrangler.jsonc).
 */

import { CORS_HEADERS, json, isAuthorized } from './http.js';
import { analyzeFeedback, buildRecord, storeRecords, EMBEDDING_MODEL } from './pipeline.js';
import { syncGitHub } from './github.js';

const PM_STATUSES = new Set(['Open', 'Ticket Raised', 'Resolved']);

function serializeRow(row) {
	let labels = [];
	try {
		labels = row.labels ? JSON.parse(row.labels) : [];
	} catch {
		/* ignore malformed */
	}
	return { ...row, labels };
}

async function handleIngest(request, env) {
	const body = await request.json().catch(() => null);
	if (!body || typeof body.text !== 'string' || !body.text.trim()) return json({ error: 'Missing or invalid "text" field' }, 400);
	if (typeof body.source !== 'string' || !body.source.trim()) return json({ error: 'Missing or invalid "source" field' }, 400);

	const item = {
		text: body.text,
		source: body.source,
		user_id: body.user_id,
		region: body.region,
		timestamp: body.timestamp,
	};
	const ai = await analyzeFeedback(env, item.text);
	const record = buildRecord(item, ai, { urgency_level: body.urgency_level });
	await storeRecords(env, [record]);

	const { sentiment_score, nps_class, urgency_level, product_category, feedback_type, user_type, summary, recommended_action } = record;
	return json(
		{
			id: record.id,
			message: 'Feedback ingested successfully',
			ai_analysis: { sentiment_score, nps_class, urgency_level, product_category, feedback_type, user_type, summary, recommended_action },
		},
		201
	);
}

async function handleAll(env) {
	const { results } = await env.DB.prepare('SELECT * FROM feedback ORDER BY feedback_timestamp DESC').all();
	return json({ results: results.map(serializeRow), total: results.length });
}

async function handleSearch(url, env) {
	const query = url.searchParams.get('q');
	if (!query) return json({ error: 'Missing or invalid "q" query parameter' }, 400);

	const emb = await env.AI.run(EMBEDDING_MODEL, { text: [query] });
	const vectorResults = await env.VECTOR_INDEX.query(emb.data[0], { topK: 5, returnMetadata: true });
	const ids = vectorResults.matches.map((m) => m.id);
	if (!ids.length) return json({ query, results: [] });

	const { results } = await env.DB.prepare(`SELECT * FROM feedback WHERE id IN (${ids.map(() => '?').join(',')})`)
		.bind(...ids)
		.all();
	const scored = results
		.map((row) => ({
			...serializeRow(row),
			text: row.original_text,
			created_at: row.feedback_timestamp,
			score: vectorResults.matches.find((m) => m.id === row.id)?.score ?? null,
		}))
		.sort((a, b) => (b.score || 0) - (a.score || 0));
	return json({ query, results: scored });
}

async function handleStatusUpdate(id, request, env) {
	const body = await request.json().catch(() => null);
	const status = body?.feedback_status;
	if (!PM_STATUSES.has(status)) return json({ error: `feedback_status must be one of: ${[...PM_STATUSES].join(', ')}` }, 400);

	const res = await env.DB.prepare('UPDATE feedback SET feedback_status = ? WHERE id = ?').bind(status, id).run();
	if (!res.meta?.changes) return json({ error: 'Feedback not found' }, 404);
	return json({ id, feedback_status: status });
}

async function handleSyncStatus(env) {
	const { results } = await env.DB.prepare('SELECT * FROM sync_state ORDER BY stream').all();
	return json({
		streams: results.map((r) => ({ ...r, last_result: r.last_result ? JSON.parse(r.last_result) : null })),
	});
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const { pathname: path } = url;
		const method = request.method;

		if (method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

		try {
			if (method === 'GET' && path === '/all') return await handleAll(env);
			if (method === 'GET' && path === '/search') return await handleSearch(url, env);
			if (method === 'GET' && path === '/sync/status') return await handleSyncStatus(env);

			const statusMatch = path.match(/^\/feedback\/([\w-]+)$/);
			if (method === 'PATCH' && statusMatch) return await handleStatusUpdate(statusMatch[1], request, env);

			if (method === 'POST' && (path === '/ingest' || path === '/sync/github')) {
				if (!isAuthorized(request, env)) return json({ error: 'Unauthorized' }, 401);
				if (path === '/ingest') return await handleIngest(request, env);
				return json(await syncGitHub(env, { maxNew: url.searchParams.get('max') }));
			}
		} catch (err) {
			console.error(`${method} ${path} failed:`, err);
			return json({ error: 'Request failed', details: err?.message || String(err) }, 500);
		}

		// SPA fallback: serve the React dashboard
		return env.ASSETS.fetch(request);
	},

	async scheduled(controller, env, ctx) {
		ctx.waitUntil(
			syncGitHub(env).then((summary) => console.log('GitHub sync:', JSON.stringify(summary)))
		);
	},
};

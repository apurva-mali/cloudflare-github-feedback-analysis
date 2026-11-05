/**
 * Cloudflare Voice — real feedback edition (GitHub Issues + Hacker News).
 *
 * Routes
 *   GET    /all                     all feedback rows (dashboard)
 *   GET    /search?q=               semantic search via Vectorize
 *   GET    /themes                  groups of similar feedback
 *   GET    /digests[?week=]         weekly digest + available weeks
 *   POST   /digests/generate        build this week's digest now (throttled)
 *   PATCH  /feedback/:id            status, dismiss, star, reviewed, highlight tags, replied
 *   POST   /feedback/bulk           same changes for many ids
 *   GET    /feedback/:id/notes      internal notes
 *   POST   /feedback/:id/notes      add a note
 *   DELETE /notes/:id               delete a note
 *   GET    /tickets                 all support tickets
 *   POST   /tickets                 raise a ticket (optionally for a whole theme)
 *   PATCH  /tickets/:id             update status / priority / assignee / team
 *   GET    /sync/status             last sync result per stream
 *   POST   /sync/:source            github | hackernews | themes | all          (admin)
 *                                   ?max=N  per-run cap, ?since_days=N  GitHub one-off backfill
 *   POST   /ingest                  ingest one manual feedback item             (admin)
 *
 * Cron: hourly → every source then themes; Mondays → last week's digest.
 */

import { CORS_HEADERS, json, isAuthorized } from './http.js';
import { analyzeFeedback, buildRecord, storeRecords, EMBEDDING_MODEL } from './pipeline.js';
import { syncGitHub } from './github.js';
import { syncHackerNews } from './hackernews.js';
import { syncThemes, listThemes } from './themes.js';
import { getDigests, handleGenerate, weeklyDigest } from './digest.js';
import { listTickets, createTicket, updateTicket } from './tickets.js';
import { updateFeedback, bulkUpdateFeedback, listNotes, addNote, deleteNote } from './feedback.js';

export const DIGEST_CRON = '7 13 * * 1';

// Order matters: themes runs last so it groups what the sources just added.
const SYNCS = {
	github: syncGitHub,
	hackernews: syncHackerNews,
	themes: syncThemes,
};

/** Run sources one after another; one failing never blocks the others. */
async function syncAll(env, opts = {}) {
	const out = {};
	for (const [name, run] of Object.entries(SYNCS)) {
		try {
			out[name] = await run(env, name === 'themes' ? {} : opts);
		} catch (err) {
			console.error(`${name} sync failed:`, err);
			out[name] = { error: err?.message || String(err) };
		}
	}
	return out;
}

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

const ALL_QUERIES = [
	// Current schema: ticket on the item itself or on its theme, plus note count.
	`SELECT f.*,
	        COALESCE(td.id, tt.id) AS ticket_id, COALESCE(td.status, tt.status) AS ticket_status,
	        COALESCE(td.priority, tt.priority) AS ticket_priority, (td.id IS NULL AND tt.id IS NOT NULL) AS ticket_via_theme,
	        (SELECT COUNT(*) FROM feedback_notes n WHERE n.feedback_id = f.id) AS notes_count
	 FROM feedback f
	 LEFT JOIN tickets td ON td.feedback_id = f.id
	 LEFT JOIN tickets tt ON f.theme_id IS NOT NULL AND tt.theme_id = f.theme_id AND tt.feedback_id != f.id
	 ORDER BY f.feedback_timestamp DESC`,
	// Before migration 0003.
	`SELECT f.*, t.id AS ticket_id, t.status AS ticket_status, t.priority AS ticket_priority
	 FROM feedback f LEFT JOIN tickets t ON t.feedback_id = f.id
	 ORDER BY f.feedback_timestamp DESC`,
	// Before migration 0002.
	'SELECT * FROM feedback ORDER BY feedback_timestamp DESC',
];

async function handleAll(env) {
	for (const sql of ALL_QUERIES) {
		try {
			const { results } = await env.DB.prepare(sql).all();
			return json({ results: results.map(serializeRow), total: results.length });
		} catch (err) {
			// Older database: fall back to the next query instead of failing.
			if (!/no such (table|column)/.test(String(err?.message))) throw err;
		}
	}
	return json({ results: [], total: 0 });
}

async function handleSearch(url, env) {
	const query = url.searchParams.get('q');
	if (!query) return json({ error: 'Missing or invalid "q" query parameter' }, 400);

	const topK = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 50);
	const emb = await env.AI.run(EMBEDDING_MODEL, { text: [query] });
	const vectorResults = await env.VECTOR_INDEX.query(emb.data[0], { topK, returnMetadata: true });
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

			if (method === 'POST' && path === '/feedback/bulk') return await bulkUpdateFeedback(request, env);
			const feedbackMatch = path.match(/^\/feedback\/([\w-]+)$/);
			if (method === 'PATCH' && feedbackMatch) return await updateFeedback(feedbackMatch[1], request, env);
			const notesMatch = path.match(/^\/feedback\/([\w-]+)\/notes$/);
			if (notesMatch && method === 'GET') return await listNotes(notesMatch[1], env);
			if (notesMatch && method === 'POST') return await addNote(notesMatch[1], request, env);
			const noteMatch = path.match(/^\/notes\/(\d+)$/);
			if (noteMatch && method === 'DELETE') return await deleteNote(Number(noteMatch[1]), env);

			if (method === 'GET' && path === '/themes') return await listThemes(env);
			if (method === 'GET' && path === '/digests') return await getDigests(url, env);
			if (method === 'POST' && path === '/digests/generate') return await handleGenerate(request, env);

			if (path === '/tickets' && method === 'GET') return await listTickets(env);
			if (path === '/tickets' && method === 'POST') return await createTicket(request, env);
			const ticketMatch = path.match(/^\/tickets\/(\d+)$/);
			if (method === 'PATCH' && ticketMatch) return await updateTicket(Number(ticketMatch[1]), request, env);

			const syncMatch = path.match(/^\/sync\/(\w+)$/);
			if (method === 'POST' && (path === '/ingest' || syncMatch)) {
				if (!isAuthorized(request, env)) return json({ error: 'Unauthorized' }, 401);
				if (path === '/ingest') return await handleIngest(request, env);
				const opts = { maxNew: url.searchParams.get('max'), sinceDays: url.searchParams.get('since_days') };
				if (syncMatch[1] === 'all') return json(await syncAll(env, opts));
				const run = SYNCS[syncMatch[1]];
				if (!run) return json({ error: `Unknown source. Use one of: ${[...Object.keys(SYNCS), 'all'].join(', ')}` }, 404);
				return json(await run(env, opts));
			}
		} catch (err) {
			console.error(`${method} ${path} failed:`, err);
			return json({ error: 'Request failed', details: err?.message || String(err) }, 500);
		}

		// SPA fallback: serve the React dashboard
		return env.ASSETS.fetch(request);
	},

	async scheduled(controller, env, ctx) {
		if (controller.cron === DIGEST_CRON) {
			ctx.waitUntil(weeklyDigest(env).then((d) => console.log('Weekly digest written for', d.week_start)));
			return;
		}
		ctx.waitUntil(syncAll(env).then((summary) => console.log('Scheduled sync:', JSON.stringify(summary))));
	},
};

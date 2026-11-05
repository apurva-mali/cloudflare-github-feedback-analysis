/**
 * Weekly digest per product.
 *
 * A digest covers Monday 00:00 UTC to the following Monday. The Monday cron
 * writes last week's digest; the dashboard can also build the current week
 * so far on demand (throttled, since it uses AI calls).
 */

import { json } from './http.js';
import { DEFAULT_TEXT_MODEL, extractModelText, parseModelJson } from './pipeline.js';

const DAY = 86400000;
const MAX_PRODUCTS = 8;
const REGENERATE_AFTER_MS = 10 * 60 * 1000;

const bucket = (score) => (score >= 8 ? 'positive' : score >= 5 ? 'neutral' : 'negative');
const index = (c) => {
	const total = c.negative + c.neutral + c.positive;
	return total ? Math.round(((c.positive - c.negative) / total) * 100) : 0;
};

/** Monday (UTC) of the week containing `date`, as YYYY-MM-DD. */
export function weekStartOf(date = new Date()) {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
	return new Date(d.getTime() - dow * DAY).toISOString().slice(0, 10);
}

function countBy(rows) {
	const c = { negative: 0, neutral: 0, positive: 0 };
	for (const r of rows) c[bucket(Number(r.sentiment_score) || 5)]++;
	return c;
}

function pick(row) {
	return {
		id: row.id,
		headline: (row.title && !row.title.startsWith('Re: ') ? row.title : row.summary || '').slice(0, 160),
		source: row.source,
		score: row.sentiment_score,
		urgency: row.urgency_level,
		url: row.source_url,
	};
}

async function summarize(env, product, rows) {
	const ordered = [...rows].sort((a, b) => (a.urgency_level === 'High' ? -1 : 0) - (b.urgency_level === 'High' ? -1 : 0) || b.reactions - a.reactions);
	const lines = ordered.slice(0, 15).map((r) => `- [${bucket(Number(r.sentiment_score) || 5)}] ${r.summary || r.title || ''}`.slice(0, 200));
	try {
		const res = await env.AI.run(env.AI_MODEL || DEFAULT_TEXT_MODEL, {
			messages: [
				{
					role: 'system',
					content:
						'You write a weekly feedback digest for a Cloudflare product team. In at most two plain sentences, say what developers ' +
						'mostly talked about this week and the single most important thing for the team to look at. No greetings, no bullet points. ' +
						'Return only JSON: {"summary": "..."}',
				},
				{ role: 'user', content: `Product: ${product}\nFeedback this week (${rows.length} items):\n${lines.join('\n')}` },
			],
			max_completion_tokens: 160,
			temperature: 0.3,
			chat_template_kwargs: { enable_thinking: false },
		});
		return String(parseModelJson(extractModelText(res)).summary || '').trim().slice(0, 600) || null;
	} catch (err) {
		console.error(`Digest summary for ${product} failed:`, err?.message || err);
		return null;
	}
}

/** Build and store the digest for the week starting `weekStart` (YYYY-MM-DD, a Monday). */
export async function generateDigest(env, weekStart, now = new Date()) {
	const start = new Date(`${weekStart}T00:00:00Z`);
	const end = new Date(start.getTime() + 7 * DAY);
	const prevStart = new Date(start.getTime() - 7 * DAY);
	const partial = now < end;

	const cols = 'id, title, summary, source, source_url, product_category, sentiment_score, urgency_level, reactions, feedback_status, theme_id';
	const { results: week } = await env.DB.prepare(
		`SELECT ${cols} FROM feedback WHERE feedback_timestamp >= ? AND feedback_timestamp < ? AND feedback_status != 'Dismissed'`
	)
		.bind(start.toISOString(), end.toISOString())
		.all();
	const { results: prev } = await env.DB.prepare(
		`SELECT product_category, sentiment_score FROM feedback WHERE feedback_timestamp >= ? AND feedback_timestamp < ? AND feedback_status != 'Dismissed'`
	)
		.bind(prevStart.toISOString(), start.toISOString())
		.all();
	const { results: themes } = await env.DB.prepare('SELECT id, title, created_at FROM themes').all();
	const themeTitle = new Map(themes.map((t) => [t.id, t.title]));

	const byProduct = new Map();
	for (const r of week) {
		const p = r.product_category || 'Unknown';
		if (!byProduct.has(p)) byProduct.set(p, []);
		byProduct.get(p).push(r);
	}
	const prevByProduct = new Map();
	for (const r of prev) {
		const p = r.product_category || 'Unknown';
		if (!prevByProduct.has(p)) prevByProduct.set(p, []);
		prevByProduct.get(p).push(r);
	}

	const products = [];
	for (const [product, rows] of [...byProduct.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_PRODUCTS)) {
		const counts = countBy(rows);
		const prevRows = prevByProduct.get(product) || [];
		const themeCounts = new Map();
		for (const r of rows) if (r.theme_id) themeCounts.set(r.theme_id, (themeCounts.get(r.theme_id) || 0) + 1);

		products.push({
			product,
			count: rows.length,
			prev_count: prevRows.length,
			counts,
			index: index(counts),
			prev_index: prevRows.length ? index(countBy(prevRows)) : null,
			summary: product === 'Unknown' ? null : await summarize(env, product, rows),
			themes: [...themeCounts.entries()]
				.filter(([id]) => themeTitle.get(id))
				.sort((a, b) => b[1] - a[1])
				.slice(0, 3)
				.map(([id, n]) => ({ id, title: themeTitle.get(id), count: n })),
			urgent: rows
				.filter((r) => bucket(Number(r.sentiment_score) || 5) === 'negative' || r.urgency_level === 'High')
				.sort((a, b) => (b.urgency_level === 'High') - (a.urgency_level === 'High') || (b.reactions || 0) - (a.reactions || 0))
				.slice(0, 3)
				.map(pick),
			praise: rows
				.filter((r) => Number(r.sentiment_score) >= 8)
				.sort((a, b) => b.sentiment_score - a.sentiment_score || (b.reactions || 0) - (a.reactions || 0))
				.slice(0, 2)
				.map(pick),
		});
	}

	const totals = countBy(week);
	const sources = {};
	for (const r of week) sources[r.source || 'Other'] = (sources[r.source || 'Other'] || 0) + 1;
	const body = {
		week_start: weekStart,
		week_end: end.toISOString().slice(0, 10),
		generated_at: now.toISOString(),
		partial,
		totals: {
			count: week.length,
			prev_count: prev.length,
			counts: totals,
			index: index(totals),
			prev_index: prev.length ? index(countBy(prev)) : null,
			sources,
			new_themes: themes.filter((t) => t.created_at >= start.toISOString() && t.created_at < end.toISOString() && t.title).length,
		},
		products,
	};

	await env.DB.prepare(
		`INSERT INTO digests (week_start, body, created_at) VALUES (?, ?, ?)
		 ON CONFLICT(week_start) DO UPDATE SET body = excluded.body, created_at = excluded.created_at`
	)
		.bind(weekStart, JSON.stringify(body), now.toISOString())
		.run();
	return body;
}

/** GET /digests[?week=YYYY-MM-DD] — one digest plus the list of available weeks. */
export async function getDigests(url, env) {
	const { results } = await env.DB.prepare('SELECT week_start, created_at FROM digests ORDER BY week_start DESC LIMIT 52').all();
	const week = url.searchParams.get('week') || results[0]?.week_start;
	let digest = null;
	if (week) {
		const row = await env.DB.prepare('SELECT body FROM digests WHERE week_start = ?').bind(week).first();
		digest = row ? JSON.parse(row.body) : null;
	}
	return json({ weeks: results.map((r) => r.week_start), digest });
}

/**
 * POST /digests/generate {week?} — build a digest now (default: current week so far).
 * Open to the dashboard, but a week is rebuilt at most every 10 minutes.
 */
export async function handleGenerate(request, env) {
	const body = await request.json().catch(() => ({}));
	const week = typeof body?.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.week) ? weekStartOf(new Date(`${body.week}T12:00:00Z`)) : weekStartOf();
	const existing = await env.DB.prepare('SELECT body, created_at FROM digests WHERE week_start = ?').bind(week).first();
	if (existing && Date.now() - new Date(existing.created_at).getTime() < REGENERATE_AFTER_MS) {
		return json({ digest: JSON.parse(existing.body), regenerated: false });
	}
	return json({ digest: await generateDigest(env, week), regenerated: true });
}

/** Cron entry: last week's digest. */
export async function weeklyDigest(env, now = new Date()) {
	const lastWeek = weekStartOf(new Date(now.getTime() - 7 * DAY));
	return generateDigest(env, lastWeek, now);
}

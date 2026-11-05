/**
 * Per-product AI summaries for the Products tab.
 *
 * One short paragraph per product describing the last 30 days of feedback:
 * what developers like, what they struggle with, and the main ask. Summaries
 * are cached in product_summaries and only rewritten when that product has
 * new feedback (or the summary is a day old), so AI usage stays small.
 */

import { json } from './http.js';
import { DEFAULT_TEXT_MODEL, extractModelText, parseModelJson } from './pipeline.js';

const WINDOW_DAYS = 30;
const MIN_ITEMS = 2;
const MAX_PER_RUN = 6;
const MIN_AGE_MS = 15 * 60 * 1000; // don't rewrite a summary more than every 15 minutes
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const bucket = (score) => (score >= 8 ? 'positive' : score >= 5 ? 'neutral' : 'negative');

async function productRows(env) {
	const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
	const { results } = await env.DB.prepare(
		`SELECT product_category AS product, title, summary, sentiment_score, urgency_level, reactions
		 FROM feedback WHERE feedback_timestamp >= ? AND feedback_status != 'Dismissed' AND product_category IS NOT NULL AND product_category != 'Unknown'`
	)
		.bind(since)
		.all();
	const byProduct = new Map();
	for (const r of results) {
		if (!byProduct.has(r.product)) byProduct.set(r.product, []);
		byProduct.get(r.product).push(r);
	}
	return byProduct;
}

/** Products whose summary is missing or out of date, busiest first. */
export function staleProducts(byProduct, cached, now = Date.now()) {
	return [...byProduct.entries()]
		.filter(([, rows]) => rows.length >= MIN_ITEMS)
		.filter(([product, rows]) => {
			const c = cached.get(product);
			if (!c) return true;
			const age = now - new Date(c.generated_at).getTime();
			if (age < MIN_AGE_MS) return false;
			return c.item_count !== rows.length || age > MAX_AGE_MS;
		})
		.sort((a, b) => b[1].length - a[1].length)
		.map(([product]) => product);
}

async function writeSummary(env, product, rows) {
	const ordered = [...rows].sort((a, b) => (b.urgency_level === 'High') - (a.urgency_level === 'High') || (b.reactions || 0) - (a.reactions || 0));
	const counts = { negative: 0, neutral: 0, positive: 0 };
	for (const r of rows) counts[bucket(Number(r.sentiment_score) || 5)]++;
	const lines = ordered
		.slice(0, 25)
		.map((r) => `- [${bucket(Number(r.sentiment_score) || 5)}] ${(r.title && !r.title.startsWith('Re: ') ? r.title + ': ' : '') + (r.summary || '')}`.slice(0, 220));

	try {
		const res = await env.AI.run(env.AI_MODEL || DEFAULT_TEXT_MODEL, {
			messages: [
				{
					role: 'system',
					content:
						'You summarise developer feedback about one Cloudflare product for its product manager. Write 2-3 plain sentences: ' +
						'what developers like (if anything), what they struggle with most, and the single most useful thing the team could do next. ' +
						'Be specific (name the actual features or errors). No greetings, no bullet points, no percentages. Return only JSON: {"summary": "..."}',
				},
				{
					role: 'user',
					content: `Product: ${product}\nLast ${WINDOW_DAYS} days: ${rows.length} items (${counts.negative} negative, ${counts.neutral} neutral, ${counts.positive} positive)\n${lines.join('\n')}`,
				},
			],
			max_completion_tokens: 220,
			temperature: 0.3,
			chat_template_kwargs: { enable_thinking: false },
		});
		const summary = String(parseModelJson(extractModelText(res)).summary || '').trim().slice(0, 800);
		if (!summary) return false;
		await env.DB.prepare(
			`INSERT INTO product_summaries (product, summary, item_count, generated_at) VALUES (?, ?, ?, ?)
			 ON CONFLICT(product) DO UPDATE SET summary = excluded.summary, item_count = excluded.item_count, generated_at = excluded.generated_at`
		)
			.bind(product, summary, rows.length, new Date().toISOString())
			.run();
		return true;
	} catch (err) {
		console.error(`Summary for ${product} failed:`, err?.message || err);
		return false;
	}
}

/** Sync-loop entry and POST /products/summaries/refresh: rewrite up to MAX_PER_RUN stale summaries. */
export async function refreshSummaries(env, { maxNew } = {}) {
	const byProduct = await productRows(env);
	const { results } = await env.DB.prepare('SELECT * FROM product_summaries').all();
	const cached = new Map(results.map((r) => [r.product, r]));
	const stale = staleProducts(byProduct, cached).slice(0, Number(maxNew) || MAX_PER_RUN);
	let written = 0;
	for (const product of stale) if (await writeSummary(env, product, byProduct.get(product))) written++;
	return { source: 'summaries', written, stale: stale.length };
}

/** GET /products/summaries */
export async function listSummaries(env) {
	const { results } = await env.DB.prepare('SELECT * FROM product_summaries ORDER BY product').all();
	return json({ summaries: results, window_days: WINDOW_DAYS });
}

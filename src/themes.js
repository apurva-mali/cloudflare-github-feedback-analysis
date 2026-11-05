/**
 * Themes: group feedback that talks about the same thing.
 *
 * Each feedback item is embedded (BGE, same as search) and compared with
 * (a) the other items in this batch and (b) its nearest neighbours already in
 * Vectorize. If the closest match is at least THEME_SIMILARITY (cosine), the
 * item joins that match's theme — or the two start a new theme together.
 * Themes get a short AI-written title, refreshed as they grow.
 *
 * Runs as a "source" in the sync loop, so new items are themed every hour and
 * existing items (theme_checked = 0) are backfilled in batches.
 */

import { json } from './http.js';
import { EMBEDDING_MODEL, DEFAULT_TEXT_MODEL, embeddingTextFor, extractModelText, parseModelJson } from './pipeline.js';

const DEFAULT_SIMILARITY = 0.82;

/** Items only share a theme when they're about the same product (unless one is Unknown). */
export function sameProduct(a, b) {
	return !a || !b || a === 'Unknown' || b === 'Unknown' || a === b;
}
const DEFAULT_BATCH = 40;
const NEIGHBOURS = 6;

export function cosine(a, b) {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	return na && nb ? dot / Math.sqrt(na * nb) : 0;
}


/** Write a new title when a theme is new or has grown enough since it was last titled. */
export function needsTitle(theme, count) {
	if (!theme.title) return true;
	const last = theme.titled_at_count || 0;
	return count >= 3 && count >= last * 1.5;
}

async function embed(env, rows) {
	const vectors = [];
	for (let i = 0; i < rows.length; i += 50) {
		const res = await env.AI.run(EMBEDDING_MODEL, { text: rows.slice(i, i + 50).map(embeddingTextFor) });
		vectors.push(...res.data);
	}
	return vectors;
}

async function writeTitle(env, themeId) {
	const { results: members } = await env.DB.prepare(
		`SELECT title, summary, product_category, sentiment_score FROM feedback WHERE theme_id = ?
		 ORDER BY reactions DESC, feedback_timestamp DESC LIMIT 12`
	)
		.bind(themeId)
		.all();
	if (members.length < 2) return null;

	const products = {};
	for (const m of members) products[m.product_category || 'Unknown'] = (products[m.product_category || 'Unknown'] || 0) + 1;
	const product = Object.entries(products).sort((a, b) => b[1] - a[1])[0][0];

	const lines = members.map((m) => `- ${(m.title && !m.title.startsWith('Re: ') ? m.title + ': ' : '') + (m.summary || '')}`.slice(0, 220));
	let title = null;
	try {
		const res = await env.AI.run(env.AI_MODEL || DEFAULT_TEXT_MODEL, {
			messages: [
				{
					role: 'system',
					content:
						'These developer feedback items were grouped because they discuss the same thing. ' +
						'Write a short, specific title (3-8 words) naming the shared problem, request or praise, ' +
						'e.g. "R2 multipart upload ETag mismatch" or "Praise for zero egress fees". ' +
						'Return only JSON: {"title": "..."}',
				},
				{ role: 'user', content: `Product: ${product}\nItems:\n${lines.join('\n')}` },
			],
			max_completion_tokens: 60,
			temperature: 0.2,
			chat_template_kwargs: { enable_thinking: false },
		});
		title = String(parseModelJson(extractModelText(res)).title || '').trim().slice(0, 90) || null;
	} catch (err) {
		console.error('Theme title failed:', err?.message || err);
	}
	if (!title) title = (members[0].title || members[0].summary || 'Related feedback').replace(/^Re: /, '').slice(0, 80);

	await env.DB.prepare('UPDATE themes SET title = ?, product = ?, titled_at_count = ?, updated_at = ? WHERE id = ?')
		.bind(title, product, members.length, new Date().toISOString(), themeId)
		.run();
	return title;
}

/** Sync-loop entry: theme up to THEME_BATCH unchecked items. */
export async function syncThemes(env, { maxNew } = {}) {
	const limit = Number(maxNew) || Number(env.THEME_BATCH) || DEFAULT_BATCH;
	const threshold = Number(env.THEME_SIMILARITY) || DEFAULT_SIMILARITY;
	const result = { source: 'themes', checked: 0, joined: 0, new_themes: 0, retitled: 0, remaining: 0 };

	const { results: rows } = await env.DB.prepare(
		`SELECT id, title, summary, original_text, product_category, source, repo, urgency_level FROM feedback
		 WHERE theme_checked = 0 ORDER BY feedback_timestamp ASC LIMIT ?`
	)
		.bind(limit)
		.all();
	if (!rows.length) return result;

	const vectors = await embed(env, rows);
	const batchIndex = new Map(rows.map((r, i) => [r.id, i]));

	// Keep Vectorize complete (ingestion may have failed to index some items).
	try {
		await env.VECTOR_INDEX.upsert(
			rows.map((r, i) => ({
				id: r.id,
				values: vectors[i],
				metadata: { text: (r.title || r.original_text || '').slice(0, 100), source: r.source, product_category: r.product_category, urgency_level: r.urgency_level },
			}))
		);
	} catch (err) {
		console.error('Vectorize upsert during theming failed:', err?.message || err);
	}

	const themeOf = new Map(); // feedback id -> theme id | null (known so far)
	const productOf = new Map(rows.map((r) => [r.id, r.product_category]));
	const lookup = async (id) => {
		if (themeOf.has(id) && productOf.has(id)) return { theme: themeOf.get(id), product: productOf.get(id) };
		const row = await env.DB.prepare('SELECT theme_id, product_category FROM feedback WHERE id = ?').bind(id).first();
		if (!row) return undefined; // vector without a feedback row
		themeOf.set(id, row.theme_id ?? null);
		productOf.set(id, row.product_category);
		return { theme: row.theme_id ?? null, product: row.product_category };
	};
	const touched = new Set();
	const now = new Date().toISOString();
	const writes = [];

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		// Every candidate above the bar, most similar first: earlier items in this batch
		// and nearest neighbours already in Vectorize.
		const candidates = new Map();
		for (let j = 0; j < i; j++) {
			const score = cosine(vectors[i], vectors[j]);
			if (score >= threshold) candidates.set(rows[j].id, score);
		}
		try {
			const res = await env.VECTOR_INDEX.query(vectors[i], { topK: NEIGHBOURS });
			for (const m of res.matches || []) {
				if (m.id === row.id || m.score < threshold) continue;
				if (batchIndex.has(m.id) && batchIndex.get(m.id) > i) continue; // compared when that item's turn comes
				candidates.set(m.id, Math.max(m.score, candidates.get(m.id) || 0));
			}
		} catch (err) {
			console.error('Vectorize query during theming failed:', err?.message || err);
		}

		// Join the closest candidate about the same product.
		let themeId = null;
		for (const [candidateId] of [...candidates.entries()].sort((x, y) => y[1] - x[1])) {
			const neighbour = await lookup(candidateId);
			if (!neighbour || !sameProduct(neighbour.product, row.product_category)) continue;
			if (neighbour.theme) {
				themeId = neighbour.theme;
				result.joined++;
			} else {
				const ins = await env.DB.prepare('INSERT INTO themes (title, product, created_at, updated_at) VALUES (NULL, ?, ?, ?)')
					.bind(row.product_category || 'Unknown', now, now)
					.run();
				themeId = ins.meta?.last_row_id;
				themeOf.set(candidateId, themeId);
				writes.push(env.DB.prepare('UPDATE feedback SET theme_id = ? WHERE id = ?').bind(themeId, candidateId));
				result.new_themes++;
			}
			break;
		}
		themeOf.set(row.id, themeId);
		if (themeId) touched.add(themeId);
		writes.push(env.DB.prepare('UPDATE feedback SET theme_id = ?, theme_checked = 1 WHERE id = ?').bind(themeId, row.id));
		result.checked++;
	}
	await env.DB.batch(writes);

	for (const themeId of touched) {
		const theme = await env.DB.prepare('SELECT * FROM themes WHERE id = ?').bind(themeId).first();
		const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE theme_id = ?').bind(themeId).first();
		if (theme && needsTitle(theme, n) && (await writeTitle(env, themeId))) result.retitled++;
	}

	const { n: remaining } = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE theme_checked = 0').first();
	result.remaining = remaining;
	return result;
}

/** GET /themes — themes with at least two members, most recently active first. */
export async function listThemes(env) {
	const { results } = await env.DB.prepare(
		`SELECT th.id, th.title, th.product, th.created_at, th.updated_at,
		        COUNT(f.id) AS item_count, MAX(f.feedback_timestamp) AS last_seen, MIN(f.feedback_timestamp) AS first_seen
		 FROM themes th JOIN feedback f ON f.theme_id = th.id
		 GROUP BY th.id HAVING COUNT(f.id) >= 2
		 ORDER BY last_seen DESC`
	).all();
	return json({ themes: results });
}

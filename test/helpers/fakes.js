/**
 * In-memory stand-ins for the Worker's bindings, so the real pipeline code and
 * the real schema.sql can be exercised in plain Node.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCHEMA = readFileSync(fileURLToPath(new URL('../../schema.sql', import.meta.url)), 'utf8');

/** Minimal D1 API (prepare/bind/run/all/first/batch) on node:sqlite. */
export function createFakeD1() {
	const db = new DatabaseSync(':memory:');
	db.exec(SCHEMA);

	const makeStmt = (sql, params = []) => ({
		bind: (...p) => {
			// Match D1's real limit so tests catch oversized IN (...) lists.
			if (p.length > 100) throw new Error(`D1_ERROR: too many SQL variables (${p.length} > 100)`);
			return makeStmt(sql, p);
		},
		async all() {
			return { results: db.prepare(sql).all(...params) };
		},
		async first() {
			return db.prepare(sql).get(...params) ?? null;
		},
		async run() {
			const info = db.prepare(sql).run(...params);
			return { meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
		},
	});

	return {
		_db: db,
		prepare: (sql) => makeStmt(sql),
		async batch(stmts) {
			db.exec('BEGIN');
			try {
				const out = [];
				for (const s of stmts) out.push(await s.run());
				db.exec('COMMIT');
				return out;
			} catch (e) {
				db.exec('ROLLBACK');
				throw e;
			}
		},
	};
}

/**
 * Deterministic "embedding": a bag-of-words hashed into 128 dims, normalised.
 * Texts sharing most words get cosine close to 1; unrelated texts stay low.
 */
export function fakeEmbed(text) {
	const v = new Array(128).fill(0);
	for (const w of String(text).toLowerCase().match(/[a-z0-9]+/g) || []) {
		let h = 0;
		for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
		v[h % 128] += 1;
	}
	const n = Math.hypot(...v) || 1;
	return v.map((x) => x / n);
}

/** Fake Workers AI: embeddings from fakeEmbed; text model answers by task. */
export function createFakeAI(analysis = {}) {
	const calls = { text: 0, embed: 0, titles: 0, summaries: 0 };
	return {
		calls,
		async run(model, input) {
			if (model.includes('bge')) {
				calls.embed++;
				return { data: input.text.map(fakeEmbed) };
			}
			calls.text++;
			const system = input.messages[0].content;
			if (system.includes('{"title"')) {
				calls.titles++;
				return { choices: [{ message: { content: '{"title": "Fake theme title"}' } }] };
			}
			if (system.includes('{"summary"')) {
				calls.summaries++;
				return { choices: [{ message: { content: '{"summary": "Developers mostly talked about uploads."}' } }] };
			}
			const body = {
				sentiment_score: 3,
				urgency_level: 'Neutral',
				user_type: 'Individual',
				product_category: 'Unknown',
				feedback_type: 'UX',
				summary: 'User reports a problem',
				recommended_action: 'Investigate',
				...analysis,
			};
			return { choices: [{ message: { content: '```json\n' + JSON.stringify(body) + '\n```' } }] };
		},
	};
}

/** Fake Vectorize with real cosine nearest-neighbour queries. */
export function createFakeVectorize() {
	const vectors = new Map();
	const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b) || 1);
	return {
		vectors,
		async upsert(items) {
			for (const v of items) vectors.set(v.id, v);
		},
		async insert(items) {
			for (const v of items) vectors.set(v.id, v);
		},
		async query(values, { topK = 5 } = {}) {
			const matches = [...vectors.values()]
				.map((v) => ({ id: v.id, score: v.values.length === values.length ? cos(values, v.values) : 0 }))
				.sort((a, b) => b.score - a.score)
				.slice(0, topK);
			return { matches };
		},
	};
}

/** Build a GitHub REST issue object. */
export function ghIssue(number, overrides = {}) {
	return {
		number,
		title: `Issue ${number}`,
		body: `Something about issue ${number}`,
		html_url: `https://github.com/cloudflare/workers-sdk/issues/${number}`,
		state: 'open',
		labels: [],
		user: { login: `user${number}`, type: 'User' },
		author_association: 'NONE',
		reactions: { total_count: 0 },
		comments: 0,
		created_at: `2026-11-0${(number % 3) + 1}T10:00:00Z`,
		updated_at: `2026-11-03T${String(10 + (number % 10)).padStart(2, '0')}:00:00Z`,
		...overrides,
	};
}

/** Replace global fetch with one that serves `issuesByRepo[repo]` sorted by updated_at, honouring since/per_page/page. */
export function mockGitHubFetch(issuesByRepo) {
	const requests = [];
	globalThis.fetch = async (url) => {
		const u = new URL(url);
		requests.push(u);
		const repo = u.pathname.replace(/^\/repos\//, '').replace(/\/issues$/, '');
		const since = u.searchParams.get('since');
		const perPage = Number(u.searchParams.get('per_page'));
		const page = Number(u.searchParams.get('page'));
		const list = (issuesByRepo[repo] || [])
			.filter((i) => !since || i.updated_at >= since)
			.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
		return new Response(JSON.stringify(list.slice((page - 1) * perPage, page * perPage)), { status: 200 });
	};
	return requests;
}

// HN fixtures are dated within the last day so they fall inside the backfill window.
const HN_BASE = Math.floor(Date.now() / 1000) - 86400;

/** Build an Algolia HN hit (comment by default). */
export function hnHit(id, overrides = {}) {
	return {
		objectID: String(id),
		_tags: ['comment', `author_u${id}`, 'story_1'],
		author: `u${id}`,
		comment_text: `We moved our image pipeline to Cloudflare R2 last month and our egress bill basically disappeared. Comment ${id}.`,
		story_title: 'Show HN: Something on Cloudflare',
		created_at: new Date((HN_BASE + id * 60) * 1000).toISOString(),
		created_at_i: HN_BASE + id * 60,
		points: null,
		...overrides,
	};
}

/** Replace global fetch with a fake Algolia HN API serving `hitsByQuery[query]`, honouring numericFilters/page. */
export function mockHnFetch(hitsByQuery) {
	const requests = [];
	globalThis.fetch = async (url) => {
		const u = new URL(url);
		requests.push(u);
		const since = Number((u.searchParams.get('numericFilters') || '').split('>=')[1] || 0);
		const perPage = Number(u.searchParams.get('hitsPerPage'));
		const page = Number(u.searchParams.get('page') || 0);
		const all = (hitsByQuery[u.searchParams.get('query')] || [])
			.filter((h) => h.created_at_i >= since)
			.sort((a, b) => b.created_at_i - a.created_at_i); // newest first, like search_by_date
		return new Response(
			JSON.stringify({ hits: all.slice(page * perPage, (page + 1) * perPage), nbPages: Math.ceil(all.length / perPage) }),
			{ status: 200 }
		);
	};
	return requests;
}

/** Fake AI whose analysis depends on the text: `rules` is [[regex, analysisOverrides], ...]. */
export function createScriptedAI(rules) {
	const calls = { text: 0, embed: 0 };
	return {
		calls,
		async run(model, input) {
			if (model.includes('bge')) {
				calls.embed++;
				return { data: input.text.map(() => new Array(768).fill(0.01)) };
			}
			calls.text++;
			const text = input.messages.at(-1).content;
			const match = rules.find(([re]) => re.test(text));
			const body = {
				relevant: true,
				sentiment_score: 5,
				urgency_level: 'Neutral',
				user_type: 'Individual',
				product_category: 'Unknown',
				feedback_type: 'UX',
				summary: 's',
				recommended_action: 'a',
				...(match ? match[1] : {}),
			};
			return { choices: [{ message: { content: JSON.stringify(body) } }] };
		},
	};
}

let rowSeq = 0;
/** Insert a feedback row directly (bypassing AI) for API-level tests. */
export function insertFeedback(db, overrides = {}) {
	const id = overrides.id || `f${++rowSeq}`;
	const row = {
		id,
		feedback_timestamp: new Date().toISOString(),
		user_id: '@someone',
		source: 'GitHub',
		product_category: 'R2',
		user_type: 'Community',
		urgency_level: 'Neutral',
		feedback_type: 'Bug',
		summary: `Summary ${id}`,
		recommended_action: 'Look into it',
		feedback_status: 'Open',
		original_text: `Text ${id}`,
		sentiment_score: 3,
		nps_class: 'Detractor',
		title: `Title ${id}`,
		source_url: `https://example.com/${id}`,
		reactions: 0,
		...overrides,
	};
	const cols = Object.keys(row);
	db._db.prepare(`INSERT INTO feedback (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
	return row;
}

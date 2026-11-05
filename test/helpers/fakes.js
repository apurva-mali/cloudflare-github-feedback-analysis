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
		bind: (...p) => makeStmt(sql, p),
		async all() {
			return { results: db.prepare(sql).all(...params) };
		},
		async first() {
			return db.prepare(sql).get(...params) ?? null;
		},
		async run() {
			const info = db.prepare(sql).run(...params);
			return { meta: { changes: Number(info.changes) } };
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

/** Fake Workers AI: embeddings return fixed vectors; text model returns `analysis` as chat-completions JSON. */
export function createFakeAI(analysis = {}) {
	const calls = { text: 0, embed: 0 };
	return {
		calls,
		async run(model, input) {
			if (model.includes('bge')) {
				calls.embed++;
				return { data: input.text.map(() => new Array(768).fill(0.01)) };
			}
			calls.text++;
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

export function createFakeVectorize() {
	const vectors = new Map();
	return {
		vectors,
		async upsert(items) {
			for (const v of items) vectors.set(v.id, v);
		},
		async query() {
			return { matches: [...vectors.keys()].slice(0, 5).map((id) => ({ id, score: 0.9 })) };
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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	productFromLabels,
	resolveProduct,
	feedbackTypeFromLabels,
	urgencyFromSignals,
	cleanIssueBody,
	isCommunityIssue,
	issueToItem,
	syncGitHub,
} from '../src/github.js';
import { parseModelJson, extractModelText, npsFromSentiment } from '../src/pipeline.js';
import worker from '../src/index.js';
import { createFakeD1, createFakeAI, createFakeVectorize, ghIssue, mockGitHubFetch } from './helpers/fakes.js';

describe('label mapping', () => {
	it('maps product:* labels to dashboard products, preferring a real product over tooling', () => {
		expect(productFromLabels(['bug', 'product:d1'], 'cloudflare/workers-sdk')).toBe('D1');
		expect(productFromLabels(['wrangler', 'product:r2'], 'cloudflare/workers-sdk')).toBe('R2');
		expect(productFromLabels(['package:wrangler'], 'cloudflare/workers-sdk')).toBe('Wrangler');
		expect(productFromLabels(['bug'], 'cloudflare/workers-sdk')).toBeNull();
	});

	it('resolves product as label > AI > repo default', () => {
		const item = { labels: [], repo: 'cloudflare/workers-sdk' };
		expect(resolveProduct({ ...item, labels: ['d1'] }, 'R2')).toBe('D1');
		expect(resolveProduct(item, 'R2')).toBe('R2');
		expect(resolveProduct(item, 'Unknown')).toBe('Wrangler');
		expect(resolveProduct({ labels: [], repo: 'someone/else' }, undefined)).toBe('Unknown');
	});

	it('derives feedback type and urgency from labels and reactions', () => {
		expect(feedbackTypeFromLabels(['bug'])).toBe('Bug');
		expect(feedbackTypeFromLabels(['regression', 'enhancement'])).toBe('Bug');
		expect(feedbackTypeFromLabels(['enhancement'])).toBe('Feature Request');
		expect(feedbackTypeFromLabels(['awaiting reporter response'])).toBeNull();

		expect(urgencyFromSignals(['priority: p0'], 0)).toBe('High');
		expect(urgencyFromSignals(['regression'], 0)).toBe('High');
		expect(urgencyFromSignals([], 25)).toBe('High');
		expect(urgencyFromSignals(['priority: p2'], 0)).toBe('Low');
		expect(urgencyFromSignals([], 3)).toBeNull();
	});
});

describe('issue filtering and cleaning', () => {
	it('drops PRs, bots and Cloudflare staff by default', () => {
		expect(isCommunityIssue(ghIssue(1))).toBe(true);
		expect(isCommunityIssue(ghIssue(2, { pull_request: {} }))).toBe(false);
		expect(isCommunityIssue(ghIssue(3, { user: { login: 'dependabot', type: 'Bot' } }))).toBe(false);
		expect(isCommunityIssue(ghIssue(4, { author_association: 'MEMBER' }))).toBe(false);
		expect(isCommunityIssue(ghIssue(4, { author_association: 'MEMBER' }), { includeStaff: true })).toBe(true);
	});

	it('strips template comments, code blocks and images from bodies', () => {
		const body = '<!-- template help -->\nIt breaks.\n```\nError: stack\n  at x\n```\n![shot](http://img)\n\n\n\nThanks';
		expect(cleanIssueBody(body)).toBe('It breaks.\n[code omitted]\n\n\nThanks'.replace(/\n{3,}/g, '\n\n'));
	});

	it('maps an issue to a pipeline item with provenance', () => {
		const item = issueToItem(ghIssue(42, { labels: [{ name: 'bug' }], reactions: { total_count: 7 }, comments: 3 }), 'cloudflare/workers-sdk');
		expect(item).toMatchObject({
			source: 'GitHub',
			user_id: '@user42',
			external_id: 'gh:cloudflare/workers-sdk#42',
			source_url: 'https://github.com/cloudflare/workers-sdk/issues/42',
			labels: ['bug'],
			reactions: 7,
			comments_count: 3,
		});
		expect(item.text.startsWith('Issue 42\n\n')).toBe(true);
	});
});

describe('model output parsing', () => {
	it('handles chat-completions, legacy {response} and fenced JSON', () => {
		expect(extractModelText({ choices: [{ message: { content: 'x' } }] })).toBe('x');
		expect(extractModelText({ response: 'y' })).toBe('y');
		expect(parseModelJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
		expect(() => parseModelJson('no json here')).toThrow();
	});

	it('derives NPS class from sentiment', () => {
		expect(npsFromSentiment(10)).toBe('Promoter');
		expect(npsFromSentiment(7)).toBe('Passive');
		expect(npsFromSentiment(3)).toBe('Detractor');
	});
});

describe('syncGitHub end to end (fake bindings)', () => {
	const realFetch = globalThis.fetch;
	let env;

	beforeEach(() => {
		env = {
			DB: createFakeD1(),
			AI: createFakeAI({ product_category: 'R2' }),
			VECTOR_INDEX: createFakeVectorize(),
			GITHUB_REPOS: 'cloudflare/workers-sdk',
			GITHUB_MAX_NEW_PER_RUN: '3',
		};
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('ingests community issues within budget, resumes from the cursor, and never duplicates', async () => {
		const issues = [
			ghIssue(1, { labels: [{ name: 'bug' }, { name: 'product:d1' }] }),
			ghIssue(2, { pull_request: {} }),
			ghIssue(3, { author_association: 'MEMBER' }),
			ghIssue(4, { labels: [{ name: 'enhancement' }] }),
			ghIssue(5, { labels: [{ name: 'priority: p0' }] }),
			ghIssue(6),
			ghIssue(7),
		];
		mockGitHubFetch({ 'cloudflare/workers-sdk': issues });

		// Run 1: budget of 3 new issues → #1, #4, #5 (PR and staff skipped)
		const run1 = await syncGitHub(env);
		expect(run1.results[0]).toMatchObject({ created: 3, skipped: 2 });
		expect(env.AI.calls.text).toBe(3);
		expect(env.AI.calls.embed).toBe(1); // batched

		const rows = env.DB._db.prepare('SELECT * FROM feedback ORDER BY external_id').all();
		const byId = Object.fromEntries(rows.map((r) => [r.external_id, r]));
		expect(byId['gh:cloudflare/workers-sdk#1']).toMatchObject({ product_category: 'D1', feedback_type: 'Bug', source: 'GitHub', feedback_status: 'Open' });
		expect(byId['gh:cloudflare/workers-sdk#4']).toMatchObject({ product_category: 'R2', feedback_type: 'Feature Request' }); // AI product used
		expect(byId['gh:cloudflare/workers-sdk#5']).toMatchObject({ urgency_level: 'High', nps_class: 'Detractor' });
		expect(env.VECTOR_INDEX.vectors.size).toBe(3);

		// Run 2: picks up the remaining #6, #7 only
		const run2 = await syncGitHub(env);
		expect(run2.results[0].created).toBe(2);
		expect(env.DB._db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n).toBe(5);

		// Upstream change: #1 gets closed and more reactions → metadata refreshed, no re-analysis
		issues[0] = { ...issues[0], state: 'closed', reactions: { total_count: 12 }, updated_at: '2026-11-04T09:00:00Z' };
		const aiBefore = env.AI.calls.text;
		const run3 = await syncGitHub(env);
		expect(run3.results[0].created).toBe(0);
		expect(env.AI.calls.text).toBe(aiBefore);
		const refreshed = env.DB._db.prepare("SELECT * FROM feedback WHERE external_id = 'gh:cloudflare/workers-sdk#1'").get();
		expect(refreshed).toMatchObject({ source_state: 'closed', reactions: 12 });
		expect(env.DB._db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n).toBe(5);
	});

	it('falls back to defaults when the model returns garbage', async () => {
		env.AI = {
			calls: { text: 0 },
			async run(model, input) {
				if (model.includes('bge')) return { data: input.text.map(() => [0.1]) };
				return { choices: [{ message: { content: 'I cannot comply' } }] };
			},
		};
		mockGitHubFetch({ 'cloudflare/workers-sdk': [ghIssue(9, { labels: [{ name: 'bug' }] })] });
		const run = await syncGitHub(env);
		expect(run.results[0]).toMatchObject({ created: 1, ai_failures: 1 });
		const row = env.DB._db.prepare('SELECT * FROM feedback').get();
		expect(row).toMatchObject({ feedback_type: 'Bug', product_category: 'Wrangler', recommended_action: 'Review manually (AI analysis unavailable)' });
	});
});

describe('HTTP routes', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('protects write routes with ADMIN_TOKEN and persists ticket status', async () => {
		const env = { DB: createFakeD1(), AI: createFakeAI(), VECTOR_INDEX: createFakeVectorize(), ADMIN_TOKEN: 's3cret', GITHUB_REPOS: 'cloudflare/workers-sdk' };
		mockGitHubFetch({ 'cloudflare/workers-sdk': [ghIssue(1)] });

		const unauth = await worker.fetch(new Request('http://x/sync/github', { method: 'POST' }), env);
		expect(unauth.status).toBe(401);

		const ok = await worker.fetch(new Request('http://x/sync/github', { method: 'POST', headers: { Authorization: 'Bearer s3cret' } }), env);
		expect((await ok.json()).results[0].created).toBe(1);

		const all = await (await worker.fetch(new Request('http://x/all'), env)).json();
		expect(all.total).toBe(1);
		expect(Array.isArray(all.results[0].labels)).toBe(true);

		const id = all.results[0].id;
		const patch = await worker.fetch(
			new Request(`http://x/feedback/${id}`, { method: 'PATCH', body: JSON.stringify({ feedback_status: 'Ticket Raised' }) }),
			env
		);
		expect(patch.status).toBe(200);
		const bad = await worker.fetch(new Request(`http://x/feedback/${id}`, { method: 'PATCH', body: JSON.stringify({ feedback_status: 'Nope' }) }), env);
		expect(bad.status).toBe(400);

		const after = await (await worker.fetch(new Request('http://x/all'), env)).json();
		expect(after.results[0].feedback_status).toBe('Ticket Raised');

		const status = await (await worker.fetch(new Request('http://x/sync/status'), env)).json();
		expect(status.streams[0]).toMatchObject({ stream: 'github:cloudflare/workers-sdk' });
	});
});

describe('more repos and deeper backfill', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('gives each repo its own budget, marks docs issues as Docs, and since_days never duplicates', async () => {
		const now = Date.now();
		const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
		const sdk = [1, 2, 3, 4].map((n) => ghIssue(n, { updated_at: iso(2), created_at: iso(2) }));
		const docs = [10, 11].map((n) => ghIssue(n, { updated_at: iso(3), created_at: iso(3), html_url: `https://github.com/cloudflare/cloudflare-docs/issues/${n}` }));
		const oldSdk = ghIssue(99, { updated_at: iso(40), created_at: iso(40) }); // older than the first backfill window
		mockGitHubFetch({ 'cloudflare/workers-sdk': [...sdk, oldSdk], 'cloudflare/cloudflare-docs': docs });
		const env = {
			DB: createFakeD1(),
			AI: createFakeAI(),
			VECTOR_INDEX: createFakeVectorize(),
			GITHUB_REPOS: 'cloudflare/workers-sdk,cloudflare/cloudflare-docs',
			GITHUB_MAX_NEW_PER_REPO: '3',
			GITHUB_BACKFILL_DAYS: '14',
		};

		const run1 = await syncGitHub(env);
		expect(run1.results.map((r) => r.created)).toEqual([3, 2]); // docs not starved by sdk
		const docsRow = env.DB._db.prepare("SELECT feedback_type FROM feedback WHERE external_id = 'gh:cloudflare/cloudflare-docs#10'").get();
		expect(docsRow.feedback_type).toBe('Docs');

		await syncGitHub(env); // picks up sdk #4
		expect(env.DB._db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n).toBe(6);

		const aiBefore = env.AI.calls.text;
		const deep = await syncGitHub(env, { sinceDays: 60 });
		expect(deep.results[0]).toMatchObject({ created: 1 }); // only the 40-day-old issue is new
		expect(env.AI.calls.text).toBe(aiBefore + 1);
		expect(env.DB._db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n).toBe(7);
	});
});

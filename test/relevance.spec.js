import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../src/index.js';
import { syncGitHub } from '../src/github.js';
import { syncHackerNews } from '../src/hackernews.js';
import { syncRelevance } from '../src/relevance.js';
import { ABOUT_CLOUDFLARE_RULES } from '../src/pipeline.js';
import { createFakeD1, createFakeVectorize, createScriptedAI, ghIssue, hnHit, insertFeedback, mockGitHubFetch, mockHnFetch } from './helpers/fakes.js';

const realFetch = globalThis.fetch;
const count = (env, sql) => env.DB._db.prepare(sql).get().n;

describe('is it about Cloudflare?', () => {
	let env;
	beforeEach(() => {
		env = {
			DB: createFakeD1(),
			VECTOR_INDEX: createFakeVectorize(),
			AI: createScriptedAI([
				[/Hono is fantastic|Hono/, { subject: 'Hono', about_cloudflare: false, sentiment_score: 10 }],
				[/Vercel/, { subject: 'Vercel', about_cloudflare: false }],
				[/egress/, { subject: 'Cloudflare R2', about_cloudflare: true, sentiment_score: 9 }],
				[/flaky model/, { fail: true }],
			]),
			GITHUB_REPOS: 'cloudflare/workers-sdk',
			HN_QUERIES: 'Cloudflare Workers',
		};
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('the prompt spells out the third-party-tool rule', () => {
		expect(ABOUT_CLOUDFLARE_RULES).toMatch(/Hono is fantastic/);
		expect(ABOUT_CLOUDFLARE_RULES).toMatch(/integrating a third-party tool WITH a Cloudflare product counts/);
	});

	it('Hacker News: praise for a tool used on a Cloudflare project is dropped, praise for Cloudflare is kept', async () => {
		mockHnFetch({
			'Cloudflare Workers': [
				hnHit(1, { comment_text: 'Built my Cloudflare Workers project with Hono and honestly Hono is fantastic, best router ever.' }),
				hnHit(2, { comment_text: 'Moved our images to Cloudflare R2 and the egress bill went to zero overnight. Love it.' }),
			],
		});
		const r = await syncHackerNews(env);
		expect(r).toMatchObject({ created: 1, filtered_ai: 1 });
		expect(env.DB._db.prepare('SELECT subject, sentiment_score FROM feedback').get()).toMatchObject({ subject: 'Cloudflare R2', sentiment_score: 9 });
		expect(env.DB._db.prepare("SELECT reason FROM skipped_items WHERE external_id = 'hn:1'").get().reason).toBe('not_about_cloudflare:Hono');
	});

	it('GitHub: off-topic issues are skipped, remembered, and never re-analyzed', async () => {
		mockGitHubFetch({
			'cloudflare/workers-sdk': [ghIssue(1, { title: 'Please support Vercel deploys from wrangler' }), ghIssue(2, { title: 'D1 drops writes' })],
		});
		const r1 = await syncGitHub(env);
		expect(r1.results[0]).toMatchObject({ created: 1, not_about_cloudflare: 1, analyzed: 2 });
		const calls = env.AI.calls.text;
		await syncGitHub(env, { sinceDays: 30 }); // re-scan the same window
		expect(env.AI.calls.text).toBe(calls);
		expect(count(env, 'SELECT COUNT(*) AS n FROM feedback')).toBe(1);
	});

	it('cleans up existing items without losing anyone\'s work', async () => {
		const old = (id, text, extra = {}) => insertFeedback(env.DB, { id, external_id: `hn:${id}`, source: 'Hacker News', title: 'Re: Ask HN', original_text: text, ...extra });
		old('keep', 'Cloudflare R2 egress pricing is great');
		old('drop', 'Hono is fantastic');
		old('starred', 'Hono again, starred by someone', { starred: 1 });
		old('ticketed', 'Hono with a ticket');
		old('flaky', 'flaky model output');
		env.DB._db.exec("INSERT INTO tickets (feedback_id, title, created_at, updated_at) VALUES ('ticketed', 't', 'x', 'x')");
		await env.VECTOR_INDEX.upsert([{ id: 'drop', values: [1] }]);

		const r = await syncRelevance(env);
		expect(r).toMatchObject({ checked: 5, kept: 1, removed: 1, dismissed: 2, failed: 1, remaining: 1 });

		const rows = Object.fromEntries(env.DB._db.prepare('SELECT id, feedback_status, dismissed_reason, relevance_checked, subject FROM feedback').all().map((x) => [x.id, x]));
		expect(rows.drop).toBeUndefined();
		expect(env.VECTOR_INDEX.vectors.has('drop')).toBe(false);
		expect(env.DB._db.prepare("SELECT reason FROM skipped_items WHERE external_id = 'hn:drop'").get().reason).toBe('not_about_cloudflare:Hono');
		expect(rows.keep).toMatchObject({ relevance_checked: 1, feedback_status: 'Open' });
		expect(rows.starred).toMatchObject({ feedback_status: 'Dismissed', dismissed_reason: 'Off-topic', subject: 'Hono' });
		expect(rows.ticketed).toMatchObject({ feedback_status: 'Open', relevance_checked: 1 }); // ticket keeps it as is
		expect(rows.flaky.relevance_checked).toBe(0); // try again next run

		// HN never brings the removed item back
		mockHnFetch({ 'Cloudflare Workers': [hnHit(0, { objectID: 'drop', comment_text: 'Hono is fantastic, a long enough comment about Cloudflare Workers routing.' })] });
		const hn = await syncHackerNews(env);
		expect(hn.already_known).toBe(1);
	});

	it('runs in /sync/all after the sources', async () => {
		globalThis.fetch = async () => new Response('[]');
		const res = await worker.fetch(new Request('http://x/sync/all', { method: 'POST' }), env);
		expect(Object.keys(await res.json())).toEqual(['github', 'hackernews', 'relevance', 'summaries']);
	});
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanHnText, decodeEntities, hitToItem, passesKeywordFilter, productFromText, syncHackerNews } from '../src/hackernews.js';
import { npsFromSentiment } from '../src/pipeline.js';
import worker from '../src/index.js';
import { createFakeD1, createFakeVectorize, createScriptedAI, hnHit, mockHnFetch } from './helpers/fakes.js';

describe('HN text handling', () => {
	it('strips HTML and decodes entities from comment_text', () => {
		expect(decodeEntities('it&#x27;s &quot;fast&quot; &amp; cheap &#47;')).toBe(`it's "fast" & cheap /`);
		const html = 'R2 is great.<p>Pricing&#x27;s simpler than S3 <a href="https:&#x2F;&#x2F;x.com">link</a><pre><code>wrangler r2 bucket create</code></pre>';
		expect(cleanHnText(html)).toBe("R2 is great.\n\nPricing's simpler than S3 link [code omitted]");
	});

	it('maps comments and stories with links back to HN', () => {
		const c = hitToItem(hnHit(5));
		expect(c).toMatchObject({
			source: 'Hacker News',
			user_id: '@u5',
			external_id: 'hn:5',
			source_url: 'https://news.ycombinator.com/item?id=5',
			title: 'Re: Show HN: Something on Cloudflare',
			labels: ['comment'],
		});
		const s = hitToItem({ objectID: '9', _tags: ['story'], title: 'Show HN: Built on Workers', story_text: 'Hi &amp; bye', points: 120, num_comments: 40, created_at: 'x', created_at_i: 1 });
		expect(s).toMatchObject({ title: 'Show HN: Built on Workers', text: 'Show HN: Built on Workers\n\nHi & bye', reactions: 120, comments_count: 40, labels: ['story'] });
	});

	it('pre-filters short or off-topic text and guesses products from keywords', () => {
		expect(passesKeywordFilter({ text: 'too short cloudflare' })).toBe(false);
		expect(passesKeywordFilter({ text: 'A long comment about Kubernetes operators and why they are hard to run well.' })).toBe(false);
		expect(passesKeywordFilter({ text: 'A long comment about how Cloudflare Workers changed how we deploy at work.' })).toBe(true);
		expect(productFromText('Durable Objects + Workers')).toBe('Durable Objects');
		expect(productFromText('moved to R2')).toBe('R2');
		expect(productFromText('Workers AI inference')).toBe('Workers AI');
		expect(productFromText('nothing here')).toBeNull();
	});
});

describe('scoring buckets', () => {
	it('treats 5-7 as neutral and 8+ as positive', () => {
		expect([1, 4, 5, 6, 7, 8, 10].map(npsFromSentiment)).toEqual(['Detractor', 'Detractor', 'Passive', 'Passive', 'Passive', 'Promoter', 'Promoter']);
	});
});

describe('syncHackerNews (fake bindings)', () => {
	const realFetch = globalThis.fetch;
	let env;
	beforeEach(() => {
		env = {
			DB: createFakeD1(),
			VECTOR_INDEX: createFakeVectorize(),
			AI: createScriptedAI([
				[/egress bill/, { sentiment_score: 9, product_category: 'Unknown', feedback_type: 'UX' }],
				[/outage news/, { relevant: false }],
				[/cold starts/, { sentiment_score: 3, product_category: 'Workers', feedback_type: 'Bug' }],
			]),
			HN_QUERIES: 'Cloudflare R2,Cloudflare Workers',
			HN_MAX_NEW_PER_RUN: '3',
		};
	});
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('dedupes across queries, filters noise, respects budget, resumes, and never re-analyzes', async () => {
		const praise = hnHit(1);
		const shared = hnHit(2); // returned by both queries
		const noise = hnHit(3, { comment_text: 'Cloudflare outage news again, saw it on the status page this morning, oh well.' });
		const short = hnHit(4, { comment_text: 'cloudflare lol' });
		const bug = hnHit(5, { comment_text: 'Cloudflare Workers cold starts are hurting our p99 latency badly since last week.' });
		const later = hnHit(6);
		mockHnFetch({ 'Cloudflare R2': [praise, shared, later], 'Cloudflare Workers': [shared, noise, short, bug] });

		// Run 1: oldest first; budget 3 AI calls → #1, #2 created, #3 rejected by AI,
		// #4 dropped by the free keyword filter, then the budget stops it at #5
		const r1 = await syncHackerNews(env);
		expect(r1).toMatchObject({ fetched: 6, created: 2, filtered_ai: 1, filtered_keyword: 1, done: false });
		expect(env.AI.calls.text).toBe(3);

		const rows = env.DB._db.prepare('SELECT * FROM feedback ORDER BY external_id').all();
		expect(rows.map((r) => r.external_id)).toEqual(['hn:1', 'hn:2']);
		expect(rows[0]).toMatchObject({ source: 'Hacker News', product_category: 'R2', nps_class: 'Promoter', user_type: 'Community' }); // product from keywords

		// Run 2: resumes at the cursor → #5, #6 created
		const r2 = await syncHackerNews(env);
		expect(r2).toMatchObject({ created: 2, filtered_keyword: 0, done: true });
		const bugRow = env.DB._db.prepare("SELECT * FROM feedback WHERE external_id = 'hn:5'").get();
		expect(bugRow).toMatchObject({ product_category: 'Workers', feedback_type: 'Bug', nps_class: 'Detractor' });

		// Run 3: nothing new → no AI calls at all (stored and skipped items both remembered)
		const before = env.AI.calls.text;
		const r3 = await syncHackerNews(env);
		expect(r3.created).toBe(0);
		expect(env.AI.calls.text).toBe(before);
		expect(env.DB._db.prepare('SELECT COUNT(*) AS n FROM skipped_items').get().n).toBe(2);
		expect(env.DB._db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n).toBe(4);
	});

	it('handles a large batch of hits without exceeding D1 parameter limits', async () => {
		const many = Array.from({ length: 250 }, (_, i) => hnHit(i + 1, { comment_text: 'cloudflare lol' }));
		mockHnFetch({ 'Cloudflare R2': many });
		// First run: everything is keyword-filtered (no AI), recorded in skipped_items
		const r1 = await syncHackerNews(env);
		expect(r1).toMatchObject({ fetched: 250, filtered_keyword: 250, created: 0 });
		// Second run re-fetches from the cursor and must look up hundreds of known ids safely
		const r2 = await syncHackerNews(env);
		expect(r2.already_known).toBeGreaterThan(0);
		expect(env.AI.calls.text).toBe(0);
	});

	it('keeps the cursor when the HN API is down', async () => {
		globalThis.fetch = async () => new Response('boom', { status: 503 });
		const r = await syncHackerNews(env);
		expect(r.errors.length).toBe(2);
		expect(r.created).toBe(0);
		expect(env.DB._db.prepare('SELECT COUNT(*) AS n FROM sync_state').get().n).toBe(0);
	});

	it('is reachable via POST /sync/hackernews and /sync/all', async () => {
		mockHnFetch({ 'Cloudflare R2': [hnHit(1)] });
		env.GITHUB_REPOS = 'cloudflare/workers-sdk';
		const res = await worker.fetch(new Request('http://x/sync/hackernews', { method: 'POST' }), env);
		expect((await res.json()).created).toBe(1);

		const unknown = await worker.fetch(new Request('http://x/sync/twitter', { method: 'POST' }), env);
		expect(unknown.status).toBe(404);

		// /sync/all: GitHub gets HN's fake response shape and fails, but HN still runs
		const all = await (await worker.fetch(new Request('http://x/sync/all', { method: 'POST' }), env)).json();
		expect(all.hackernews).toBeDefined();
		expect(all.github).toBeDefined();
	});
});

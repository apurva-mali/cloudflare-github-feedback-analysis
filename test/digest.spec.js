import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index.js';
import { weekStartOf, generateDigest, weeklyDigest } from '../src/digest.js';
import { createFakeD1, createFakeAI, createFakeVectorize, insertFeedback } from './helpers/fakes.js';

const call = async (env, method, path, body) => {
	const res = await worker.fetch(new Request(`http://x${path}`, { method, body: body ? JSON.stringify(body) : undefined }), env);
	return { status: res.status, body: await res.json() };
};

describe('weekly digest', () => {
	let env;
	beforeEach(() => {
		env = { DB: createFakeD1(), AI: createFakeAI(), VECTOR_INDEX: createFakeVectorize() };
	});

	it('finds the Monday of a week in UTC', () => {
		expect(weekStartOf(new Date('2026-11-04T23:00:00Z'))).toBe('2026-11-02'); // Wednesday
		expect(weekStartOf(new Date('2026-11-02T00:00:00Z'))).toBe('2026-11-02'); // Monday
		expect(weekStartOf(new Date('2026-11-08T23:59:59Z'))).toBe('2026-11-02'); // Sunday
	});

	it('summarises each product with counts, change, urgent items, praise and themes', async () => {
		env.DB._db.exec("INSERT INTO themes (id, title, product, created_at, updated_at) VALUES (1, 'ETag mismatch', 'R2', '2026-11-03T00:00:00Z', '2026-11-03T00:00:00Z')");
		const wk = (d) => `2026-11-0${d}T12:00:00Z`;
		insertFeedback(env.DB, { id: 'r1', product_category: 'R2', sentiment_score: 2, urgency_level: 'High', feedback_timestamp: wk(3), theme_id: 1 });
		insertFeedback(env.DB, { id: 'r2', product_category: 'R2', sentiment_score: 3, feedback_timestamp: wk(4), theme_id: 1 });
		insertFeedback(env.DB, { id: 'r3', product_category: 'R2', sentiment_score: 9, feedback_timestamp: wk(5), title: 'Re: thread' });
		insertFeedback(env.DB, { id: 'r4', product_category: 'R2', sentiment_score: 9, feedback_timestamp: wk(5), feedback_status: 'Dismissed' });
		insertFeedback(env.DB, { id: 'w1', product_category: 'Workers', sentiment_score: 8, feedback_timestamp: wk(6) });
		insertFeedback(env.DB, { id: 'old', product_category: 'R2', sentiment_score: 9, feedback_timestamp: '2026-10-28T12:00:00Z' });
		insertFeedback(env.DB, { id: 'next', product_category: 'R2', sentiment_score: 1, feedback_timestamp: '2026-11-09T12:00:00Z' });

		const d = await generateDigest(env, '2026-11-02', new Date('2026-11-09T13:07:00Z'));
		expect(d).toMatchObject({ week_start: '2026-11-02', week_end: '2026-11-09', partial: false });
		expect(d.totals).toMatchObject({ count: 4, prev_count: 1, counts: { negative: 2, neutral: 0, positive: 2 }, index: 0, prev_index: 100, new_themes: 1 });

		const r2 = d.products[0];
		expect(r2).toMatchObject({ product: 'R2', count: 3, prev_count: 1, index: -33, prev_index: 100, summary: 'Developers mostly talked about uploads.' });
		expect(r2.urgent.map((x) => x.id)).toEqual(['r1', 'r2']);
		expect(r2.praise.map((x) => x.id)).toEqual(['r3']);
		expect(r2.praise[0].headline).toBe('Summary r3'); // HN reply shows what was said, not the thread
		expect(r2.themes).toEqual([{ id: 1, title: 'ETag mismatch', count: 2 }]);
		expect(d.products[1]).toMatchObject({ product: 'Workers', count: 1, prev_index: null });
	});

	it('cron writes last week; API lists weeks and throttles regeneration', async () => {
		insertFeedback(env.DB, { id: 'x', feedback_timestamp: '2026-11-03T12:00:00Z' });
		await weeklyDigest(env, new Date('2026-11-09T13:07:00Z'));
		let r = await call(env, 'GET', '/digests');
		expect(r.body.weeks).toEqual(['2026-11-02']);
		expect(r.body.digest.totals.count).toBe(1);

		r = await call(env, 'POST', '/digests/generate', { week: '2026-11-04' }); // just written → not rebuilt
		expect(r.body.regenerated).toBe(false);
		env.DB._db.exec("UPDATE digests SET created_at = '2026-01-01T00:00:00Z'");
		r = await call(env, 'POST', '/digests/generate', { week: '2026-11-04' });
		expect(r.body.regenerated).toBe(true);
		expect((await call(env, 'GET', '/digests?week=2099-01-05')).body.digest).toBeNull();
	});

	it('the Monday cron writes a digest instead of syncing', async () => {
		let synced = false;
		globalThis.fetch = async () => {
			synced = true;
			return new Response('[]');
		};
		const waits = [];
		await worker.scheduled({ cron: '7 13 * * 1' }, env, { waitUntil: (p) => waits.push(p) });
		await Promise.all(waits);
		expect(synced).toBe(false);
		expect(env.DB._db.prepare('SELECT COUNT(*) AS n FROM digests').get().n).toBe(1);
	});
});

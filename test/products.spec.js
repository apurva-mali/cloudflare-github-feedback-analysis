import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index.js';
import { refreshSummaries, staleProducts } from '../src/products.js';
import { createFakeD1, createFakeVectorize, createScriptedAI, insertFeedback } from './helpers/fakes.js';

describe('product summaries', () => {
	let env;
	beforeEach(() => {
		env = { DB: createFakeD1(), VECTOR_INDEX: createFakeVectorize(), AI: createScriptedAI([]) };
	});

	it('decides which summaries are stale', () => {
		const now = Date.parse('2026-11-05T12:00:00Z');
		const rows = (n) => Array.from({ length: n }, () => ({}));
		const byProduct = new Map([
			['R2', rows(5)],
			['D1', rows(3)],
			['KV', rows(1)], // too few items
			['Queues', rows(4)],
			['Pages', rows(2)],
		]);
		const cached = new Map([
			['D1', { item_count: 3, generated_at: '2026-11-05T11:00:00Z' }], // unchanged, fresh
			['Queues', { item_count: 3, generated_at: '2026-11-05T11:55:00Z' }], // changed but written 5 min ago
			['Pages', { item_count: 2, generated_at: '2026-11-03T11:00:00Z' }], // over a day old
		]);
		expect(staleProducts(byProduct, cached, now)).toEqual(['R2', 'Pages']);
	});

	it('writes summaries for busy products, skips Unknown and dismissed, and serves them', async () => {
		const recent = new Date().toISOString();
		for (let i = 0; i < 3; i++) insertFeedback(env.DB, { product_category: 'R2', feedback_timestamp: recent });
		insertFeedback(env.DB, { product_category: 'D1', feedback_timestamp: recent });
		insertFeedback(env.DB, { product_category: 'D1', feedback_timestamp: recent, feedback_status: 'Dismissed' });
		insertFeedback(env.DB, { product_category: 'Unknown', feedback_timestamp: recent });
		insertFeedback(env.DB, { product_category: 'Unknown', feedback_timestamp: recent });
		insertFeedback(env.DB, { product_category: 'Workers', feedback_timestamp: '2025-01-01T00:00:00Z' });
		insertFeedback(env.DB, { product_category: 'Workers', feedback_timestamp: '2025-01-01T00:00:00Z' });

		expect(await refreshSummaries(env)).toMatchObject({ written: 1 });
		expect(await refreshSummaries(env)).toMatchObject({ written: 0 }); // nothing changed

		const res = await worker.fetch(new Request('http://x/products/summaries'), env);
		const body = await res.json();
		expect(body.summaries).toEqual([expect.objectContaining({ product: 'R2', summary: 'Summary for R2', item_count: 3 })]);

		const refreshed = await worker.fetch(new Request('http://x/products/summaries/refresh', { method: 'POST' }), env);
		expect((await refreshed.json()).written).toBe(0);
	});
});

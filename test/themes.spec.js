import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index.js';
import { syncThemes, needsTitle, cosine } from '../src/themes.js';
import { createFakeD1, createFakeAI, createFakeVectorize, insertFeedback, fakeEmbed } from './helpers/fakes.js';

const call = async (env, method, path, body) => {
	const res = await worker.fetch(new Request(`http://x${path}`, { method, body: body ? JSON.stringify(body) : undefined }), env);
	return { status: res.status, body: await res.json() };
};

// GitHub items are compared by title + AI summary, so the meaning goes in the summary.
const ins = (db, o) => insertFeedback(db, { summary: o.original_text, ...o });

const ETAG = 'R2 multipart upload returns wrong ETag for completed object';
const COLD = 'Workers cold start latency spikes after deploy in region';

describe('themes', () => {
	let env;
	beforeEach(() => {
		env = { DB: createFakeD1(), AI: createFakeAI(), VECTOR_INDEX: createFakeVectorize(), THEME_SIMILARITY: '0.8' };
	});

	it('helpers behave', () => {
		expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
		expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
		expect(cosine(fakeEmbed(ETAG), fakeEmbed(`${ETAG} again`))).toBeGreaterThan(0.85);
		expect(cosine(fakeEmbed(ETAG), fakeEmbed(COLD))).toBeLessThan(0.5);
		expect(needsTitle({ title: null }, 2)).toBe(true);
		expect(needsTitle({ title: 'x', titled_at_count: 2 }, 2)).toBe(false);
		expect(needsTitle({ title: 'x', titled_at_count: 2 }, 3)).toBe(true);
		expect(needsTitle({ title: 'x', titled_at_count: 4 }, 5)).toBe(false);
		expect(needsTitle({ title: 'x', titled_at_count: 4 }, 6)).toBe(true);
	});

	it('groups similar items within a batch, leaves the rest alone, and titles the theme', async () => {
		ins(env.DB, { id: 'a', title: null, original_text: ETAG });
		ins(env.DB, { id: 'b', title: null, original_text: `${ETAG} again today` });
		ins(env.DB, { id: 'c', title: null, original_text: COLD });

		const r = await syncThemes(env);
		expect(r).toMatchObject({ checked: 3, new_themes: 1, retitled: 1, remaining: 0 });

		const rows = Object.fromEntries(env.DB._db.prepare('SELECT id, theme_id, theme_checked FROM feedback').all().map((x) => [x.id, x]));
		expect(rows.a.theme_id).toBeTruthy();
		expect(rows.b.theme_id).toBe(rows.a.theme_id);
		expect(rows.c.theme_id).toBeNull();
		expect(Object.values(rows).every((x) => x.theme_checked === 1)).toBe(true);

		const { body } = await call(env, 'GET', '/themes');
		expect(body.themes).toHaveLength(1);
		expect(body.themes[0]).toMatchObject({ title: 'Fake theme title', item_count: 2, product: 'R2' });
	});

	it('later items join an existing theme found through Vectorize, in small batches', async () => {
		ins(env.DB, { id: 'a', title: null, original_text: ETAG, feedback_timestamp: '2026-11-01T00:00:00Z' });
		ins(env.DB, { id: 'b', title: null, original_text: `${ETAG} again`, feedback_timestamp: '2026-11-02T00:00:00Z' });
		await syncThemes(env);

		ins(env.DB, { id: 'c', title: null, original_text: `Still: ${ETAG}`, feedback_timestamp: '2026-11-03T00:00:00Z' });
		ins(env.DB, { id: 'd', title: null, original_text: COLD, feedback_timestamp: '2026-11-03T01:00:00Z' });
		const r = await syncThemes(env, { maxNew: 1 }); // backfill-style partial batch
		expect(r).toMatchObject({ checked: 1, joined: 1, remaining: 1 });
		const theme = env.DB._db.prepare("SELECT theme_id FROM feedback WHERE id = 'a'").get().theme_id;
		expect(env.DB._db.prepare("SELECT theme_id FROM feedback WHERE id = 'c'").get().theme_id).toBe(theme);
		expect(r.retitled).toBe(1); // grew from 2 to 3

		const r2 = await syncThemes(env);
		expect(r2).toMatchObject({ checked: 1, joined: 0, new_themes: 0, remaining: 0 });
		expect((await syncThemes(env)).checked).toBe(0);
	});

	it('a ticket for a theme moves every member, but never dismissed ones', async () => {
		ins(env.DB, { id: 'a', title: null, original_text: ETAG });
		ins(env.DB, { id: 'b', title: null, original_text: `${ETAG} again` });
		ins(env.DB, { id: 'c', title: null, original_text: `${ETAG} once more`, feedback_status: 'Dismissed', dismissed_reason: 'Duplicate' });
		await syncThemes(env);
		const themeId = env.DB._db.prepare("SELECT theme_id FROM feedback WHERE id = 'a'").get().theme_id;

		const created = await call(env, 'POST', '/tickets', { feedback_id: 'a', theme_id: themeId, title: 'Fix ETags', priority: 'P1' });
		expect(created.status).toBe(201);
		expect(created.body.ticket).toMatchObject({ theme_id: themeId, theme_title: 'Fake theme title', theme_size: 3 });
		expect((await call(env, 'POST', '/tickets', { feedback_id: 'b', theme_id: themeId, title: 'again' })).status).toBe(409);

		const status = () => Object.fromEntries(env.DB._db.prepare('SELECT id, feedback_status FROM feedback').all().map((x) => [x.id, x.feedback_status]));
		expect(status()).toEqual({ a: 'Ticket Raised', b: 'Ticket Raised', c: 'Dismissed' });

		const all = await call(env, 'GET', '/all');
		const b = all.body.results.find((r) => r.id === 'b');
		expect(b).toMatchObject({ ticket_id: created.body.ticket.id, ticket_via_theme: 1 });

		await call(env, 'PATCH', `/tickets/${created.body.ticket.id}`, { status: 'Resolved' });
		expect(status()).toEqual({ a: 'Resolved', b: 'Resolved', c: 'Dismissed' });
		expect((await call(env, 'GET', '/themes')).body.themes[0]).toMatchObject({ ticket_status: 'Resolved' });
	});

	it('runs last in /sync/all so freshly ingested items get themed', async () => {
		globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
		ins(env.DB, { id: 'a', original_text: ETAG });
		const r = await call(env, 'POST', '/sync/all');
		expect(Object.keys(r.body)).toEqual(['github', 'hackernews', 'themes']);
		expect(r.body.themes.checked).toBe(1);
	});
});

describe('what gets embedded', () => {
	it('ignores HN thread titles and GitHub issue-template bodies', async () => {
		const { embeddingTextFor } = await import('../src/pipeline.js');
		const hn = embeddingTextFor({ source: 'Hacker News', title: 'Re: Ask HN: Which serverless platform?', summary: 'Loves R2 pricing', original_text: 'R2 egress is free' });
		expect(hn).not.toContain('Ask HN');
		expect(hn).toContain('R2 egress is free');
		const gh = embeddingTextFor({ source: 'GitHub', repo: 'cloudflare/workers-sdk', title: 'D1 drops statements', summary: 'Batch loses writes', original_text: '### What versions are you using?\nSteps to reproduce' });
		expect(gh).toBe('D1 drops statements\nBatch loses writes');
	});

	it('two comments in the same HN thread about different things do not form a theme', async () => {
		const env = { DB: createFakeD1(), AI: createFakeAI(), VECTOR_INDEX: createFakeVectorize(), THEME_SIMILARITY: '0.8' };
		const thread = 'Re: Ask HN: Which serverless platform are you using in 2026 and why?';
		insertFeedback(env.DB, { id: 'x', source: 'Hacker News', title: thread, summary: 'Praises R2 egress pricing', original_text: 'R2 egress pricing saved us money' });
		insertFeedback(env.DB, { id: 'y', source: 'Hacker News', title: thread, summary: 'Complains about dashboard speed', original_text: 'The dashboard is slow to load settings' });
		const r = await syncThemes(env);
		expect(r.new_themes).toBe(0);
	});
});

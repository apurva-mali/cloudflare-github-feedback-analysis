import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index.js';
import { createFakeD1, createFakeAI, createFakeVectorize, insertFeedback } from './helpers/fakes.js';

const req = (method, path, body) =>
	new Request(`http://x${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const call = async (env, method, path, body) => {
	const res = await worker.fetch(req(method, path, body), env);
	return { status: res.status, body: await res.json() };
};

describe('triage actions', () => {
	let env;
	beforeEach(() => {
		env = { DB: createFakeD1(), AI: createFakeAI(), VECTOR_INDEX: createFakeVectorize() };
		insertFeedback(env.DB, { id: 'bug1', sentiment_score: 2 });
		insertFeedback(env.DB, { id: 'love1', sentiment_score: 9, source: 'Hacker News', title: 'Re: Ask HN' });
	});

	it('stars, reviews, highlights and marks replied', async () => {
		let r = await call(env, 'PATCH', '/feedback/love1', { starred: true });
		expect(r.body.feedback).toMatchObject({ starred: 1, reviewed_at: null });

		r = await call(env, 'PATCH', '/feedback/love1', { highlight_tags: ['Customer story', ' Launch quote ', 'Customer story', ''] });
		expect(JSON.parse(r.body.feedback.highlight_tags)).toEqual(['Customer story', 'Launch quote']);
		expect(r.body.feedback.reviewed_at).toBeTruthy(); // saving praise takes it out of the inbox

		r = await call(env, 'PATCH', '/feedback/love1', { highlight_tags: [] });
		expect(r.body.feedback.highlight_tags).toBeNull();

		r = await call(env, 'PATCH', '/feedback/bug1', { responded: true });
		expect(r.body.feedback.responded_at).toBeTruthy();
		r = await call(env, 'PATCH', '/feedback/bug1', { reviewed: true });
		expect(r.body.feedback.reviewed_at).toBeTruthy();
		r = await call(env, 'PATCH', '/feedback/bug1', { reviewed: false });
		expect(r.body.feedback.reviewed_at).toBeNull();
	});

	it('dismisses with a reason, and reopening clears it', async () => {
		expect((await call(env, 'PATCH', '/feedback/bug1', { feedback_status: 'Dismissed' })).status).toBe(400);
		let r = await call(env, 'PATCH', '/feedback/bug1', { feedback_status: 'Dismissed', dismissed_reason: 'Duplicate' });
		expect(r.body.feedback).toMatchObject({ feedback_status: 'Dismissed', dismissed_reason: 'Duplicate' });
		expect(r.body.feedback.reviewed_at).toBeTruthy();
		r = await call(env, 'PATCH', '/feedback/bug1', { feedback_status: 'Open' });
		expect(r.body.feedback).toMatchObject({ feedback_status: 'Open', dismissed_reason: null });
	});

	it('rejects bad input', async () => {
		expect((await call(env, 'PATCH', '/feedback/bug1', {})).status).toBe(400);
		expect((await call(env, 'PATCH', '/feedback/bug1', { starred: 'yes' })).status).toBe(400);
		expect((await call(env, 'PATCH', '/feedback/bug1', { highlight_tags: 'x' })).status).toBe(400);
		expect((await call(env, 'PATCH', '/feedback/bug1', { feedback_status: 'Done' })).status).toBe(400);
		expect((await call(env, 'PATCH', '/feedback/nope', { starred: true })).status).toBe(404);
	});

	it('bulk-marks a backlog as reviewed', async () => {
		const ids = ['bug1', 'love1', 'missing'];
		const r = await call(env, 'POST', '/feedback/bulk', { ids, changes: { reviewed: true } });
		expect(r.body.updated).toBe(2);
		expect((await call(env, 'POST', '/feedback/bulk', { ids: [], changes: { reviewed: true } })).status).toBe(400);
		expect((await call(env, 'POST', '/feedback/bulk', { ids: Array.from({ length: 201 }, (_, i) => `x${i}`), changes: { reviewed: true } })).status).toBe(400);
	});

	it('adds, lists and deletes notes; /all reports the count', async () => {
		expect((await call(env, 'POST', '/feedback/bug1/notes', { body: '  ' })).status).toBe(400);
		expect((await call(env, 'POST', '/feedback/nope/notes', { body: 'x' })).status).toBe(404);
		const added = await call(env, 'POST', '/feedback/bug1/notes', { body: 'Asked the R2 team', author: 'Apurva' });
		expect(added.status).toBe(201);
		await call(env, 'POST', '/feedback/bug1/notes', { body: 'Repro confirmed' });

		const list = await call(env, 'GET', '/feedback/bug1/notes');
		expect(list.body.notes.map((n) => n.body)).toEqual(['Asked the R2 team', 'Repro confirmed']);

		let all = await call(env, 'GET', '/all');
		expect(all.body.results.find((r) => r.id === 'bug1').notes_count).toBe(2);

		await call(env, 'DELETE', `/notes/${added.body.note.id}`);
		all = await call(env, 'GET', '/all');
		expect(all.body.results.find((r) => r.id === 'bug1').notes_count).toBe(1);
		expect((await call(env, 'DELETE', '/notes/999')).status).toBe(404);
	});

	it('/all still works on a database that has not run migration 0003', async () => {
		env.DB._db.exec('DROP TABLE feedback_notes');
		const all = await call(env, 'GET', '/all');
		expect(all.status).toBe(200);
		expect(all.body.total).toBe(2);
	});
});

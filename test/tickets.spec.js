import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index.js';
import { createFakeD1, createFakeAI, createFakeVectorize } from './helpers/fakes.js';

const req = (method, path, body) =>
	new Request(`http://x${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

describe('support tickets', () => {
	let env;
	let feedbackId;

	beforeEach(async () => {
		env = { DB: createFakeD1(), AI: createFakeAI({ product_category: 'R2' }), VECTOR_INDEX: createFakeVectorize() };
		const res = await worker.fetch(req('POST', '/ingest', { text: 'R2 uploads time out from our CI', source: 'Manual' }), env);
		feedbackId = (await res.json()).id;
	});

	it('raises a ticket, links it to the feedback, and syncs status both ways', async () => {
		const created = await worker.fetch(
			req('POST', '/tickets', { feedback_id: feedbackId, title: 'R2 uploads time out', priority: 'P1', team: 'R2', assignee: 'Apurva' }),
			env
		);
		expect(created.status).toBe(201);
		const { ticket } = await created.json();
		expect(ticket).toMatchObject({ id: 1, status: 'Open', priority: 'P1', team: 'R2', source: 'Manual', product_category: 'R2' });

		let all = await (await worker.fetch(req('GET', '/all'), env)).json();
		expect(all.results[0]).toMatchObject({ feedback_status: 'Ticket Raised', ticket_id: 1, ticket_status: 'Open' });

		// One ticket per feedback
		const dup = await worker.fetch(req('POST', '/tickets', { feedback_id: feedbackId, title: 'again' }), env);
		expect(dup.status).toBe(409);

		// Resolving the ticket resolves the feedback; reopening puts it back
		await worker.fetch(req('PATCH', '/tickets/1', { status: 'Resolved' }), env);
		all = await (await worker.fetch(req('GET', '/all'), env)).json();
		expect(all.results[0]).toMatchObject({ feedback_status: 'Resolved', ticket_status: 'Resolved' });

		await worker.fetch(req('PATCH', '/tickets/1', { status: 'In Progress', assignee: 'Sam' }), env);
		const list = await (await worker.fetch(req('GET', '/tickets'), env)).json();
		expect(list.tickets[0]).toMatchObject({ status: 'In Progress', assignee: 'Sam' });
		all = await (await worker.fetch(req('GET', '/all'), env)).json();
		expect(all.results[0].feedback_status).toBe('Ticket Raised');
	});

	it('validates input', async () => {
		expect((await worker.fetch(req('POST', '/tickets', { title: 'x' }), env)).status).toBe(400);
		expect((await worker.fetch(req('POST', '/tickets', { feedback_id: feedbackId }), env)).status).toBe(400);
		expect((await worker.fetch(req('POST', '/tickets', { feedback_id: feedbackId, title: 'x', priority: 'urgent' }), env)).status).toBe(400);
		expect((await worker.fetch(req('POST', '/tickets', { feedback_id: 'nope', title: 'x' }), env)).status).toBe(404);
		expect((await worker.fetch(req('PATCH', '/tickets/99', { status: 'Resolved' }), env)).status).toBe(404);
		await worker.fetch(req('POST', '/tickets', { feedback_id: feedbackId, title: 'x' }), env);
		expect((await worker.fetch(req('PATCH', '/tickets/1', { status: 'Done' }), env)).status).toBe(400);
		expect((await worker.fetch(req('PATCH', '/tickets/1', {}), env)).status).toBe(400);
	});

	it('still serves /all on a database without the tickets table', async () => {
		env.DB._db.exec('DROP TABLE tickets');
		const res = await worker.fetch(req('GET', '/all'), env);
		expect(res.status).toBe(200);
		expect((await res.json()).total).toBe(1);
	});
});

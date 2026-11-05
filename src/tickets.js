/**
 * Support tickets raised from feedback.
 *
 * One ticket per feedback item. A ticket can also cover a whole theme
 * (theme_id), in which case its status applies to every member of the theme.
 * Ticket status drives the feedback's PM status:
 *   ticket Open / In Progress  → feedback "Ticket Raised"
 *   ticket Resolved            → feedback "Resolved"
 * Dismissed feedback is never touched.
 */

import { json } from './http.js';

export const TICKET_STATUSES = ['Open', 'In Progress', 'Resolved'];
export const TICKET_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

const MAX = { title: 200, description: 5000, team: 80, assignee: 120 };

function feedbackStatusFor(ticketStatus) {
	return ticketStatus === 'Resolved' ? 'Resolved' : 'Ticket Raised';
}

function cleanText(value, max) {
	if (value == null) return null;
	const s = String(value).trim();
	return s ? s.slice(0, max) : null;
}

const SELECT_TICKETS = `
	SELECT t.*, f.source, f.source_url, f.product_category, f.sentiment_score, f.urgency_level,
	       f.summary AS feedback_summary, f.title AS feedback_title, f.responded_at AS reporter_responded_at,
	       th.title AS theme_title,
	       (SELECT COUNT(*) FROM feedback m WHERE t.theme_id IS NOT NULL AND m.theme_id = t.theme_id) AS theme_size
	FROM tickets t
	LEFT JOIN feedback f ON f.id = t.feedback_id
	LEFT JOIN themes th ON th.id = t.theme_id`;

/** Statements that move the ticket's feedback (and theme members) to match the ticket status. */
function propagateStatus(env, ticket, ticketStatus, now) {
	const status = feedbackStatusFor(ticketStatus);
	const stmts = [
		env.DB.prepare(`UPDATE feedback SET feedback_status = ?, reviewed_at = COALESCE(reviewed_at, ?) WHERE id = ? AND feedback_status != 'Dismissed'`).bind(
			status,
			now,
			ticket.feedback_id
		),
	];
	if (ticket.theme_id) {
		stmts.push(
			env.DB.prepare(
				`UPDATE feedback SET feedback_status = ?, reviewed_at = COALESCE(reviewed_at, ?)
				 WHERE theme_id = ? AND feedback_status IN ('Open', 'Ticket Raised', 'Resolved')`
			).bind(status, now, ticket.theme_id)
		);
	}
	return stmts;
}

export async function listTickets(env) {
	const { results } = await env.DB.prepare(`${SELECT_TICKETS} ORDER BY t.id DESC`).all();
	return json({ tickets: results, total: results.length });
}

export async function createTicket(request, env) {
	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Request body must be JSON' }, 400);

	const feedbackId = cleanText(body.feedback_id, 64);
	const title = cleanText(body.title, MAX.title);
	const priority = body.priority || 'P2';
	if (!feedbackId) return json({ error: '"feedback_id" is required' }, 400);
	if (!title) return json({ error: '"title" is required' }, 400);
	if (!TICKET_PRIORITIES.includes(priority)) return json({ error: `"priority" must be one of ${TICKET_PRIORITIES.join(', ')}` }, 400);

	const feedback = await env.DB.prepare('SELECT id FROM feedback WHERE id = ?').bind(feedbackId).first();
	if (!feedback) return json({ error: 'Feedback not found' }, 404);

	let themeId = null;
	if (body.theme_id != null) {
		themeId = Number(body.theme_id);
		const theme = Number.isInteger(themeId) ? await env.DB.prepare('SELECT id FROM themes WHERE id = ?').bind(themeId).first() : null;
		if (!theme) return json({ error: 'Theme not found' }, 404);
		const themeTicket = await env.DB.prepare('SELECT id FROM tickets WHERE theme_id = ?').bind(themeId).first();
		if (themeTicket) return json({ error: `This theme already has ticket CV-${themeTicket.id}`, ticket_id: themeTicket.id }, 409);
	}

	const existing = await env.DB.prepare('SELECT id FROM tickets WHERE feedback_id = ?').bind(feedbackId).first();
	if (existing) return json({ error: `This feedback already has ticket CV-${existing.id}`, ticket_id: existing.id }, 409);

	const now = new Date().toISOString();
	const insert = await env.DB.prepare(
		`INSERT INTO tickets (feedback_id, title, description, priority, team, assignee, status, created_at, updated_at, theme_id)
		 VALUES (?, ?, ?, ?, ?, ?, 'Open', ?, ?, ?)`
	)
		.bind(
			feedbackId,
			title,
			cleanText(body.description, MAX.description),
			priority,
			cleanText(body.team, MAX.team),
			cleanText(body.assignee, MAX.assignee),
			now,
			now,
			themeId
		)
		.run();
	const id = insert.meta?.last_row_id;

	await env.DB.batch(propagateStatus(env, { feedback_id: feedbackId, theme_id: themeId }, 'Open', now));

	const ticket = await env.DB.prepare(`${SELECT_TICKETS} WHERE t.id = ?`).bind(id).first();
	return json({ ticket }, 201);
}

export async function updateTicket(id, request, env) {
	const body = await request.json().catch(() => null);
	if (!body) return json({ error: 'Request body must be JSON' }, 400);

	const ticket = await env.DB.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
	if (!ticket) return json({ error: 'Ticket not found' }, 404);

	const updates = {};
	if (body.status !== undefined) {
		if (!TICKET_STATUSES.includes(body.status)) return json({ error: `"status" must be one of ${TICKET_STATUSES.join(', ')}` }, 400);
		updates.status = body.status;
	}
	if (body.priority !== undefined) {
		if (!TICKET_PRIORITIES.includes(body.priority)) return json({ error: `"priority" must be one of ${TICKET_PRIORITIES.join(', ')}` }, 400);
		updates.priority = body.priority;
	}
	for (const field of ['title', 'description', 'team', 'assignee']) {
		if (body[field] !== undefined) updates[field] = cleanText(body[field], MAX[field]);
	}
	if ('title' in updates && !updates.title) return json({ error: '"title" cannot be empty' }, 400);
	if (!Object.keys(updates).length) return json({ error: 'Nothing to update' }, 400);

	updates.updated_at = new Date().toISOString();
	const cols = Object.keys(updates);
	const stmts = [
		env.DB.prepare(`UPDATE tickets SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map((c) => updates[c]), id),
	];
	if (updates.status) stmts.push(...propagateStatus(env, ticket, updates.status, updates.updated_at));
	await env.DB.batch(stmts);

	const updated = await env.DB.prepare(`${SELECT_TICKETS} WHERE t.id = ?`).bind(id).first();
	return json({ ticket: updated });
}

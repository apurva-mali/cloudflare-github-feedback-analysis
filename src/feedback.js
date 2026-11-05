/**
 * Triage actions on feedback items: status, star, reviewed, dismiss,
 * highlights (praise library), replied-upstream, and internal notes.
 */

import { json } from './http.js';

export const FEEDBACK_STATUSES = ['Open', 'Ticket Raised', 'Resolved', 'Dismissed'];
export const DISMISS_REASONS = ['Duplicate', 'Not actionable', 'Off-topic', 'Spam', 'Other'];
const MAX_TAGS = 6;
const MAX_TAG_LEN = 40;
const MAX_NOTE_LEN = 4000;
const MAX_BULK = 200;

/**
 * Turn a PATCH body into column updates. Returns { updates } or { error }.
 * Supported fields:
 *   feedback_status   one of FEEDBACK_STATUSES
 *   dismissed_reason  required with "Dismissed" (one of DISMISS_REASONS)
 *   starred           boolean
 *   reviewed          boolean   (true = leave the inbox)
 *   highlight_tags    string[]  ([] removes from Highlights)
 *   responded         boolean   (someone replied to the author upstream)
 */
export function parseChanges(body, now = new Date().toISOString()) {
	if (!body || typeof body !== 'object') return { error: 'Request body must be a JSON object' };
	const u = {};

	if (body.feedback_status !== undefined) {
		if (!FEEDBACK_STATUSES.includes(body.feedback_status)) {
			return { error: `feedback_status must be one of: ${FEEDBACK_STATUSES.join(', ')}` };
		}
		u.feedback_status = body.feedback_status;
		if (body.feedback_status === 'Dismissed') {
			if (!DISMISS_REASONS.includes(body.dismissed_reason)) {
				return { error: `dismissed_reason must be one of: ${DISMISS_REASONS.join(', ')}` };
			}
			u.dismissed_reason = body.dismissed_reason;
		} else {
			u.dismissed_reason = null;
		}
		// Any decision about an item takes it out of the inbox.
		if (body.feedback_status !== 'Open') u.reviewed_at = now;
	}
	if (body.starred !== undefined) {
		if (typeof body.starred !== 'boolean') return { error: 'starred must be true or false' };
		u.starred = body.starred ? 1 : 0;
	}
	if (body.reviewed !== undefined) {
		if (typeof body.reviewed !== 'boolean') return { error: 'reviewed must be true or false' };
		u.reviewed_at = body.reviewed ? now : null;
	}
	if (body.highlight_tags !== undefined) {
		if (!Array.isArray(body.highlight_tags)) return { error: 'highlight_tags must be an array of strings' };
		const tags = [...new Set(body.highlight_tags.map((t) => String(t).trim().slice(0, MAX_TAG_LEN)).filter(Boolean))].slice(0, MAX_TAGS);
		u.highlight_tags = tags.length ? JSON.stringify(tags) : null;
		if (tags.length) u.reviewed_at = now;
	}
	if (body.responded !== undefined) {
		if (typeof body.responded !== 'boolean') return { error: 'responded must be true or false' };
		u.responded_at = body.responded ? now : null;
	}
	if (!Object.keys(u).length) return { error: 'Nothing to update' };
	return { updates: u };
}

function updateStatement(env, id, updates) {
	const cols = Object.keys(updates);
	return env.DB.prepare(`UPDATE feedback SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map((c) => updates[c]), id);
}

export async function updateFeedback(id, request, env) {
	const body = await request.json().catch(() => null);
	const { updates, error } = parseChanges(body);
	if (error) return json({ error }, 400);

	const res = await updateStatement(env, id, updates).run();
	if (!res.meta?.changes) return json({ error: 'Feedback not found' }, 404);
	const row = await env.DB.prepare('SELECT * FROM feedback WHERE id = ?').bind(id).first();
	return json({ feedback: row });
}

/** POST /feedback/bulk  { ids: [...], changes: {...} } — e.g. mark a backlog reviewed. */
export async function bulkUpdateFeedback(request, env) {
	const body = await request.json().catch(() => null);
	const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(String))] : [];
	if (!ids.length) return json({ error: '"ids" must be a non-empty array' }, 400);
	if (ids.length > MAX_BULK) return json({ error: `At most ${MAX_BULK} ids per request` }, 400);
	const { updates, error } = parseChanges(body.changes);
	if (error) return json({ error }, 400);

	const results = await env.DB.batch(ids.map((id) => updateStatement(env, id, updates)));
	const updated = results.reduce((n, r) => n + (r.meta?.changes || 0), 0);
	return json({ updated });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function listNotes(feedbackId, env) {
	const { results } = await env.DB.prepare('SELECT * FROM feedback_notes WHERE feedback_id = ? ORDER BY id ASC').bind(feedbackId).all();
	return json({ notes: results });
}

export async function addNote(feedbackId, request, env) {
	const body = await request.json().catch(() => null);
	const text = typeof body?.body === 'string' ? body.body.trim().slice(0, MAX_NOTE_LEN) : '';
	if (!text) return json({ error: 'Note text is required' }, 400);
	const author = typeof body.author === 'string' ? body.author.trim().slice(0, 80) || null : null;

	const exists = await env.DB.prepare('SELECT id FROM feedback WHERE id = ?').bind(feedbackId).first();
	if (!exists) return json({ error: 'Feedback not found' }, 404);

	const now = new Date().toISOString();
	const res = await env.DB.prepare('INSERT INTO feedback_notes (feedback_id, body, author, created_at) VALUES (?, ?, ?, ?)')
		.bind(feedbackId, text, author, now)
		.run();
	return json({ note: { id: res.meta?.last_row_id, feedback_id: feedbackId, body: text, author, created_at: now } }, 201);
}

export async function deleteNote(noteId, env) {
	const res = await env.DB.prepare('DELETE FROM feedback_notes WHERE id = ?').bind(noteId).run();
	if (!res.meta?.changes) return json({ error: 'Note not found' }, 404);
	return json({ deleted: noteId });
}

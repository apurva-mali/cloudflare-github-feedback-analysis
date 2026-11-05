/**
 * Re-check stored feedback for being about Cloudflare.
 *
 * New items are checked during ingestion. This job covers items stored before
 * the check existed (relevance_checked = 0) and items whose AI analysis failed.
 * Anything not about Cloudflare is removed from the dashboard and search, and
 * remembered in skipped_items so the sync never brings it back.
 * Items someone has already acted on (ticket, notes, highlight, star) are kept
 * and dismissed as off-topic instead, so no one's work disappears.
 */

import { checkAboutCloudflare } from './pipeline.js';

const DEFAULT_BATCH = 25;

export async function syncRelevance(env, { maxNew } = {}) {
	const limit = Number(maxNew) || Number(env.RELEVANCE_BATCH) || DEFAULT_BATCH;
	const result = { source: 'relevance', checked: 0, removed: 0, dismissed: 0, kept: 0, failed: 0, remaining: 0 };

	const { results: rows } = await env.DB.prepare(
		`SELECT f.id, f.external_id, f.source, f.repo, f.title, f.original_text, f.starred, f.highlight_tags,
		        (SELECT COUNT(*) FROM tickets t WHERE t.feedback_id = f.id) AS tickets,
		        (SELECT COUNT(*) FROM feedback_notes n WHERE n.feedback_id = f.id) AS notes
		 FROM feedback f WHERE f.relevance_checked = 0 AND f.feedback_status != 'Dismissed'
		 ORDER BY f.feedback_timestamp DESC LIMIT ?`
	)
		.bind(limit)
		.all();

	const writes = [];
	const toDelete = [];
	const now = new Date().toISOString();

	for (const row of rows) {
		const context =
			row.source === 'GitHub'
				? `Source: GitHub issue in ${row.repo || 'a Cloudflare repository'}.`
				: `Source: ${row.source}${row.title?.startsWith('Re: ') ? ` comment in the thread "${row.title.slice(4)}"` : ''}.`;
		const verdict = await checkAboutCloudflare(env, row.title && !row.title.startsWith('Re: ') ? `${row.title}\n\n${row.original_text}` : row.original_text, context);
		result.checked++;

		if (!verdict) {
			result.failed++; // leave unchecked; try again next run
			continue;
		}
		if (verdict.about_cloudflare) {
			result.kept++;
			writes.push(env.DB.prepare('UPDATE feedback SET relevance_checked = 1, subject = COALESCE(subject, ?) WHERE id = ?').bind(verdict.subject, row.id));
			continue;
		}

		const actedOn = row.tickets > 0 || row.notes > 0 || row.starred || row.highlight_tags;
		if (actedOn) {
			result.dismissed++;
			writes.push(
				env.DB.prepare(
					`UPDATE feedback SET relevance_checked = 1, subject = ?, feedback_status = CASE WHEN ? > 0 THEN feedback_status ELSE 'Dismissed' END,
					 dismissed_reason = CASE WHEN ? > 0 THEN dismissed_reason ELSE 'Off-topic' END, reviewed_at = COALESCE(reviewed_at, ?) WHERE id = ?`
				).bind(verdict.subject, row.tickets, row.tickets, now, row.id)
			);
		} else {
			result.removed++;
			toDelete.push(row.id);
			writes.push(env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(row.id));
			if (row.external_id) {
				writes.push(
					env.DB.prepare('INSERT OR IGNORE INTO skipped_items (external_id, reason, skipped_at) VALUES (?, ?, ?)').bind(
						row.external_id,
						`not_about_cloudflare:${verdict.subject || 'other'}`.slice(0, 120),
						now
					)
				);
			}
		}
	}

	if (writes.length) await env.DB.batch(writes);
	if (toDelete.length) {
		try {
			await env.VECTOR_INDEX.deleteByIds(toDelete);
		} catch (err) {
			console.error('Removing vectors failed (search may show stale matches until re-indexed):', err?.message || err);
		}
	}

	const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE relevance_checked = 0 AND feedback_status != 'Dismissed'").first();
	result.remaining = n;
	return result;
}

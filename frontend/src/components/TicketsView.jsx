import { useEffect, useMemo, useState } from 'react';
import { MessageSquareReply } from 'lucide-react';
import { EmptyState, SourceTag } from './bits.jsx';
import { PRIORITIES, TICKET_STATUSES, fullDate, ticketKey, timeAgo } from '../lib/format.js';
import { useBreakpoint } from '../lib/useBreakpoint.js';

// Keyed by the saved assignee in the parent, so it resets when the server value changes.
function AssigneeInput({ ticket, onSave }) {
  const [value, setValue] = useState(ticket.assignee || '');
  const commit = () => {
    if ((ticket.assignee || '') !== value.trim()) onSave({ assignee: value.trim() });
  };
  return (
    <input
      className="inline-input"
      value={value}
      placeholder="Unassigned"
      aria-label={`Assignee for ${ticketKey(ticket.id)}`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Resolved, the reporter can be replied to, and nobody has yet. */
const needsReplyTicket = (t) => t.status === 'Resolved' && t.source_url && !t.reporter_responded_at;

export default function TicketsView({ tickets, unavailable, focusId, onUpdate, onOpenFeedback }) {
  const bp = useBreakpoint();
  const wide = bp === 'lg';
  const showTeam = bp !== 'sm';
  // The parent remounts this view (key) when asked to focus a ticket, so a
  // resolved ticket being focused starts on "All" instead of hidden.
  const [status, setStatus] = useState(() => (tickets.find((t) => t.id === focusId)?.status === 'Resolved' ? 'All' : 'Active'));

  const counts = useMemo(() => {
    const c = { Active: 0, All: tickets.length, Reply: 0 };
    for (const s of TICKET_STATUSES) c[s] = 0;
    for (const t of tickets) {
      c[t.status] = (c[t.status] || 0) + 1;
      if (t.status !== 'Resolved') c.Active++;
      if (needsReplyTicket(t)) c.Reply++;
    }
    return c;
  }, [tickets]);

  const rows = useMemo(() => {
    if (status === 'All') return tickets;
    if (status === 'Active') return tickets.filter((t) => t.status !== 'Resolved');
    if (status === 'Reply') return tickets.filter(needsReplyTicket);
    return tickets.filter((t) => t.status === status);
  }, [tickets, status]);

  useEffect(() => {
    if (!focusId) return;
    requestAnimationFrame(() => document.getElementById(`ticket-${focusId}`)?.scrollIntoView({ block: 'center' }));
  }, [focusId]);

  if (unavailable) {
    return (
      <EmptyState title="Tickets aren't set up on this database yet">
        Run <code>npm run db:migrate</code> in the project folder, then refresh this page.
      </EmptyState>
    );
  }

  return (
    <div className="tickets-view">
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Ticket status">
          {['Active', ...TICKET_STATUSES, 'Reply', 'All'].map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s === 'Active' ? 'Not resolved' : s === 'Reply' ? 'Author not told' : s} <span className="seg-count">{counts[s] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={tickets.length ? 'No tickets with this status' : 'No tickets yet'}>
          {tickets.length
            ? 'Pick another status above.'
            : 'Open any item in the Feedback tab and choose Raise ticket. It will show up here with its priority, team and assignee.'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="data-table tickets-table">
            <colgroup>
              <col className="c-ticket" />
              {showTeam && <col className="c-team" />}
              <col className="c-priority" />
              {wide && <col className="c-assignee" />}
              <col className="c-tstatus" />
              {wide && <col className="c-updated" />}
            </colgroup>
            <thead>
              <tr>
                <th>Ticket</th>
                {showTeam && <th>Team</th>}
                <th>Priority</th>
                {wide && <th>Assignee</th>}
                <th>Status</th>
                {wide && <th>Updated</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} id={`ticket-${t.id}`} className={t.id === focusId ? 'selected' : ''}>
                  <td className="cell-feedback">
                    <button type="button" className="ticket-title" onClick={() => onOpenFeedback(t.feedback_id)}>
                      <span className="ticket-key">{ticketKey(t.id)}</span>
                      <span className="fb-title">{t.title}</span>
                    </button>
                    <span className="fb-sub">
                      {t.source && <SourceTag source={t.source} />}
                      <span title={fullDate(t.created_at)}>Raised {timeAgo(t.created_at)}</span>
                      {needsReplyTicket(t) && (
                        <button type="button" className="mini-flag as-btn" onClick={() => onOpenFeedback(t.feedback_id)}>
                          <MessageSquareReply size={12} aria-hidden="true" /> Tell the author
                        </button>
                      )}
                    </span>
                  </td>
                  {showTeam && <td>{t.team || <span className="muted">None</span>}</td>}
                  <td>
                    <select
                      className={`inline-select priority ${t.priority.toLowerCase()}`}
                      value={t.priority}
                      aria-label={`Priority for ${ticketKey(t.id)}`}
                      onChange={(e) => onUpdate(t.id, { priority: e.target.value })}
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.key}
                        </option>
                      ))}
                    </select>
                  </td>
                  {wide && (
                  <td>
                    <AssigneeInput key={t.assignee || ''} ticket={t} onSave={(changes) => onUpdate(t.id, changes)} />
                  </td>
                  )}
                  <td>
                    <select
                      className={`inline-select status ${t.status === 'Resolved' ? 'done' : t.status === 'In Progress' ? 'progress' : ''}`}
                      value={t.status}
                      aria-label={`Status for ${ticketKey(t.id)}`}
                      onChange={(e) => onUpdate(t.id, { status: e.target.value })}
                    >
                      {TICKET_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  {wide && (
                    <td className="cell-date" title={fullDate(t.updated_at)}>
                      {timeAgo(t.updated_at)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

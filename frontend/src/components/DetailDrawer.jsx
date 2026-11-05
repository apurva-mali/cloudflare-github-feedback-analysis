import { useEffect, useRef } from 'react';
import { CircleCheck, ExternalLink, MessageSquare, RotateCcw, ThumbsUp, Ticket, X } from 'lucide-react';
import { PriorityTag, SentimentTag, SourceTag, UrgencyTag } from './bits.jsx';
import { fullDate, ticketKey, timeAgo } from '../lib/format.js';

function linkLabel(item) {
  if (item.source === 'GitHub') return item.repo ? `Open issue in ${item.repo}` : 'Open on GitHub';
  if (item.source === 'Hacker News') return 'Open on Hacker News';
  return 'Open original';
}

export default function DetailDrawer({ item, onClose, onRaiseTicket, onSetStatus, onViewTicket, busy }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!item) return;
    closeRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;

  const engagement = item.source === 'Hacker News' ? 'points' : 'reactions';

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-head">
          <div className="drawer-source">
            <SourceTag source={item.source} />
            <span className="muted" title={fullDate(item.timestamp)}>
              {item.author ? `${item.author}, ` : ''}
              {timeAgo(item.timestamp)}
            </span>
          </div>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose} aria-label="Close details">
            <X size={18} />
          </button>
        </header>

        <div className="drawer-body">
          <h2 id="drawer-title" className="drawer-title">
            {item.headline}
          </h2>
          {item.thread && <p className="muted reply-note">Comment in the thread “{item.thread}”</p>}
          {item.url && (
            <a className="source-link" href={item.url} target="_blank" rel="noopener noreferrer">
              {linkLabel(item)} <ExternalLink size={14} aria-hidden="true" />
            </a>
          )}

          <section className="ai-block" aria-labelledby="ai-heading">
            <h3 id="ai-heading">AI analysis</h3>
            <p className="ai-summary">{item.summary || 'No summary.'}</p>
            {item.action && (
              <p className="ai-action">
                <span className="ai-action-label">Suggested next step</span>
                {item.action}
              </p>
            )}
          </section>

          <dl className="attr-grid">
            <div>
              <dt>Sentiment</dt>
              <dd>
                <SentimentTag score={item.score} sentiment={item.sentiment} />
              </dd>
            </div>
            <div>
              <dt>Urgency</dt>
              <dd>
                <UrgencyTag urgency={item.urgency} />
              </dd>
            </div>
            <div>
              <dt>Product</dt>
              <dd>{item.product}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{item.type}</dd>
            </div>
            <div>
              <dt>Author</dt>
              <dd>
                {item.author || 'Unknown'} <span className="muted">({item.userType})</span>
              </dd>
            </div>
            <div>
              <dt>Engagement</dt>
              <dd className="engagement">
                <span title={engagement}>
                  <ThumbsUp size={13} aria-hidden="true" /> {item.reactions} {engagement}
                </span>
                <span title="comments">
                  <MessageSquare size={13} aria-hidden="true" /> {item.comments}
                </span>
              </dd>
            </div>
            {item.upstreamState && (
              <div>
                <dt>On GitHub</dt>
                <dd>
                  <span className={`upstream ${item.upstreamState}`}>{item.upstreamState === 'closed' ? 'Closed' : 'Open'}</span>
                </dd>
              </div>
            )}
          </dl>

          {item.labels.length > 0 && item.source === 'GitHub' && (
            <div className="labels">
              {item.labels.map((l) => (
                <span key={l} className="label-chip">
                  {l}
                </span>
              ))}
            </div>
          )}

          <section className="original" aria-labelledby="original-heading">
            <h3 id="original-heading">What they wrote</h3>
            <blockquote>{item.text}</blockquote>
          </section>
        </div>

        <footer className="drawer-foot">
          {item.ticketId ? (
            <div className="ticket-link">
              <Ticket size={16} aria-hidden="true" />
              <span>
                <strong>{ticketKey(item.ticketId)}</strong> {item.ticketPriority && <PriorityTag priority={item.ticketPriority} />}{' '}
                <span className="muted">{item.ticketStatus}</span>
              </span>
              <button type="button" className="btn" onClick={() => onViewTicket(item.ticketId)}>
                View ticket
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="btn primary" onClick={() => onRaiseTicket(item)} disabled={busy}>
                <Ticket size={16} aria-hidden="true" /> Raise ticket
              </button>
              {item.status === 'Resolved' ? (
                <button type="button" className="btn" onClick={() => onSetStatus(item, 'Open')} disabled={busy}>
                  <RotateCcw size={16} aria-hidden="true" /> Reopen
                </button>
              ) : (
                <button type="button" className="btn" onClick={() => onSetStatus(item, 'Resolved')} disabled={busy}>
                  <CircleCheck size={16} aria-hidden="true" /> Mark resolved
                </button>
              )}
            </>
          )}
        </footer>
      </aside>
    </>
  );
}

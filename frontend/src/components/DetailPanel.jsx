import {
  Bookmark,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  ExternalLink,
  Inbox,
  Layers,
  Link2,
  MessageSquare,
  MessageSquareReply,
  RotateCcw,
  ThumbsUp,
  Ticket,
  Undo2,
  X,
  XCircle,
} from 'lucide-react';
import { Menu, PriorityTag, SentimentTag, SourceTag, StarButton, TagChips, UrgencyTag } from './bits.jsx';
import Notes from './Notes.jsx';
import { DISMISS_REASONS, HIGHLIGHT_TAGS, closedUpstream, fullDate, isPraise, needsReply, ticketKey, timeAgo } from '../lib/format.js';

function linkLabel(item) {
  if (item.source === 'GitHub') return item.repo ? `Open issue in ${item.repo}` : 'Open on GitHub';
  if (item.source === 'Hacker News') return 'Open on Hacker News';
  return 'Open original';
}

/** The highlight tag picker: toggling a tag saves immediately. */
export function HighlightMenu({ item, onUpdate, label = 'Save to highlights', open, onOpenChange }) {
  const toggle = (tag) => {
    const has = item.highlightTags.includes(tag);
    const tags = has ? item.highlightTags.filter((t) => t !== tag) : [...item.highlightTags, tag];
    onUpdate(item, { highlight_tags: tags }, tags.length ? (has ? 'Highlight updated' : `Saved to highlights as ${tag}`) : 'Removed from highlights');
  };
  return (
    <Menu
      label={item.highlightTags.length ? 'Highlight tags' : label}
      icon={Bookmark}
      keepOpen
      open={open}
      onOpenChange={onOpenChange}
      className={item.highlightTags.length ? 'is-saved' : 'primary-menu'}
      items={HIGHLIGHT_TAGS.map((t) => ({ key: t, label: t, checked: item.highlightTags.includes(t), onSelect: () => toggle(t) }))}
    />
  );
}

export function DismissMenu({ item, onUpdate, open, onOpenChange }) {
  return (
    <Menu
      label="Dismiss"
      icon={XCircle}
      open={open}
      onOpenChange={onOpenChange}
      items={DISMISS_REASONS.map((r) => ({
        key: r,
        label: r,
        onSelect: () => onUpdate(item, { feedback_status: 'Dismissed', dismissed_reason: r }, `Dismissed as ${r.toLowerCase()}`),
      }))}
    />
  );
}

/**
 * Everything about one feedback item plus the actions that fit it.
 * Used inside the side drawer and inside the Inbox.
 */
export default function DetailPanel({
  item,
  nav,
  theme,
  onOpenTheme,
  busy,
  onUpdate,
  onRaiseTicket,
  onViewTicket,
  onCopyLink,
  onClose,
  notify,
  setNotesCount,
  menus = {},
  headingId = 'detail-title',
}) {
  const praise = isPraise(item);
  const engagement = item.source === 'Hacker News' ? 'points' : 'reactions';
  const reviewed = Boolean(item.reviewedAt);

  return (
    <>
      <header className="drawer-head">
        <div className="drawer-source">
          <SourceTag source={item.source} />
          <span className="muted" title={fullDate(item.timestamp)}>
            {item.author ? `${item.author}, ` : ''}
            {timeAgo(item.timestamp)}
          </span>
        </div>
        <div className="drawer-head-actions">
          {nav && (
            <span className="nav-group" aria-label="Move between feedback">
              <span className="muted small nav-pos">
                {nav.index + 1} of {nav.total}
              </span>
              <button type="button" className="icon-btn" onClick={nav.onPrev} disabled={nav.index <= 0} aria-label="Previous feedback (k)" title="Previous (k)">
                <ChevronUp size={18} />
              </button>
              <button type="button" className="icon-btn" onClick={nav.onNext} disabled={nav.index >= nav.total - 1} aria-label="Next feedback (j)" title="Next (j)">
                <ChevronDown size={18} />
              </button>
            </span>
          )}
          <StarButton starred={item.starred} onToggle={() => onUpdate(item, { starred: !item.starred }, item.starred ? 'Star removed' : 'Starred')} />
          <button type="button" className="icon-btn" onClick={() => onCopyLink(item)} aria-label="Copy link to this feedback" title="Copy link">
            <Link2 size={17} />
          </button>
          {onClose && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details" data-autofocus>
              <X size={18} />
            </button>
          )}
        </div>
      </header>

      <div className="drawer-body">
        <h2 id={headingId} className="drawer-title">
          {item.headline}
        </h2>
        {item.thread && <p className="muted reply-note">Comment in the thread “{item.thread}”</p>}
        <div className="link-row">
          {item.url && (
            <a className="source-link" href={item.url} target="_blank" rel="noopener noreferrer">
              {linkLabel(item)} <ExternalLink size={14} aria-hidden="true" />
            </a>
          )}
          {theme && (
            <button type="button" className="theme-link" onClick={() => onOpenTheme(theme.id)}>
              <Layers size={14} aria-hidden="true" /> {theme.title || 'Related feedback'} <span className="muted">({theme.item_count})</span>
            </button>
          )}
        </div>

        {closedUpstream(item) && (
          <div className="notice">
            <p>
              <strong>Closed on GitHub.</strong> The maintainers closed this issue, but it's still {item.status === 'Open' ? 'open' : 'ticketed'} here.
            </p>
            {!item.ticketId && (
              <button type="button" className="btn" onClick={() => onUpdate(item, { feedback_status: 'Resolved' }, 'Marked as resolved')}>
                <CircleCheck size={15} aria-hidden="true" /> Mark resolved
              </button>
            )}
          </div>
        )}

        {needsReply(item) && (
          <div className="notice good">
            <p>
              <strong>Resolved.</strong> Let {item.author || 'the author'} know on {item.source}, then mark it as replied.
            </p>
            <div className="notice-actions">
              <a className="btn" href={item.url} target="_blank" rel="noopener noreferrer">
                <MessageSquareReply size={15} aria-hidden="true" /> Reply on {item.source}
              </a>
              <button type="button" className="btn" onClick={() => onUpdate(item, { responded: true }, 'Marked as replied')}>
                Mark replied
              </button>
            </div>
          </div>
        )}
        {item.respondedAt && (
          <p className="replied-note muted">
            <MessageSquareReply size={14} aria-hidden="true" /> Author was replied to {timeAgo(item.respondedAt)}.{' '}
            <button type="button" className="link-btn" onClick={() => onUpdate(item, { responded: false }, 'Reply mark removed')}>
              Undo
            </button>
          </p>
        )}

        {item.status === 'Dismissed' && (
          <div className="notice muted-notice">
            <p>
              <strong>Dismissed</strong> as {item.dismissedReason?.toLowerCase() || 'not actionable'}.
            </p>
            <button type="button" className="btn" onClick={() => onUpdate(item, { feedback_status: 'Open' }, 'Restored')}>
              <Undo2 size={15} aria-hidden="true" /> Restore
            </button>
          </div>
        )}

        {item.highlightTags.length > 0 && (
          <div className="hl-row">
            <Bookmark size={14} aria-hidden="true" /> Saved to highlights <TagChips tags={item.highlightTags} />
          </div>
        )}

        <section className="ai-block" aria-label="AI analysis">
          <h3>AI analysis</h3>
          <p className="ai-summary">{item.summary || 'No summary.'}</p>
          {item.action && (
            <p className="ai-action">
              <span className="ai-action-label">{praise ? 'Suggested use' : 'Suggested next step'}</span>
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
          {item.subject && (
            <div title="What the AI found this feedback is about. Feedback about other tools is filtered out.">
              <dt>About</dt>
              <dd>{item.subject}</dd>
            </div>
          )}
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

        <section className="original" aria-label="What they wrote">
          <h3>What they wrote</h3>
          <blockquote>{item.text}</blockquote>
        </section>

        <Notes key={item.id} feedbackId={item.id} notify={notify} onCountChange={(n) => setNotesCount(item.id, n)} />
      </div>

      <footer className="drawer-foot">
        {item.ticketId ? (
          <div className="ticket-link">
            <Ticket size={16} aria-hidden="true" />
            <span>
              <strong>{ticketKey(item.ticketId)}</strong> {item.ticketPriority && <PriorityTag priority={item.ticketPriority} />}{' '}
              <span className="muted">
                {item.ticketStatus}
              </span>
            </span>
            <button type="button" className="btn" onClick={() => onViewTicket(item.ticketId)}>
              View ticket
            </button>
          </div>
        ) : praise ? (
          <HighlightMenu item={item} onUpdate={onUpdate} open={menus.highlight?.[0]} onOpenChange={menus.highlight?.[1]} />
        ) : item.status === 'Open' ? (
          <>
            <button type="button" className="btn primary" onClick={() => onRaiseTicket(item)} disabled={busy}>
              <Ticket size={16} aria-hidden="true" /> Raise ticket
            </button>
            <button type="button" className="btn" onClick={() => onUpdate(item, { feedback_status: 'Resolved' }, 'Marked as resolved')} disabled={busy}>
              <CircleCheck size={16} aria-hidden="true" /> Resolve
            </button>
            <DismissMenu item={item} onUpdate={onUpdate} open={menus.dismiss?.[0]} onOpenChange={menus.dismiss?.[1]} />
          </>
        ) : item.status === 'Resolved' ? (
          <button type="button" className="btn" onClick={() => onUpdate(item, { feedback_status: 'Open' }, 'Reopened')} disabled={busy}>
            <RotateCcw size={16} aria-hidden="true" /> Reopen
          </button>
        ) : null}

        {!item.ticketId && item.status !== 'Dismissed' && (
          <button
            type="button"
            className="btn ghost push-right"
            onClick={() => onUpdate(item, { reviewed: !reviewed }, reviewed ? 'Back in the inbox' : 'Marked as reviewed')}
            disabled={busy}
            title={reviewed ? 'Put it back in the inbox' : 'Done looking at it, keep as is'}
          >
            <Inbox size={16} aria-hidden="true" /> {reviewed ? 'Back to inbox' : 'Mark reviewed'}
          </button>
        )}
      </footer>
    </>
  );
}

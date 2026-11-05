import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, Keyboard } from 'lucide-react';
import DetailPanel from './DetailPanel.jsx';
import { EmptyState, SentimentTag, SourceTag, UrgencyTag } from './bits.jsx';
import { URGENCY_ORDER, closedUpstream, inInbox, isPraise, plural, timeAgo } from '../lib/format.js';
import { useBreakpoint } from '../lib/useBreakpoint.js';

const SHORTCUTS = [
  ['j / ↓', 'Next item'],
  ['k / ↑', 'Previous item'],
  ['r', 'Mark reviewed'],
  ['s', 'Star'],
  ['t', 'Raise ticket (problems)'],
  ['x', 'Resolve (problems)'],
  ['d', 'Dismiss… (problems)'],
  ['h', 'Save to highlights… (praise)'],
  ['o', 'Open the original post'],
];

/** Most urgent first: high urgency, closed upstream, then negative before neutral before praise, newest first. */
function triageOrder(a, b) {
  return (
    URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] ||
    Number(closedUpstream(b)) - Number(closedUpstream(a)) ||
    a.score - b.score ||
    new Date(b.timestamp) - new Date(a.timestamp)
  );
}

export default function InboxView({ items, themesById, onUpdate, onBulkReview, onRaiseTicket, onViewTicket, onOpenTheme, onCopyLink, onOpenDrawer, notify, setNotesCount, paused }) {
  const bp = useBreakpoint();
  const queue = useMemo(() => items.filter(inInbox).sort(triageOrder), [items]);
  const [currentId, setCurrentId] = useState(null);
  const [lastIndex, setLastIndex] = useState(0);
  const [showKeys, setShowKeys] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const listRef = useRef(null);
  const splitRef = useRef(null);

  // Size the list and detail panes to the space actually left under the sticky
  // header and filter bar (their height changes as filters wrap), so the action
  // buttons at the bottom of the detail pane are always on screen.
  useLayoutEffect(() => {
    const el = splitRef.current;
    if (!el) return;
    const update = () => {
      const bar = document.querySelector('.filterbar');
      const stickTop = (bar && getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().bottom : 0) + 12;
      const top = Math.max(el.getBoundingClientRect().top, stickTop);
      el.style.setProperty('--pane-top', `${stickTop}px`);
      el.style.setProperty('--pane-h', `${Math.max(380, window.innerHeight - top - 16)}px`);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  });

  // Keep a valid selection: when the current item leaves the queue, move to the one now in its place.
  const index = queue.findIndex((i) => i.id === currentId);
  const current = index >= 0 ? queue[index] : queue[Math.min(lastIndex, queue.length - 1)] || null;
  const currentIndex = current ? queue.indexOf(current) : -1;

  const select = (i) => {
    const next = queue[Math.max(0, Math.min(queue.length - 1, i))];
    if (!next) return;
    setCurrentId(next.id);
    setLastIndex(queue.indexOf(next));
    setHighlightOpen(false);
    setDismissOpen(false);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' }));
  };

  // Remember where we are so the next item slides into place after an action.
  useEffect(() => {
    if (currentIndex >= 0 && currentIndex !== lastIndex) setLastIndex(currentIndex); // eslint-disable-line react-hooks/set-state-in-effect
  }, [currentIndex, lastIndex]);

  useEffect(() => {
    if (paused || bp === 'sm') return;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest('input, textarea, select, [contenteditable]')) return;
      if (!current && e.key !== '?') return;
      const praise = current && isPraise(current);
      const act = {
        j: () => select(currentIndex + 1),
        ArrowDown: () => select(currentIndex + 1),
        k: () => select(currentIndex - 1),
        ArrowUp: () => select(currentIndex - 1),
        r: () => onUpdate(current, { reviewed: true }, 'Marked as reviewed'),
        s: () => onUpdate(current, { starred: !current.starred }, current.starred ? 'Star removed' : 'Starred'),
        t: () => !praise && onRaiseTicket(current),
        x: () => !praise && onUpdate(current, { feedback_status: 'Resolved' }, 'Marked as resolved'),
        d: () => !praise && setDismissOpen(true),
        h: () => praise && setHighlightOpen(true),
        o: () => current.url && window.open(current.url, '_blank', 'noopener'),
        '?': () => setShowKeys((v) => !v),
      }[e.key];
      if (act) {
        e.preventDefault();
        act();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!queue.length) {
    return (
      <EmptyState title="Inbox zero">
        Everything in this view has been looked at. New feedback lands here every hour. Starred items are under Feedback → Status: Starred, and saved praise is in
        Highlights.
      </EmptyState>
    );
  }

  const panelProps = { onUpdate, onRaiseTicket, onViewTicket, onOpenTheme, onCopyLink, notify, setNotesCount };

  return (
    <div className="inbox">
      <div className="inbox-bar">
        <p>
          <strong>{plural(queue.length, 'item')}</strong> to review
          <span className="muted"> · most urgent first</span>
        </p>
        <div className="inbox-bar-actions">
          {bp !== 'sm' && (
            <button type="button" className="btn ghost" aria-expanded={showKeys} onClick={() => setShowKeys((v) => !v)}>
              <Keyboard size={16} aria-hidden="true" /> Shortcuts
            </button>
          )}
          <button
            type="button"
            className={`btn ${confirmAll ? 'danger' : 'ghost'}`}
            onClick={() => {
              if (!confirmAll) return setConfirmAll(true);
              setConfirmAll(false);
              onBulkReview(queue.map((i) => i.id));
            }}
            onBlur={() => setConfirmAll(false)}
          >
            <CheckCheck size={16} aria-hidden="true" /> {confirmAll ? `Confirm: mark all ${queue.length} reviewed` : 'Mark all reviewed'}
          </button>
        </div>
      </div>

      {showKeys && (
        <dl className="shortcut-list">
          {SHORTCUTS.map(([k, label]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="inbox-split" ref={splitRef}>
        <ul className="inbox-list" ref={listRef} aria-label="Feedback to review">
          {queue.map((item, i) => (
            <li key={item.id} data-id={item.id}>
              <button
                type="button"
                className={`inbox-row ${current?.id === item.id ? 'current' : ''}`}
                aria-current={current?.id === item.id ? 'true' : undefined}
                onClick={() => (bp === 'sm' ? onOpenDrawer(item.id) : select(i))}
              >
                <span className="inbox-row-top">
                  <SourceTag source={item.source} compact />
                  <span className="inbox-title">{item.headline}</span>
                </span>
                <span className="inbox-row-meta">
                  {item.urgency === 'High' ? <UrgencyTag urgency="High" /> : <SentimentTag score={item.score} sentiment={item.sentiment} />}
                  <span>{item.product}</span>
                  {closedUpstream(item) && <span className="mini-flag">Closed on GitHub</span>}
                  <span className="muted push-right">{timeAgo(item.timestamp)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {bp !== 'sm' && current && (
          <section className="inbox-detail" aria-label="Selected feedback">
            <DetailPanel
              key={current.id}
              item={current}
              theme={current.themeId ? themesById.get(current.themeId) : null}
              menus={{ highlight: [highlightOpen, setHighlightOpen], dismiss: [dismissOpen, setDismissOpen] }}
              headingId="inbox-title"
              {...panelProps}
            />
          </section>
        )}
      </div>
    </div>
  );
}

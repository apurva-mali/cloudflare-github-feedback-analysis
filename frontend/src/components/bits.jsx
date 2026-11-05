import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Github, Newspaper, PenLine, Star, TriangleAlert } from 'lucide-react';
import { SENTIMENTS, countBySentiment, pct, ticketKey } from '../lib/format.js';

export function SourceTag({ source, compact = false }) {
  const Icon = source === 'GitHub' ? Github : source === 'Hacker News' ? Newspaper : PenLine;
  return (
    <span className="source-tag" title={source}>
      <Icon size={14} aria-hidden="true" />
      {!compact && <span>{source}</span>}
    </span>
  );
}

export function SentimentTag({ score, sentiment }) {
  const label = SENTIMENTS.find((s) => s.key === sentiment)?.label;
  return (
    <span className={`sentiment-tag ${sentiment}`} title={`${label}, scored ${score} out of 10`}>
      <span className="dot" aria-hidden="true" />
      <span className="num">{score}</span>
      <span className="word">{label}</span>
    </span>
  );
}

export function UrgencyTag({ urgency }) {
  return (
    <span className={`urgency-tag ${urgency.toLowerCase()}`}>
      {urgency === 'High' && <TriangleAlert size={13} aria-hidden="true" />}
      {urgency}
    </span>
  );
}

export function StatusTag({ item }) {
  if (item.ticketId) {
    return (
      <span className={`status-tag ticket ${item.ticketStatus === 'Resolved' ? 'done' : ''}`}>
        {ticketKey(item.ticketId)} <span className="status-sub">{item.ticketStatus}</span>
      </span>
    );
  }
  if (item.status === 'Dismissed') return <span className="status-tag dismissed" title={item.dismissedReason || ''}>Dismissed</span>;
  return <span className={`status-tag ${item.status === 'Resolved' ? 'done' : ''}`}>{item.status}</span>;
}

export function PriorityTag({ priority }) {
  return <span className={`priority-tag ${priority.toLowerCase()}`}>{priority}</span>;
}

/**
 * 100% stacked negative | neutral | positive bar.
 * `size="hero"` shows labelled segments; clicking a segment calls onSelect(key).
 */
export function BalanceBar({ items, size = 'row', onSelect }) {
  const counts = countBySentiment(items);
  const total = items.length;
  return (
    <div className={`balance-bar ${size}`} role="img" aria-label={`${counts.negative} negative, ${counts.neutral} neutral, ${counts.positive} positive`}>
      {SENTIMENTS.map((s) => {
        const n = counts[s.key];
        if (!n) return null;
        const share = pct(n, total);
        const Tag = onSelect ? 'button' : 'span';
        return (
          <Tag
            key={s.key}
            type={onSelect ? 'button' : undefined}
            className={`seg ${s.key}`}
            style={{ flexGrow: n }}
            onClick={onSelect ? () => onSelect(s.key) : undefined}
            title={`${s.label}: ${n} (${share}%)`}
          >
            {size === 'hero' && (
              <span className="seg-label">
                <strong>{share}%</strong> {s.label.toLowerCase()}
              </span>
            )}
          </Tag>
        );
      })}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {children && <p className="empty-body">{children}</p>}
    </div>
  );
}

/**
 * Small dropdown: a button that opens a list of choices.
 * items: [{ key, label, hint?, checked?, onSelect }]. Stays open when `keepOpen`.
 */
export function Menu({ label, icon: Icon, items, className = '', align = 'start', keepOpen = false, title, open: openProp, onOpenChange }) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v) => (onOpenChange ? onOpenChange(v) : setOpenState(v));
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  });  

  return (
    <div className={`menu ${className}`} ref={ref}>
      <button type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title={title}>
        {Icon && <Icon size={16} aria-hidden="true" />}
        {label}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className={`menu-pop ${align}`} role="menu">
          {items.map((it) => (
            <button
              key={it.key || it.label}
              type="button"
              role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={it.checked}
              className="menu-item"
              onClick={() => {
                it.onSelect();
                if (!keepOpen) setOpen(false);
              }}
            >
              {it.checked !== undefined && <span className={`check ${it.checked ? 'on' : ''}`} aria-hidden="true">{it.checked && <Check size={12} />}</span>}
              <span className="menu-label">{it.label}</span>
              {it.hint && <span className="menu-hint">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function StarButton({ starred, onToggle, size = 16, className = '' }) {
  return (
    <button
      type="button"
      className={`star-btn ${starred ? 'on' : ''} ${className}`}
      aria-pressed={starred}
      aria-label={starred ? 'Remove star' : 'Star to come back to later'}
      title={starred ? 'Starred' : 'Star to come back to later'}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Star size={size} aria-hidden="true" />
    </button>
  );
}

export function TagChips({ tags }) {
  if (!tags?.length) return null;
  return (
    <span className="tag-chips">
      {tags.map((t) => (
        <span key={t} className="hl-tag">
          {t}
        </span>
      ))}
    </span>
  );
}

import { Github, Newspaper, PenLine, TriangleAlert } from 'lucide-react';
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

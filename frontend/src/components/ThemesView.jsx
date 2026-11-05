import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { BalanceBar, EmptyState, SentimentTag, SourceTag, StatusTag } from './bits.jsx';
import { plural, sentimentIndex, signed, timeAgo } from '../lib/format.js';

const SORTS = {
  recent: { label: 'Most recent', fn: (a, b) => new Date(b.lastSeen) - new Date(a.lastSeen) },
  size: { label: 'Most mentions', fn: (a, b) => b.members.length - a.members.length || new Date(b.lastSeen) - new Date(a.lastSeen) },
  negative: { label: 'Most negative', fn: (a, b) => a.index - b.index || b.members.length - a.members.length },
};

export default function ThemesView({ themes, items, unavailable, focusId, onOpen }) {
  const [sort, setSort] = useState('size');
  const [expanded, setExpanded] = useState(() => new Set(focusId ? [focusId] : []));

  useEffect(() => {
    if (!focusId) return;
    requestAnimationFrame(() => document.getElementById(`theme-${focusId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }, [focusId]);

  // Members come from the filtered feedback, so time range and filters apply to themes too.
  const rows = useMemo(() => {
    const byTheme = new Map();
    for (const item of items) {
      if (!item.themeId) continue;
      if (!byTheme.has(item.themeId)) byTheme.set(item.themeId, []);
      byTheme.get(item.themeId).push(item);
    }
    return themes
      .filter((t) => byTheme.has(t.id))
      .map((t) => {
        const members = byTheme.get(t.id).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const sources = {};
        for (const m of members) sources[m.source] = (sources[m.source] || 0) + 1;
        return { ...t, members, sources, index: sentimentIndex(members), lastSeen: members[0].timestamp };
      })
      .sort(SORTS[sort].fn);
  }, [themes, items, sort]);

  if (unavailable) {
    return (
      <EmptyState title="Themes need the latest database update">
        Run <code>npm run db:migrate</code> in the project folder, deploy, then run a sync.
      </EmptyState>
    );
  }
  if (!themes.length) {
    return (
      <EmptyState title="No themes yet">
        Feedback about the same thing is grouped automatically every hour, in batches of 40. Themes appear once at least two items about the same product are
        similar enough, so with a small amount of feedback it can take a while.
      </EmptyState>
    );
  }

  const toggle = (id) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="themes-view">
      <div className="toolbar">
        <p className="muted view-intro flush">
          Feedback about the same thing, grouped automatically. {plural(rows.length, 'theme')} in this view.
        </p>
        <label className="filter push-right">
          <span className="sr-only">Sort themes</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {Object.entries(SORTS).map(([k, v]) => (
              <option key={k} value={k}>
                Sort: {v.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No themes match these filters">Widen the time range or clear a filter.</EmptyState>
      ) : (
        <ul className="theme-list">
          {rows.map((t) => {
            const open = expanded.has(t.id);
            return (
              <li key={t.id} id={`theme-${t.id}`} className={`theme-card ${t.id === focusId ? 'focused' : ''}`}>
                <div className="theme-head">
                  <button type="button" className="theme-toggle" aria-expanded={open} onClick={() => toggle(t.id)}>
                    {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                    <span className="theme-title">{t.title || 'Untitled theme'}</span>
                  </button>
                  <div className="theme-stats">
                    <span className="theme-count">{plural(t.members.length, 'mention')}</span>
                    <span className="muted">{t.product}</span>
                    <span className="muted">
                      {Object.entries(t.sources)
                        .map(([s, n]) => `${n} ${s}`)
                        .join(', ')}
                    </span>
                    <span className="muted">last {timeAgo(t.lastSeen)}</span>
                  </div>
                  <div className="theme-balance">
                    <BalanceBar items={t.members} />
                    <span className={`theme-index ${t.index < 0 ? 'neg-text' : t.index > 0 ? 'pos-text' : ''}`}>{signed(t.index)}</span>
                  </div>
                </div>
                {open && (
                  <ul className="theme-members">
                    {t.members.map((m) => (
                      <li key={m.id}>
                        <button type="button" className="member-row" onClick={() => onOpen(m.id)}>
                          <SourceTag source={m.source} compact />
                          <span className="member-title">{m.headline}</span>
                          <SentimentTag score={m.score} sentiment={m.sentiment} />
                          <StatusTag item={m} />
                          <span className="muted">{timeAgo(m.timestamp)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

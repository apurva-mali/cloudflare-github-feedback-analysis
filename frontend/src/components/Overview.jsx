import { useMemo } from 'react';
import { BalanceBar, EmptyState, SentimentTag, SourceTag, UrgencyTag } from './bits.jsx';
import VolumeChart from './VolumeChart.jsx';
import { Layers } from 'lucide-react';
import { SENTIMENTS, URGENCY_ORDER, countBySentiment, inInbox, plural, sentimentIndex, signed, timeAgo } from '../lib/format.js';

function describeIndex(index) {
  if (index >= 30) return 'People are mostly happy.';
  if (index >= 0) return 'Slightly more praise than complaints.';
  if (index > -30) return 'Slightly more complaints than praise.';
  return 'Complaints clearly outweigh praise.';
}

function ItemList({ items, onOpen, empty }) {
  if (!items.length) return <p className="list-empty">{empty}</p>;
  return (
    <ul className="item-list">
      {items.map((item) => (
        <li key={item.id}>
          <button type="button" className="item-row" onClick={() => onOpen(item.id)}>
            <span className="item-main">
              <span className="item-title">{item.headline}</span>
              <span className="item-meta">
                <SourceTag source={item.source} />
                <span>{item.product}</span>
                <span>{timeAgo(item.timestamp)}</span>
              </span>
            </span>
            <span className="item-side">
              {item.urgency === 'High' ? <UrgencyTag urgency="High" /> : <SentimentTag score={item.score} sentiment={item.sentiment} />}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function Overview({ items, allItems, tickets, themes, rangeDays, onOpen, onDrill, onOpenTheme }) {
  const counts = countBySentiment(items);
  const index = sentimentIndex(items);

  const bySource = useMemo(() => {
    const m = {};
    for (const i of items) m[i.source] = (m[i.source] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const products = useMemo(() => {
    const m = new Map();
    for (const i of items) {
      if (!m.has(i.product)) m.set(i.product, []);
      m.get(i.product).push(i);
    }
    return [...m.entries()]
      .map(([name, list]) => ({ name, list, index: sentimentIndex(list) }))
      .sort((a, b) => b.list.length - a.list.length);
  }, [items]);

  const attention = useMemo(
    () =>
      items
        .filter((i) => i.status === 'Open' && i.sentiment !== 'positive')
        .sort(
          (a, b) =>
            URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || a.score - b.score || b.reactions - a.reactions
        )
        .slice(0, 6),
    [items]
  );
  const praise = useMemo(
    () =>
      items
        .filter((i) => i.sentiment === 'positive')
        .sort((a, b) => b.score - a.score || b.reactions - a.reactions)
        .slice(0, 6),
    [items]
  );

  const highOpen = items.filter((i) => i.urgency === 'High' && i.status === 'Open').length;
  const openTickets = tickets.filter((t) => t.status !== 'Resolved').length;
  const inboxCount = items.filter(inInbox).length;

  const topThemes = useMemo(() => {
    const byTheme = new Map();
    for (const i of items) if (i.themeId) byTheme.set(i.themeId, [...(byTheme.get(i.themeId) || []), i]);
    return themes
      .filter((t) => byTheme.get(t.id)?.length >= 2)
      .map((t) => ({ ...t, members: byTheme.get(t.id) }))
      .sort((a, b) => b.members.length - a.members.length)
      .slice(0, 5);
  }, [items, themes]);
  const worst = [...products].filter((p) => p.list.length >= 3).sort((a, b) => a.index - b.index)[0];

  if (!allItems.length) {
    return (
      <EmptyState title="No feedback yet">
        Run a sync to pull in GitHub issues and Hacker News comments. New items also arrive automatically every hour.
      </EmptyState>
    );
  }
  if (!items.length) {
    return <EmptyState title="Nothing matches these filters">Widen the time range or clear a filter to see feedback.</EmptyState>;
  }

  return (
    <div className="overview">
      <section className="balance" aria-labelledby="balance-heading">
        <div className="balance-head">
          <div className="balance-index">
            <span className={`index-value ${index >= 0 ? 'pos' : 'neg'}`}>{signed(index)}</span>
            <div>
              <h2 id="balance-heading">Sentiment index</h2>
              <p className="muted">{describeIndex(index)}</p>
            </div>
          </div>
          <p className="balance-explain muted">
            Share of positive feedback minus share of negative, across {items.length} items. Click a segment to read them.
          </p>
        </div>
        <BalanceBar items={items} size="hero" onSelect={(key) => onDrill({ sentiment: key })} />
        <div className="balance-legend">
          {SENTIMENTS.map((s) => (
            <span key={s.key}>
              <span className={`swatch ${s.key}`} aria-hidden="true" />
              {s.label} <span className="muted">({s.min}–{s.max})</span> <strong>{counts[s.key]}</strong>
            </span>
          ))}
        </div>
      </section>

      <section className="stat-strip" aria-label="Key numbers">
        <div className="stat">
          <span className="stat-value">{items.length}</span>
          <span className="stat-label">pieces of feedback</span>
          <span className="stat-sub">{bySource.map(([s, n]) => `${n} from ${s}`).join(', ')}</span>
        </div>
        <button type="button" className="stat stat-link" onClick={() => onDrill({ urgency: 'High', status: 'Open' })}>
          <span className={`stat-value ${highOpen ? 'alert' : ''}`}>{highOpen}</span>
          <span className="stat-label">high-urgency, not yet actioned</span>
          <span className="stat-sub">Blocking bugs, regressions, heavily upvoted</span>
        </button>
        <button type="button" className="stat stat-link" onClick={() => onDrill({ tab: 'inbox' })}>
          <span className="stat-value">{inboxCount}</span>
          <span className="stat-label">waiting in the inbox</span>
          <span className="stat-sub">
            {openTickets} open {openTickets === 1 ? 'ticket' : 'tickets'}, {tickets.length - openTickets} resolved
          </span>
        </button>
        {worst ? (
          <button type="button" className="stat stat-link" onClick={() => onDrill({ product: worst.name })}>
            <span className="stat-value small">{worst.name}</span>
            <span className="stat-label">product with the lowest sentiment</span>
            <span className="stat-sub">
              Index {signed(worst.index)} across {plural(worst.list.length, 'item')}
            </span>
          </button>
        ) : (
          <div className="stat">
            <span className="stat-value small">{products[0]?.name}</span>
            <span className="stat-label">most discussed product</span>
          </div>
        )}
      </section>

      <div className="split">
        <section className="panel" aria-labelledby="attention-heading">
          <header className="panel-head">
            <h3 id="attention-heading">Needs attention</h3>
            <p className="muted">Open, not positive, most urgent first</p>
          </header>
          <ItemList items={attention} onOpen={onOpen} empty="Nothing open right now." />
        </section>
        <section className="panel" aria-labelledby="praise-heading">
          <header className="panel-head">
            <h3 id="praise-heading">What people like</h3>
            <p className="muted">Highest-scoring feedback</p>
          </header>
          <ItemList items={praise} onOpen={onOpen} empty="No positive feedback in this view yet." />
        </section>
      </div>

      <div className="split wide-left">
        <section className="panel" aria-labelledby="volume-heading">
          <header className="panel-head">
            <h3 id="volume-heading">Feedback over time</h3>
            <div className="legend">
              {[...SENTIMENTS].reverse().map((s) => (
                <span key={s.key}>
                  <span className={`swatch ${s.key}`} aria-hidden="true" />
                  {s.label}
                </span>
              ))}
            </div>
          </header>
          <VolumeChart items={items} rangeDays={rangeDays} />
        </section>

        <section className="panel" aria-labelledby="products-heading">
          <header className="panel-head">
            <h3 id="products-heading">Sentiment by product</h3>
            <p className="muted">Click a product to filter</p>
          </header>
          <ul className="product-bars">
            {products.slice(0, 8).map((p) => (
              <li key={p.name}>
                <button type="button" onClick={() => onDrill({ product: p.name })}>
                  <span className="pb-name">{p.name}</span>
                  <BalanceBar items={p.list} />
                  <span className="pb-count">{p.list.length}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {topThemes.length > 0 && (
        <section className="panel" aria-labelledby="themes-heading">
          <header className="panel-head">
            <h3 id="themes-heading">Most mentioned themes</h3>
            <button type="button" className="link-btn muted small" onClick={() => onDrill({ tab: 'themes' })}>
              All themes
            </button>
          </header>
          <ul className="item-list">
            {topThemes.map((t) => (
              <li key={t.id}>
                <button type="button" className="item-row" onClick={() => onOpenTheme(t.id)}>
                  <Layers size={16} className="muted" aria-hidden="true" />
                  <span className="item-main">
                    <span className="item-title">{t.title || 'Related feedback'}</span>
                    <span className="item-meta">
                      <span>{t.product}</span>
                      <span>{plural(t.members.length, 'mention')}</span>
                    </span>
                  </span>
                  <span className="item-side theme-side">
                    <BalanceBar items={t.members} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

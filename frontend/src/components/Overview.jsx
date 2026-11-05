import { useMemo } from 'react';
import { BalanceBar, EmptyState, SentimentTag, SourceTag, UrgencyTag } from './bits.jsx';
import VolumeChart from './VolumeChart.jsx';
import { DivergingBars, HBars, Sparkline, TrendChart } from './charts.jsx';
import { bucketize } from '../lib/buckets.js';
import { SENTIMENTS, URGENCY_ORDER, countBySentiment, inInbox, needsReply, plural, sentimentIndex, signed, timeAgo } from '../lib/format.js';

function describeIndex(index) {
  if (index >= 30) return 'Developers are mostly happy.';
  if (index >= 0) return 'Slightly more praise than complaints.';
  if (index > -30) return 'Slightly more complaints than praise.';
  return 'Complaints clearly outweigh praise.';
}

function Delta({ now, before, unit = '', percent = false }) {
  if (before == null) return null;
  let diff = now - before;
  if (percent) {
    if (!before) return null;
    diff = Math.round((diff / before) * 100);
  }
  if (diff === 0) return <span className="delta flat">no change</span>;
  return (
    <span className={`delta ${diff > 0 ? 'up' : 'down'}`}>
      {diff > 0 ? '▲' : '▼'} {Math.abs(diff)}
      {percent ? '%' : unit}
    </span>
  );
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
              {item.urgency === 'High' && item.sentiment !== 'positive' ? <UrgencyTag urgency="High" /> : <SentimentTag score={item.score} sentiment={item.sentiment} />}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function Overview({ items, previous, allItems, tickets, rangeDays, rangeLabel, onOpen, onDrill }) {
  const counts = countBySentiment(items);
  const index = sentimentIndex(items);
  const prevIndex = previous?.length ? sentimentIndex(previous) : null;

  const daily = useMemo(() => bucketize(items, rangeDays).buckets.map((b) => b.total), [items, rangeDays]);
  const urgentDaily = useMemo(
    () => bucketize(items.filter((i) => i.urgency === 'High' && i.sentiment !== 'positive'), rangeDays).buckets.map((b) => b.total),
    [items, rangeDays]
  );

  const productRows = useMemo(() => {
    const m = new Map();
    for (const i of items) {
      if (i.product === 'Unknown') continue;
      if (!m.has(i.product)) m.set(i.product, []);
      m.get(i.product).push(i);
    }
    return [...m.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8)
      .map(([name, list]) => ({ key: name, label: name, ...countBySentiment(list) }));
  }, [items]);

  const typeRows = useMemo(() => {
    const m = {};
    for (const i of items) m[i.type] = (m[i.type] || 0) + 1;
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ key: k, label: k, value: v }));
  }, [items]);

  const sourceRows = useMemo(() => {
    const m = {};
    for (const i of items) m[i.source] = (m[i.source] || 0) + 1;
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ key: k, label: k, value: v }));
  }, [items]);

  const attention = useMemo(
    () =>
      items
        .filter((i) => i.status === 'Open' && i.sentiment !== 'positive')
        .sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || a.score - b.score || b.reactions - a.reactions)
        .slice(0, 5),
    [items]
  );
  const praise = useMemo(
    () =>
      items
        .filter((i) => i.sentiment === 'positive')
        .sort((a, b) => b.score - a.score || b.reactions - a.reactions)
        .slice(0, 5),
    [items]
  );

  const toReview = items.filter(inInbox).length;
  const highOpen = items.filter((i) => i.urgency === 'High' && i.status === 'Open').length;
  const openTickets = tickets.filter((t) => t.status !== 'Resolved').length;
  const awaitingReply = allItems.filter(needsReply).length;

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
            <span className={`index-value ${index > 0 ? 'pos' : index < 0 ? 'neg' : ''}`}>{signed(index)}</span>
            <div>
              <h2 id="balance-heading">Sentiment index</h2>
              <p className="muted">
                {describeIndex(index)}{' '}
                {prevIndex != null && (
                  <>
                    <Delta now={index} before={prevIndex} unit=" pts" /> <span className="muted">vs the {rangeLabel} before</span>
                  </>
                )}
              </p>
            </div>
          </div>
          <p className="balance-explain muted">
            Share of positive feedback minus share of negative, across {plural(items.length, 'item')} about Cloudflare. Click a segment to read them.
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

      <section className="kpis" aria-label="Key numbers">
        <div className="kpi">
          <span className="kpi-label">Feedback</span>
          <span className="kpi-value">{items.length}</span>
          <span className="kpi-foot">
            <Delta now={items.length} before={previous?.length ?? null} percent />
            <span className="muted">{sourceRows.map((s) => `${s.value} from ${s.label}`).join(', ')}</span>
          </span>
          <Sparkline values={daily} />
        </div>
        <button type="button" className="kpi kpi-link" onClick={() => onDrill({ urgency: 'High', status: 'Open' })}>
          <span className="kpi-label">High urgency, still open</span>
          <span className={`kpi-value ${highOpen ? 'neg-text' : ''}`}>{highOpen}</span>
          <span className="kpi-foot muted">Blocking bugs, regressions, heavily upvoted</span>
          <Sparkline values={urgentDaily} tone="neg" />
        </button>
        <button type="button" className="kpi kpi-link" onClick={() => onDrill({ tab: 'feedback', view: 'review' })}>
          <span className="kpi-label">To review</span>
          <span className="kpi-value">{toReview}</span>
          <span className="kpi-foot muted">Not yet looked at by anyone</span>
        </button>
        <button type="button" className="kpi kpi-link" onClick={() => onDrill({ tab: 'tickets' })}>
          <span className="kpi-label">Open tickets</span>
          <span className="kpi-value">{openTickets}</span>
          <span className="kpi-foot muted">
            {tickets.length - openTickets} resolved{awaitingReply ? `, ${awaitingReply} awaiting a reply` : ''}
          </span>
        </button>
      </section>

      <div className="split wide-left">
        <section className="panel" aria-labelledby="volume-heading">
          <header className="panel-head">
            <div>
              <h3 id="volume-heading">Feedback over time</h3>
              <p className="muted">How much came in each day, by sentiment</p>
            </div>
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
        <section className="panel" aria-labelledby="trend-heading">
          <header className="panel-head">
            <div>
              <h3 id="trend-heading">Sentiment trend</h3>
              <p className="muted">7-day rolling index, −100 to +100</p>
            </div>
          </header>
          <TrendChart items={items} rangeDays={rangeDays} />
        </section>
      </div>

      <div className="split">
        <section className="panel" aria-labelledby="products-heading">
          <header className="panel-head">
            <div>
              <h3 id="products-heading">Sentiment by product</h3>
              <p className="muted">Complaints to the left, praise to the right. Click to filter.</p>
            </div>
          </header>
          <DivergingBars rows={productRows} onSelect={(product) => onDrill({ product })} />
        </section>
        <section className="panel" aria-labelledby="types-heading">
          <header className="panel-head">
            <div>
              <h3 id="types-heading">What people talk about</h3>
              <p className="muted">Kind of feedback, as classified by Workers AI</p>
            </div>
          </header>
          <HBars rows={typeRows} onSelect={(type) => onDrill({ type })} />
        </section>
      </div>

      <div className="split">
        <section className="panel" aria-labelledby="attention-heading">
          <header className="panel-head">
            <div>
              <h3 id="attention-heading">Needs attention</h3>
              <p className="muted">Open problems, most urgent first</p>
            </div>
          </header>
          <ItemList items={attention} onOpen={onOpen} empty="Nothing open right now." />
        </section>
        <section className="panel" aria-labelledby="praise-heading">
          <header className="panel-head">
            <div>
              <h3 id="praise-heading">What people like</h3>
              <p className="muted">Highest-scoring praise for Cloudflare</p>
            </div>
          </header>
          <ItemList items={praise} onOpen={onOpen} empty="No positive feedback in this view yet." />
        </section>
      </div>
    </div>
  );
}

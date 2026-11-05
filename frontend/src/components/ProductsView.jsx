import { useEffect, useMemo, useState } from 'react';
import { TriangleAlert, Ticket } from 'lucide-react';
import { BalanceBar, EmptyState } from './bits.jsx';
import { api } from '../lib/api.js';
import { countBySentiment, plural, sentimentIndex, signed, timeAgo } from '../lib/format.js';

/**
 * One card per product: volume, sentiment, an AI summary of what developers
 * are saying (last 30 days, written by Workers AI and cached), and links.
 */
export default function ProductsView({ items, onDrill }) {
  const [summaries, setSummaries] = useState(null);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState(null);

  const products = useMemo(() => {
    const m = new Map();
    for (const i of items) {
      if (i.product === 'Unknown') continue;
      if (!m.has(i.product)) m.set(i.product, []);
      m.get(i.product).push(i);
    }
    return [...m.entries()]
      .map(([name, list]) => ({
        name,
        list,
        counts: countBySentiment(list),
        index: sentimentIndex(list),
        urgent: list.filter((i) => i.urgency === 'High' && i.status === 'Open').length,
        tickets: list.filter((i) => i.ticketId && i.ticketStatus !== 'Resolved').length,
      }))
      .sort((a, b) => b.list.length - a.list.length);
  }, [items]);

  // Load cached summaries; if some busy products have none yet, ask the Worker to write them.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { summaries: rows } = await api.productSummaries();
        if (!live) return;
        const map = new Map(rows.map((r) => [r.product, r]));
        setSummaries(map);
        const missing = products.some((p) => p.list.length >= 2 && !map.has(p.name));
        if (missing) {
          setWriting(true);
          await api.refreshProductSummaries();
          const again = await api.productSummaries();
          if (live) setSummaries(new Map(again.summaries.map((r) => [r.product, r])));
        }
      } catch (err) {
        if (live) setError(err.status === 500 ? 'Summaries need the latest database update (npm run db:migrate).' : err.message);
      } finally {
        if (live) setWriting(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!products.length) return <EmptyState title="No products in this view">Clear a filter or widen the time range.</EmptyState>;

  return (
    <div className="products-view">
      <p className="view-intro muted">
        Each summary is written by Workers AI from the last 30 days of feedback about that product and refreshed when new feedback arrives. Numbers follow the
        filters above.
      </p>
      {error && <p className="form-error">{error}</p>}
      <ul className="product-grid">
        {products.filter((p) => p.list.length >= 2).map((p) => {
          const s = summaries?.get(p.name);
          return (
            <li key={p.name} className="product-card">
              <header className="pc-head">
                <h3>{p.name}</h3>
                <span className={`pc-index ${p.index > 0 ? 'pos-text' : p.index < 0 ? 'neg-text' : 'muted'}`} title="Sentiment index">
                  {signed(p.index)}
                </span>
              </header>
              <div className="pc-bar">
                <BalanceBar items={p.list} />
                <span className="pc-counts muted">
                  <span className="neg-text">{p.counts.negative} negative</span>, {p.counts.neutral} neutral, <span className="pos-text">{p.counts.positive} positive</span>
                </span>
              </div>
              <div className="pc-summary">
                {s ? (
                  <>
                    <p>{s.summary}</p>
                    <span className="muted small">Written {timeAgo(s.generated_at)} from {plural(s.item_count, 'item')}</span>
                  </>
                ) : p.list.length < 2 ? (
                  <p className="muted">Not enough feedback for a summary yet.</p>
                ) : writing ? (
                  <p className="muted shimmer">Writing a summary…</p>
                ) : (
                  <p className="muted">A summary will be written at the next hourly sync.</p>
                )}
              </div>
              <footer className="pc-foot">
                <span className="pc-stat">{plural(p.list.length, 'item')}</span>
                {p.urgent > 0 && (
                  <span className="pc-stat alert-text">
                    <TriangleAlert size={13} aria-hidden="true" /> {p.urgent} urgent
                  </span>
                )}
                {p.tickets > 0 && (
                  <span className="pc-stat">
                    <Ticket size={13} aria-hidden="true" /> {plural(p.tickets, 'open ticket')}
                  </span>
                )}
                <button type="button" className="btn ghost push-right" onClick={() => onDrill({ product: p.name })}>
                  View feedback
                </button>
              </footer>
            </li>
          );
        })}
      </ul>
      {products.some((p) => p.list.length < 2) && (
        <p className="also-mentioned">
          <span className="muted">Also mentioned once:</span>{' '}
          {products
            .filter((p) => p.list.length < 2)
            .map((p, i, arr) => (
              <span key={p.name}>
                <button type="button" className="link-btn" onClick={() => onDrill({ product: p.name })}>
                  {p.name}
                </button>
                {i < arr.length - 1 ? ', ' : ''}
              </span>
            ))}
        </p>
      )}
    </div>
  );
}

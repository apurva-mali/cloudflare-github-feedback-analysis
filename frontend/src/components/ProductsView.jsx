import { useMemo } from 'react';
import { BalanceBar, EmptyState } from './bits.jsx';
import { URGENCY_ORDER, plural, sentimentIndex, signed } from '../lib/format.js';
import { useBreakpoint } from '../lib/useBreakpoint.js';

export default function ProductsView({ items, onDrill, onOpen }) {
  const bp = useBreakpoint();
  const showTickets = bp === 'lg';
  const showVoices = bp !== 'sm';
  const products = useMemo(() => {
    const m = new Map();
    for (const i of items) {
      if (!m.has(i.product)) m.set(i.product, []);
      m.get(i.product).push(i);
    }
    return [...m.entries()]
      .map(([name, list]) => {
        const concerns = list
          .filter((i) => i.sentiment === 'negative' && i.status !== 'Resolved')
          .sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || a.score - b.score || b.reactions - a.reactions);
        const praise = list.filter((i) => i.sentiment === 'positive').sort((a, b) => b.score - a.score || b.reactions - a.reactions);
        return {
          name,
          list,
          index: sentimentIndex(list),
          high: list.filter((i) => i.urgency === 'High' && i.status === 'Open').length,
          tickets: list.filter((i) => i.ticketId && i.ticketStatus !== 'Resolved').length,
          concern: concerns[0],
          praise: praise[0],
        };
      })
      .sort((a, b) => b.list.length - a.list.length);
  }, [items]);

  if (!products.length) return <EmptyState title="No products in this view">Clear a filter or widen the time range.</EmptyState>;

  return (
    <div className="products-view">
      <p className="view-intro muted">
        Every product mentioned in the current view, busiest first. The top concern is the most urgent unresolved negative item; the top praise is the
        highest-scoring positive one.
      </p>
      <div className="table-wrap">
        <table className="data-table products-table">
          <colgroup>
            <col className="c-pname" />
            <col className="c-balance" />
            <col className="c-num" />
            <col className="c-num" />
            {showTickets && <col className="c-num" />}
            {showVoices && <col className="c-voices" />}
          </colgroup>
          <thead>
            <tr>
              <th>Product</th>
              <th>Sentiment balance</th>
              <th className="num">Index</th>
              <th className="num">Urgent</th>
              {showTickets && <th className="num">Tickets</th>}
              {showVoices && <th>Top concern and praise</th>}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.name}>
                <td>
                  <button type="button" className="link-btn strong" onClick={() => onDrill({ product: p.name })}>
                    {p.name}
                  </button>
                  <span className="cell-sub">{plural(p.list.length, 'item')}</span>
                </td>
                <td>
                  <BalanceBar items={p.list} />
                </td>
                <td className={`num ${p.index < 0 ? 'neg-text' : p.index > 0 ? 'pos-text' : ''}`}>{signed(p.index)}</td>
                <td className="num">{p.high || <span className="muted">0</span>}</td>
                {showTickets && <td className="num">{p.tickets || <span className="muted">0</span>}</td>}
                {showVoices && (
                <td className="voices">
                  {p.concern ? (
                    <button type="button" className="voice neg" onClick={() => onOpen(p.concern.id)}>
                      <span className="voice-mark" aria-hidden="true" />
                      <span className="voice-text">{p.concern.headline}</span>
                    </button>
                  ) : (
                    <span className="voice muted">No open complaints</span>
                  )}
                  {p.praise && (
                    <button type="button" className="voice pos" onClick={() => onOpen(p.praise.id)}>
                      <span className="voice-mark" aria-hidden="true" />
                      <span className="voice-text">{p.praise.headline}</span>
                    </button>
                  )}
                </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

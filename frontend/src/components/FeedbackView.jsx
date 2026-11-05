import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCheck, ChevronLeft, ChevronRight, Search, Sparkles, X } from 'lucide-react';
import { EmptyState, SentimentTag, SourceTag, StarButton, StatusTag, UrgencyTag } from './bits.jsx';
import { URGENCY_ORDER, plural, timeAgo, fullDate } from '../lib/format.js';
import { VIEWS } from '../lib/views.js';
import { api } from '../lib/api.js';
import { useBreakpoint } from '../lib/useBreakpoint.js';

const PAGE_SIZE = 25;

const SORTS = {
  date: (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
  sentiment: (a, b) => a.score - b.score,
  urgency: (a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency],
  product: (a, b) => a.product.localeCompare(b.product),
};

function SortHeader({ id, label, sort, setSort, className }) {
  const active = sort.key === id;
  const Icon = sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        className={`th-sort ${active ? 'active' : ''}`}
        onClick={() => setSort({ key: id, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
      >
        {label}
        {active && <Icon size={13} aria-hidden="true" />}
      </button>
    </th>
  );
}

export default function FeedbackView({ items, view, setView, selectedId, onOpen, onListChange, onBulkReview, query, setQuery, onToggleStar }) {
  const [confirmAll, setConfirmAll] = useState(false);
  const [mode, setMode] = useState('keyword'); // keyword | meaning
  const [semantic, setSemantic] = useState(null); // { query, ids: Map<id, score> } | { error }
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(0);
  const bp = useBreakpoint();
  const wide = bp === 'lg';
  const showProduct = bp !== 'sm';

  useEffect(() => setPage(0), [items.length, view, query, mode, semantic, sort]);

  const viewCounts = useMemo(() => Object.fromEntries(Object.entries(VIEWS).map(([k, v]) => [k, items.filter(v.test).length])), [items]);

  const runSemantic = async () => {
    const q = query.trim();
    if (!q) return setSemantic(null);
    setSearching(true);
    try {
      const data = await api.search(q);
      setSemantic({ query: q, ids: new Map(data.results.map((r) => [r.id, r.score])) });
    } catch (err) {
      setSemantic({ query: q, error: err.message });
    } finally {
      setSearching(false);
    }
  };

  const rows = useMemo(() => {
    let list = items.filter((VIEWS[view] || VIEWS.all).test);
    if (mode === 'keyword' && query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((i) =>
        [i.headline, i.summary, i.text, i.author, i.product, ...i.labels].some((f) => f && f.toLowerCase().includes(q))
      );
    }
    if (mode === 'meaning' && semantic?.ids) {
      list = list.filter((i) => semantic.ids.has(i.id)).sort((a, b) => semantic.ids.get(b.id) - semantic.ids.get(a.id));
      return list; // keep relevance order
    }
    const cmp = SORTS[sort.key];
    const sorted = [...list].sort(cmp);
    const natural = sort.key === 'date' ? 'desc' : 'asc';
    return sort.dir === natural ? sorted : sorted.reverse();
  }, [items, view, query, mode, semantic, sort]);

  // The drawer steps through exactly this list (j/k), across pages.
  useEffect(() => onListChange(rows.map((r) => r.id)), [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the selected item's page in view while stepping through.
  useEffect(() => {
    const idx = rows.findIndex((r) => r.id === selectedId);
    if (idx >= 0 && Math.floor(idx / PAGE_SIZE) !== page) setPage(Math.floor(idx / PAGE_SIZE));
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const clearSearch = () => {
    setQuery('');
    setSemantic(null);
  };

  return (
    <div className="feedback-view">
      <div className="view-tabs" role="group" aria-label="Show">
        {Object.entries(VIEWS).map(([k, v]) => (
          <button key={k} type="button" aria-pressed={view === k} className={view === k ? 'active' : ''} onClick={() => setView(k)}>
            {v.label}
            <span className="view-count">{viewCounts[k]}</span>
          </button>
        ))}
        {view === 'review' && rows.length > 0 && (
          <>
            <span className="view-hint muted">Open one, then use j and k to move and r to mark reviewed.</span>
            <button
              type="button"
              className={`btn ${confirmAll ? 'danger' : 'ghost'} push-right`}
              onClick={() => {
                if (!confirmAll) return setConfirmAll(true);
                setConfirmAll(false);
                onBulkReview(rows.map((r) => r.id));
              }}
              onBlur={() => setConfirmAll(false)}
            >
              <CheckCheck size={16} aria-hidden="true" /> {confirmAll ? `Confirm: mark ${plural(rows.length, 'item')} reviewed` : 'Mark all reviewed'}
            </button>
          </>
        )}
      </div>
      <div className="toolbar">
        <form
          className="search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'meaning') runSemantic();
          }}
        >
          {mode === 'meaning' ? <Sparkles size={16} aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (mode === 'meaning') setSemantic(null);
            }}
            placeholder={mode === 'meaning' ? 'Describe a problem, e.g. "uploads timing out", then press Enter' : 'Filter by words in the feedback, author or label'}
            aria-label="Search feedback"
          />
          {query && (
            <button type="button" className="icon-btn" onClick={clearSearch} aria-label="Clear search">
              <X size={15} />
            </button>
          )}
        </form>
        <div className="segmented" role="group" aria-label="Search mode">
          <button type="button" aria-pressed={mode === 'keyword'} onClick={() => { setMode('keyword'); setSemantic(null); }}>
            Exact words
          </button>
          <button type="button" aria-pressed={mode === 'meaning'} onClick={() => setMode('meaning')}>
            Similar meaning
          </button>
        </div>
      </div>

      {mode === 'meaning' && (
        <p className="search-note muted">
          {searching
            ? 'Searching…'
            : semantic?.error
              ? `Search failed: ${semantic.error}`
              : semantic
                ? `Closest ${rows.length} matches for "${semantic.query}", most similar first.`
                : 'Finds feedback about the same problem even when it uses different words.'}
        </p>
      )}

      {rows.length === 0 ? (
        view === 'review' && !query ? (
          <EmptyState title="All caught up">Everything in this view has been reviewed. New feedback arrives every hour.</EmptyState>
        ) : (
          <EmptyState title="No feedback matches">
            {query ? 'Try other words, or switch search mode.' : 'Clear a filter, pick another view, or widen the time range.'}
          </EmptyState>
        )
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table feedback-table">
              <colgroup>
                <col className="c-date" />
                <col className="c-feedback" />
                {showProduct && <col className="c-product" />}
                <col className="c-sentiment" />
                {wide && <col className="c-urgency" />}
                {wide && <col className="c-status" />}
              </colgroup>
              <thead>
                <tr>
                  <SortHeader id="date" label="Received" sort={sort} setSort={setSort} />
                  <th>Feedback</th>
                  {showProduct && <SortHeader id="product" label="Product" sort={sort} setSort={setSort} />}
                  <SortHeader id="sentiment" label={bp === 'sm' ? 'Score' : 'Sentiment'} sort={sort} setSort={setSort} />
                  {wide && <SortHeader id="urgency" label="Urgency" sort={sort} setSort={setSort} />}
                  {wide && <th>Status</th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr
                    key={item.id}
                    className={item.id === selectedId ? 'selected' : ''}
                    onClick={() => onOpen(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpen(item.id);
                      }
                    }}
                    tabIndex={0}
                    aria-label={`Open: ${item.headline}`}
                  >
                    <td className="cell-date" title={fullDate(item.timestamp)}>
                      {timeAgo(item.timestamp)}
                    </td>
                    <td className="cell-feedback">
                      <span className="fb-title-row">
                        <StarButton starred={item.starred} onToggle={() => onToggleStar(item)} size={14} className="inline" />
                        <span className="fb-title">{item.headline}</span>
                        {item.notesCount > 0 && <span className="note-count" title={`${item.notesCount} team notes`}>{item.notesCount}</span>}
                      </span>
                      <span className="fb-sub">
                        <SourceTag source={item.source} compact={bp === 'sm'} />
                        {!wide && item.urgency === 'High' && <UrgencyTag urgency="High" />}
                        <span className="fb-summary">{item.thread ? `in ${item.thread}` : item.summary}</span>
                      </span>
                    </td>
                    {showProduct && <td>{item.product}</td>}
                    <td>
                      <SentimentTag score={item.score} sentiment={item.sentiment} />
                    </td>
                    {wide && (
                      <td>
                        <UrgencyTag urgency={item.urgency} />
                      </td>
                    )}
                    {wide && (
                      <td>
                        <StatusTag item={item} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="muted">
              {page * PAGE_SIZE + 1}–{Math.min(rows.length, (page + 1) * PAGE_SIZE)} of {rows.length}
            </span>
            <div className="pager-btns">
              <button type="button" className="btn ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft size={16} /> Previous
              </button>
              <button type="button" className="btn ghost" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

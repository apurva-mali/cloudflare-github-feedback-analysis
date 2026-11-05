import { useCallback, useEffect, useMemo, useState } from 'react';
import { Filter, Link2, RefreshCw, X } from 'lucide-react';
import cfLogo from './assets/cf-logo-v2.png';
import { api } from './lib/api.js';
import { RANGES, SENTIMENTS, STATUS_FILTERS, inInbox, matchesStatus, normalizeFeedback, timeAgo, fullDate, ticketKey } from './lib/format.js';
import { VIEWS } from './lib/views.js';
import { useBreakpoint } from './lib/useBreakpoint.js';
import Overview from './components/Overview.jsx';
import FeedbackView from './components/FeedbackView.jsx';
import HighlightsView from './components/HighlightsView.jsx';
import ProductsView from './components/ProductsView.jsx';
import TicketsView from './components/TicketsView.jsx';
import DetailDrawer from './components/DetailDrawer.jsx';
import TicketForm from './components/TicketForm.jsx';
import './App.css';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'products', label: 'Products' },
  { key: 'tickets', label: 'Tickets' },
];
const FILTERED_TABS = new Set(['overview', 'feedback', 'highlights', 'products']);
const FILTER_KEYS = ['source', 'product', 'type', 'urgency', 'status', 'sentiment'];
const EMPTY_FILTERS = Object.fromEntries(FILTER_KEYS.map((k) => [k, '']));
const DEFAULT_RANGE = '30d';

// ---- Shareable view state in the URL hash: #tab?range=7d&product=R2&view=review&item=… ----
function parseHash(hash = window.location.hash) {
  const [rawTab, query = ''] = hash.replace(/^#/, '').split('?');
  const p = new URLSearchParams(query);
  return {
    tab: TABS.some((t) => t.key === rawTab) ? rawTab : 'overview',
    range: RANGES.some((r) => r.key === p.get('range')) ? p.get('range') : DEFAULT_RANGE,
    filters: Object.fromEntries(FILTER_KEYS.map((k) => [k, p.get(k) || ''])),
    query: p.get('q') || '',
    view: VIEWS[p.get('view')] ? p.get('view') : 'all',
    item: p.get('item') || null,
  };
}

function buildHash({ tab, range, filters, query, view, item }) {
  const p = new URLSearchParams();
  if (range !== DEFAULT_RANGE) p.set('range', range);
  for (const k of FILTER_KEYS) if (filters[k]) p.set(k, filters[k]);
  if (query) p.set('q', query);
  if (tab === 'feedback' && view && view !== 'all') p.set('view', view);
  if (item) p.set('item', item);
  const qs = p.toString();
  return `#${tab}${qs ? `?${qs}` : ''}`;
}

function Select({ label, value, options, onChange, format = (v) => v }) {
  return (
    <label className={`filter ${value ? 'active' : ''}`}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">{label}: all</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {label}: {format(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Map API change payloads onto the UI's item shape (for optimistic updates). */
function applyLocal(item, changes) {
  const now = new Date().toISOString();
  const next = { ...item };
  if ('starred' in changes) next.starred = changes.starred;
  if ('reviewed' in changes) next.reviewedAt = changes.reviewed ? now : null;
  if ('responded' in changes) next.respondedAt = changes.responded ? now : null;
  if ('highlight_tags' in changes) {
    next.highlightTags = changes.highlight_tags;
    if (changes.highlight_tags.length) next.reviewedAt = next.reviewedAt || now;
  }
  if ('feedback_status' in changes) {
    next.status = changes.feedback_status;
    next.dismissedReason = changes.feedback_status === 'Dismissed' ? changes.dismissed_reason : null;
    if (changes.feedback_status !== 'Open') next.reviewedAt = next.reviewedAt || now;
  }
  return next;
}

export default function App() {
  const initial = useMemo(() => parseHash(), []);
  const [tab, setTab] = useState(initial.tab);
  const [range, setRange] = useState(initial.range);
  const [filters, setFilters] = useState(initial.filters);
  const [query, setQuery] = useState(initial.query);
  const [view, setView] = useState(initial.view);
  const [selectedId, setSelectedId] = useState(initial.item);
  const [navIds, setNavIds] = useState([]);

  const [rows, setRows] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [ticketsUnavailable, setTicketsUnavailable] = useState(false);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [sync, setSync] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [ticketDraft, setTicketDraft] = useState(null); // feedback item
  const [focusTicket, setFocusTicket] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const bp = useBreakpoint();

  const notify = useCallback((message, tone = 'ok') => setToast({ message, tone, at: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Data ----------------------------------------------------------------
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setLoadError(null);
    const [fb, tk, st] = await Promise.allSettled([api.feedback(), api.tickets(), api.syncStatus()]);
    if (fb.status === 'fulfilled') {
      const raw = fb.value.results || [];
      setRows(raw.map(normalizeFeedback));
      // Columns from the latest migration missing → the database needs `npm run db:migrate`.
      setNeedsMigration(raw.length > 0 && !('relevance_checked' in raw[0]));
    } else setLoadError(fb.reason.message);
    if (tk.status === 'fulfilled') {
      setTickets(tk.value.tickets || []);
      setTicketsUnavailable(false);
    } else {
      setTickets([]);
      setTicketsUnavailable(/no such table/i.test(tk.reason?.data?.details || ''));
    }
    if (st.status === 'fulfilled') setSync(st.value.streams || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();  
  }, [load]);

  // ---- URL state -----------------------------------------------------------
  useEffect(() => {
    const next = buildHash({ tab, range, filters, query, view, item: selectedId });
    if (window.location.hash !== next) window.history.replaceState(null, '', next);
  }, [tab, range, filters, query, view, selectedId]);

  useEffect(() => {
    // Back/forward or a pasted link: adopt the whole view from the URL.
    const onHash = () => {
      const s = parseHash();
      setTab(s.tab);
      setRange(s.range);
      setFilters(s.filters);
      setQuery(s.query);
      setView(s.view);
      setSelectedId(s.item);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const goTab = (key) => {
    if (key === tab) return;
    window.history.pushState(null, '', buildHash({ tab: key, range, filters, query, view, item: null }));
    setTab(key);
    setSelectedId(null);
  };

  const copyLink = async (item) => {
    const hash = buildHash({ tab, range, filters, query, view, item: item?.id || null });
    const url = `${window.location.origin}${window.location.pathname}${hash}`;
    try {
      await navigator.clipboard.writeText(url);
      notify(item ? 'Link to this feedback copied' : 'Link to this view copied');
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  // ---- Filtering -----------------------------------------------------------
  const rangeDays = RANGES.find((r) => r.key === range)?.days ?? null;
  const matchesFilters = useCallback(
    (r) =>
      (!filters.source || r.source === filters.source) &&
      (!filters.product || r.product === filters.product) &&
      (!filters.type || r.type === filters.type) &&
      (!filters.urgency || r.urgency === filters.urgency) &&
      matchesStatus(r, filters.status) &&
      (!filters.sentiment || r.sentiment === filters.sentiment),
    [filters]
  );
  // Including dismissed items (the Feedback tab's "Dismissed" view needs them)…
  const filteredAll = useMemo(() => {
    const cutoff = rangeDays ? Date.now() - rangeDays * 86400000 : null;
    return rows.filter((r) => (!cutoff || new Date(r.timestamp).getTime() >= cutoff) && matchesFilters(r));
  }, [rows, rangeDays, matchesFilters]);
  // …and without them, for everything else: dismissed means off-topic or not actionable.
  const filtered = useMemo(() => filteredAll.filter((r) => r.status !== 'Dismissed'), [filteredAll]);
  // The same filters over the period before, for "vs previous" comparisons.
  const previous = useMemo(() => {
    if (!rangeDays) return null;
    const end = Date.now() - rangeDays * 86400000;
    const start = end - rangeDays * 86400000;
    return rows.filter((r) => {
      const t = new Date(r.timestamp).getTime();
      return t >= start && t < end && r.status !== 'Dismissed' && matchesFilters(r);
    });
  }, [rows, rangeDays, matchesFilters]);

  const options = useMemo(() => {
    const uniq = (key) => [...new Set(rows.map((r) => r[key]))].filter(Boolean).sort();
    return { source: uniq('source'), product: uniq('product'), type: uniq('type') };
  }, [rows]);

  const activeFilters = FILTER_KEYS.filter((k) => filters[k]).length;
  const setFilter = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));

  const drill = ({ tab: target, view: nextView, ...next }) => {
    if (nextView) setView(nextView);
    if (Object.keys(next).length) {
      setFilters((f) => ({ ...f, ...next }));
      if (!nextView) setView('all');
    }
    goTab(target || 'feedback');
  };

  // ---- Actions -------------------------------------------------------------
  const selected = rows.find((r) => r.id === selectedId) || null;
  const patchRow = (id, fn) => setRows((rs) => rs.map((r) => (r.id === id ? fn(r) : r)));

  const updateItem = async (item, changes, message) => {
    if (needsMigration) return notify('This needs the latest database update: run npm run db:migrate, then deploy.', 'error');
    const before = item;
    patchRow(item.id, (r) => applyLocal(r, changes));
    setBusy(true);
    try {
      await api.updateFeedback(item.id, changes);
      if (message) notify(message);
    } catch (err) {
      patchRow(item.id, () => before);
      notify(`Couldn't update: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const bulkReview = async (ids) => {
    const now = new Date().toISOString();
    const set = new Set(ids);
    setRows((rs) => rs.map((r) => (set.has(r.id) ? { ...r, reviewedAt: now } : r)));
    try {
      for (let i = 0; i < ids.length; i += 200) await api.bulkUpdate(ids.slice(i, i + 200), { reviewed: true });
      notify(`Marked ${ids.length} items as reviewed`);
    } catch (err) {
      notify(`Couldn't mark all as reviewed: ${err.message}`, 'error');
      load({ quiet: true });
    }
  };

  const setNotesCount = (id, n) => patchRow(id, (r) => ({ ...r, notesCount: n }));

  const raiseTicket = (item) => {
    if (ticketsUnavailable) return notify('Tickets need a database update first. See the Tickets tab.', 'error');
    setTicketDraft(item);
  };

  const createTicket = async (payload) => {
    const { ticket } = await api.createTicket(payload); // errors are shown inside the form
    setTicketDraft(null);
    notify(`Created ticket ${ticketKey(ticket.id)}`);
    await load({ quiet: true });
  };

  const updateTicket = async (id, changes) => {
    const before = tickets.find((t) => t.id === id);
    setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, ...changes } : t)));
    try {
      const { ticket } = await api.updateTicket(id, changes);
      setTickets((ts) => ts.map((t) => (t.id === id ? ticket : t)));
      if (changes.status) {
        notify(`${ticketKey(id)} moved to ${changes.status}`);
        load({ quiet: true });
      }
    } catch (err) {
      setTickets((ts) => ts.map((t) => (t.id === id ? before : t)));
      notify(`Couldn't update ${ticketKey(id)}: ${err.message}`, 'error');
    }
  };

  const viewTicket = (id) => {
    setSelectedId(null);
    setFocusTicket(id);
    goTab('tickets');
  };

  // ---- Header numbers --------------------------------------------------------
  const lastSync = sync.reduce((latest, s) => (s.last_run_at > (latest || '') ? s.last_run_at : latest), null);
  const syncTitle = sync.map((s) => `${s.stream}: ${fullDate(s.last_run_at)}`).join('\n');
  const openTickets = tickets.filter((t) => t.status !== 'Resolved').length;
  const reviewCount = useMemo(() => rows.filter(inInbox).length, [rows]);
  const counts = { feedback: reviewCount, tickets: openTickets };
  const rangeLabel = { '7d': '7 days', '30d': '30 days', '90d': '90 days' }[range] || 'period';

  // Step through the Feedback list from the drawer (j / k).
  const navIndex = tab === 'feedback' ? navIds.indexOf(selectedId) : -1;
  const nav =
    navIndex >= 0
      ? {
          index: navIndex,
          total: navIds.length,
          onPrev: () => navIndex > 0 && setSelectedId(navIds[navIndex - 1]),
          onNext: () => navIndex < navIds.length - 1 && setSelectedId(navIds[navIndex + 1]),
        }
      : null;

  const panelProps = {
    busy,
    notify,
    onUpdate: updateItem,
    onRaiseTicket: raiseTicket,
    onViewTicket: viewTicket,
    onCopyLink: copyLink,
    setNotesCount,
  };
  const drawerOpen = Boolean(selected) && !ticketDraft;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={cfLogo} alt="" className="brand-logo" />
          <div className="brand-text">
            <span className="brand-name">Cloudflare Voice</span>
            <span className="brand-sub">Developer feedback from GitHub and Hacker News</span>
          </div>
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <a
              key={t.key}
              href={`#${t.key}`}
              className={`tab ${tab === t.key ? 'active' : ''}`}
              aria-current={tab === t.key ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                goTab(t.key);
              }}
            >
              {t.label}
              {counts[t.key] > 0 && (
                <span className="tab-count" title={t.key === 'feedback' ? `${counts[t.key]} to review` : `${counts[t.key]} open`}>
                  {counts[t.key]}
                </span>
              )}
            </a>
          ))}
        </nav>
        <div className="sync" title={syncTitle || undefined}>
          {lastSync && <span className="muted sync-text">Synced {timeAgo(lastSync)}</span>}
          <button type="button" className="btn ghost" onClick={() => load()} disabled={loading} aria-label="Reload data">
            <RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" />
            <span className="hide-sm">Reload</span>
          </button>
        </div>
      </header>

      {needsMigration && (
        <div className="banner" role="status">
          New features need a database update. In the project folder run <code>npm run db:migrate</code>, then <code>npm run deploy</code>.
        </div>
      )}

      {FILTERED_TABS.has(tab) && (
        <div className="filterbar">
          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
                {r.label}
              </button>
            ))}
          </div>
          {bp === 'sm' && (
            <button type="button" className="btn" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((o) => !o)}>
              <Filter size={15} aria-hidden="true" /> Filters{activeFilters ? ` (${activeFilters})` : ''}
            </button>
          )}
          <div className="filters" hidden={bp === 'sm' && !filtersOpen}>
            <Select label="Source" value={filters.source} options={options.source} onChange={setFilter('source')} />
            <Select label="Product" value={filters.product} options={options.product} onChange={setFilter('product')} />
            <Select
              label="Sentiment"
              value={filters.sentiment}
              options={SENTIMENTS.map((s) => s.key)}
              format={(k) => SENTIMENTS.find((s) => s.key === k).label}
              onChange={setFilter('sentiment')}
            />
            <Select label="Type" value={filters.type} options={options.type} onChange={setFilter('type')} />
            <Select label="Urgency" value={filters.urgency} options={['High', 'Neutral', 'Low']} onChange={setFilter('urgency')} />
            <Select label="Status" value={filters.status} options={STATUS_FILTERS} onChange={setFilter('status')} />
            {activeFilters > 0 && (
              <button type="button" className="btn ghost clear" onClick={() => setFilters(EMPTY_FILTERS)}>
                <X size={14} aria-hidden="true" /> Clear {activeFilters === 1 ? 'filter' : `${activeFilters} filters`}
              </button>
            )}
          </div>
          <div className="filterbar-end">
            <span className="result-count muted">
              {filtered.length} of {rows.length} items
            </span>
            <button type="button" className="btn ghost" onClick={() => copyLink(null)} title="Copy a link to this exact view">
              <Link2 size={15} aria-hidden="true" /> <span className="hide-sm">Copy link</span>
            </button>
          </div>
        </div>
      )}

      <main className="content">
        {loadError ? (
          <div className="error-box" role="alert">
            <p>
              <strong>Couldn't load feedback.</strong> {loadError}
            </p>
            <button type="button" className="btn" onClick={() => load()}>
              Try again
            </button>
          </div>
        ) : loading && !rows.length ? (
          <div className="loading" aria-busy="true">
            Loading feedback…
          </div>
        ) : (
          <>
            {tab === 'overview' && (
              <Overview
                items={filtered}
                previous={previous}
                allItems={rows}
                tickets={tickets}
                rangeDays={rangeDays}
                rangeLabel={rangeLabel}
                onOpen={setSelectedId}
                onDrill={drill}
              />
            )}
            {tab === 'feedback' && (
              <FeedbackView
                items={filteredAll}
                view={view}
                setView={setView}
                selectedId={selectedId}
                onOpen={setSelectedId}
                onListChange={setNavIds}
                onBulkReview={bulkReview}
                query={query}
                setQuery={setQuery}
                onToggleStar={(item) => updateItem(item, { starred: !item.starred }, item.starred ? 'Star removed' : 'Starred')}
              />
            )}
            {tab === 'highlights' && <HighlightsView items={filtered} unavailable={needsMigration} onUpdate={updateItem} onOpen={setSelectedId} notify={notify} />}
            {tab === 'products' && <ProductsView items={filtered} onDrill={drill} />}
            {tab === 'tickets' && (
              <TicketsView
                key={focusTicket || 'tickets'}
                tickets={tickets}
                unavailable={ticketsUnavailable}
                focusId={focusTicket}
                onUpdate={updateTicket}
                onOpenFeedback={setSelectedId}
              />
            )}
          </>
        )}
      </main>

      <DetailDrawer
        item={drawerOpen ? selected : null}
        nav={nav}
        onClose={() => setSelectedId(null)}
        {...panelProps}
      />

      {ticketDraft && (
        <TicketForm
          item={ticketDraft}
          products={options.product.filter((p) => p !== 'Unknown')}
          onCancel={() => setTicketDraft(null)}
          onSubmit={createTicket}
        />
      )}

      <div className="toast-region" aria-live="polite">
        {toast && (
          <div key={toast.at} className={`toast ${toast.tone}`}>
            {toast.message}
          </div>
        )}
      </div>
    </div>
  );
}

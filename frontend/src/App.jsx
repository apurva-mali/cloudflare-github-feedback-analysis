import { useCallback, useEffect, useMemo, useState } from 'react';
import { Filter, RefreshCw, X } from 'lucide-react';
import cfLogo from './assets/cf-logo-v2.png';
import { api } from './lib/api.js';
import { RANGES, SENTIMENTS, normalizeFeedback, timeAgo, fullDate, ticketKey } from './lib/format.js';
import Overview from './components/Overview.jsx';
import FeedbackView from './components/FeedbackView.jsx';
import ProductsView from './components/ProductsView.jsx';
import TicketsView from './components/TicketsView.jsx';
import DetailDrawer from './components/DetailDrawer.jsx';
import TicketForm from './components/TicketForm.jsx';
import { useBreakpoint } from './lib/useBreakpoint.js';
import './App.css';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'products', label: 'Products' },
  { key: 'tickets', label: 'Tickets' },
];

const EMPTY_FILTERS = { source: '', product: '', type: '', urgency: '', status: '', sentiment: '' };

function tabFromHash() {
  const key = window.location.hash.replace('#', '');
  return TABS.some((t) => t.key === key) ? key : 'overview';
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

export default function App() {
  const [tab, setTab] = useState(tabFromHash);
  const [rows, setRows] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [ticketsUnavailable, setTicketsUnavailable] = useState(false);
  const [sync, setSync] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [range, setRange] = useState('30d');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState(null);
  const [ticketFor, setTicketFor] = useState(null);
  const [focusTicket, setFocusTicket] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const bp = useBreakpoint();

  const notify = useCallback((message, tone = 'ok') => {
    setToast({ message, tone, at: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [fb, tk, st] = await Promise.allSettled([api.feedback(), api.tickets(), api.syncStatus()]);
    if (fb.status === 'fulfilled') setRows((fb.value.results || []).map(normalizeFeedback));
    else setLoadError(fb.reason.message);
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

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const goTab = (key) => {
    window.location.hash = key;
    setTab(key);
  };

  // ---- Filtering -----------------------------------------------------------
  const rangeDays = RANGES.find((r) => r.key === range)?.days ?? null;
  const inRange = useMemo(() => {
    if (!rangeDays) return rows;
    const cutoff = Date.now() - rangeDays * 86400000;
    return rows.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
  }, [rows, rangeDays]);

  const filtered = useMemo(
    () =>
      inRange.filter(
        (r) =>
          (!filters.source || r.source === filters.source) &&
          (!filters.product || r.product === filters.product) &&
          (!filters.type || r.type === filters.type) &&
          (!filters.urgency || r.urgency === filters.urgency) &&
          (!filters.status || r.status === filters.status) &&
          (!filters.sentiment || r.sentiment === filters.sentiment)
      ),
    [inRange, filters]
  );

  const options = useMemo(() => {
    const uniq = (key) => [...new Set(rows.map((r) => r[key]))].filter(Boolean).sort();
    return { source: uniq('source'), product: uniq('product'), type: uniq('type') };
  }, [rows]);

  const activeFilters = Object.values(filters).filter(Boolean).length;
  const setFilter = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));

  const drill = ({ tab: target, ...next }) => {
    if (target) return goTab(target);
    setFilters((f) => ({ ...f, ...next }));
    goTab('feedback');
  };

  // ---- Actions -------------------------------------------------------------
  const selected = rows.find((r) => r.id === selectedId) || null;

  const patchRow = (id, changes) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...changes } : r)));

  const setStatus = async (item, status) => {
    setBusy(true);
    const previous = item.status;
    patchRow(item.id, { status });
    try {
      await api.setFeedbackStatus(item.id, status);
      notify(status === 'Resolved' ? 'Marked as resolved' : 'Reopened');
    } catch (err) {
      patchRow(item.id, { status: previous });
      notify(`Couldn't update status: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const createTicket = async (payload) => {
    const { ticket } = await api.createTicket(payload); // errors are shown inside the form
    setTickets((ts) => [ticket, ...ts]);
    patchRow(payload.feedback_id, { status: 'Ticket Raised', ticketId: ticket.id, ticketStatus: ticket.status, ticketPriority: ticket.priority });
    setTicketFor(null);
    notify(`Created ticket ${ticketKey(ticket.id)}`);
  };

  const updateTicket = async (id, changes) => {
    const before = tickets.find((t) => t.id === id);
    setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, ...changes } : t)));
    try {
      const { ticket } = await api.updateTicket(id, changes);
      setTickets((ts) => ts.map((t) => (t.id === id ? ticket : t)));
      patchRow(ticket.feedback_id, {
        ticketStatus: ticket.status,
        ticketPriority: ticket.priority,
        status: ticket.status === 'Resolved' ? 'Resolved' : 'Ticket Raised',
      });
      if (changes.status) notify(`${ticketKey(id)} moved to ${changes.status}`);
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

  // ---- Header sync status --------------------------------------------------
  const lastSync = sync.reduce((latest, s) => (s.last_run_at > (latest || '') ? s.last_run_at : latest), null);
  const syncTitle = sync.map((s) => `${s.stream}: ${fullDate(s.last_run_at)}`).join('\n');
  const openTickets = tickets.filter((t) => t.status !== 'Resolved').length;

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
              {t.key === 'tickets' && openTickets > 0 && <span className="tab-count">{openTickets}</span>}
            </a>
          ))}
        </nav>
        <div className="sync" title={syncTitle || undefined}>
          {lastSync && <span className="muted sync-text">Synced {timeAgo(lastSync)}</span>}
          <button type="button" className="btn ghost" onClick={load} disabled={loading} aria-label="Reload data">
            <RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" />
            <span className="hide-sm">Reload</span>
          </button>
        </div>
      </header>

      {tab !== 'tickets' && (
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
            <Select label="Status" value={filters.status} options={['Open', 'Ticket Raised', 'Resolved']} onChange={setFilter('status')} />
            {activeFilters > 0 && (
              <button type="button" className="btn ghost clear" onClick={() => setFilters(EMPTY_FILTERS)}>
                <X size={14} aria-hidden="true" /> Clear {activeFilters === 1 ? 'filter' : `${activeFilters} filters`}
              </button>
            )}
          </div>
          <span className="result-count muted">
            {filtered.length} of {rows.length} items
          </span>
        </div>
      )}

      <main className="content">
        {loadError ? (
          <div className="error-box" role="alert">
            <p>
              <strong>Couldn't load feedback.</strong> {loadError}
            </p>
            <button type="button" className="btn" onClick={load}>
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
              <Overview items={filtered} allItems={rows} tickets={tickets} rangeDays={rangeDays} onOpen={setSelectedId} onDrill={drill} />
            )}
            {tab === 'feedback' && <FeedbackView items={filtered} selectedId={selectedId} onOpen={setSelectedId} />}
            {tab === 'products' && <ProductsView items={filtered} onDrill={drill} onOpen={setSelectedId} />}
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
        item={ticketFor ? null : selected}
        busy={busy}
        onClose={() => setSelectedId(null)}
        onRaiseTicket={(item) => {
          if (ticketsUnavailable) return notify('Tickets need a database update first. See the Tickets tab.', 'error');
          setTicketFor(item);
        }}
        onSetStatus={setStatus}
        onViewTicket={viewTicket}
      />

      {ticketFor && (
        <TicketForm
          item={ticketFor}
          products={options.product.filter((p) => p !== 'Unknown')}
          onCancel={() => setTicketFor(null)}
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

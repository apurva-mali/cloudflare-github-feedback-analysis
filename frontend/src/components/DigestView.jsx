import { useCallback, useEffect, useState } from 'react';
import { Copy, Layers, RefreshCw } from 'lucide-react';
import { EmptyState } from './bits.jsx';
import { api } from '../lib/api.js';
import { SENTIMENTS, plural, signed, timeAgo } from '../lib/format.js';

const fmtWeek = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const weekLabel = (d) => `Week of ${fmtWeek(d)}`;

function Change({ now, before, unit = '' }) {
  if (before == null) return <span className="muted">no data the week before</span>;
  const diff = now - before;
  if (diff === 0) return <span className="muted">same as the week before</span>;
  return (
    <span className={diff > 0 ? 'up' : 'down'}>
      {signed(diff)}
      {unit} vs the week before
    </span>
  );
}

function MiniBar({ counts }) {
  const total = counts.negative + counts.neutral + counts.positive;
  if (!total) return null;
  return (
    <div className="balance-bar row" role="img" aria-label={`${counts.negative} negative, ${counts.neutral} neutral, ${counts.positive} positive`}>
      {SENTIMENTS.map((s) => (counts[s.key] ? <span key={s.key} className={`seg ${s.key}`} style={{ flexGrow: counts[s.key] }} /> : null))}
    </div>
  );
}

/** Plain-text version for pasting into Slack or email. */
function toText(d) {
  const lines = [
    `Cloudflare Voice — ${weekLabel(d.week_start)}${d.partial ? ' (so far)' : ''}`,
    `${d.totals.count} pieces of feedback, sentiment ${signed(d.totals.index)}${d.totals.prev_index != null ? ` (week before: ${signed(d.totals.prev_index)})` : ''}`,
    '',
  ];
  for (const p of d.products) {
    lines.push(`*${p.product}* — ${plural(p.count, 'item')}, sentiment ${signed(p.index)}`);
    if (p.summary) lines.push(p.summary);
    for (const t of p.themes) lines.push(`• Theme: ${t.title} (${t.count})`);
    for (const u of p.urgent) lines.push(`• Needs attention: ${u.headline}${u.url ? ` ${u.url}` : ''}`);
    for (const g of p.praise) lines.push(`• Praise: ${g.headline}${g.url ? ` ${g.url}` : ''}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

export default function DigestView({ onOpen, onOpenTheme, notify }) {
  const [weeks, setWeeks] = useState([]);
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (week) => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.digests(week);
      setWeeks(d.weeks);
      setDigest(d.digest);
    } catch (err) {
      setError(err.status === 500 ? 'The digest needs the latest database update (npm run db:migrate).' : err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();  
  }, [load]);

  const build = async () => {
    setBuilding(true);
    try {
      const { digest: d } = await api.generateDigest();
      setDigest(d);
      setWeeks((w) => [...new Set([d.week_start, ...w])].sort().reverse());
    } catch (err) {
      notify(`Couldn't build the digest: ${err.message}`, 'error');
    } finally {
      setBuilding(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toText(digest));
      notify('Digest copied. Paste it into Slack or an email.');
    } catch {
      notify('Copy failed.', 'error');
    }
  };

  if (error) return <EmptyState title="Couldn't load digests">{error}</EmptyState>;
  if (loading && !digest) return <div className="loading">Loading digest…</div>;

  return (
    <div className="digest-view">
      <div className="toolbar">
        {weeks.length > 0 && (
          <label className="filter">
            <span className="sr-only">Week</span>
            <select value={digest?.week_start || ''} onChange={(e) => load(e.target.value)}>
              {weeks.map((w) => (
                <option key={w} value={w}>
                  {weekLabel(w)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="btn" onClick={build} disabled={building}>
          <RefreshCw size={15} className={building ? 'spin' : ''} aria-hidden="true" /> {building ? 'Writing digest…' : 'Build this week so far'}
        </button>
        {digest && (
          <button type="button" className="btn ghost" onClick={copy}>
            <Copy size={15} aria-hidden="true" /> Copy as text
          </button>
        )}
        <span className="muted small push-right">A new digest is written every Monday morning for the week before.</span>
      </div>

      {!digest ? (
        <EmptyState title="No digest yet">The first one is written next Monday. Build this week's so far to see one now; it takes about half a minute.</EmptyState>
      ) : (
        <article className="digest">
          <header className="digest-head">
            <div>
              <h2>
                {weekLabel(digest.week_start)}
                {digest.partial && <span className="muted"> (so far)</span>}
              </h2>
              <p className="muted small">Written {timeAgo(digest.generated_at)}</p>
            </div>
            <dl className="digest-totals">
              <div>
                <dt>Feedback</dt>
                <dd>
                  <strong>{digest.totals.count}</strong> <Change now={digest.totals.count} before={digest.totals.prev_count} />
                </dd>
              </div>
              <div>
                <dt>Sentiment index</dt>
                <dd>
                  <strong>{signed(digest.totals.index)}</strong> <Change now={digest.totals.index} before={digest.totals.prev_index} unit=" pts" />
                </dd>
              </div>
              <div>
                <dt>New themes</dt>
                <dd>
                  <strong>{digest.totals.new_themes}</strong>
                </dd>
              </div>
            </dl>
          </header>

          {digest.products.length === 0 ? (
            <p className="muted">No feedback arrived this week.</p>
          ) : (
            <div className="digest-products">
              {digest.products.map((p) => (
                <section key={p.product} className="digest-product" aria-labelledby={`dp-${p.product}`}>
                  <div className="dp-head">
                    <h3 id={`dp-${p.product}`}>{p.product}</h3>
                    <span className="muted">
                      {plural(p.count, 'item')}, sentiment {signed(p.index)}
                      {p.prev_index != null && ` (was ${signed(p.prev_index)})`}
                    </span>
                  </div>
                  <MiniBar counts={p.counts} />
                  {p.summary && <p className="dp-summary">{p.summary}</p>}
                  {p.themes.length > 0 && (
                    <div className="dp-block">
                      <h4>Themes</h4>
                      <ul>
                        {p.themes.map((t) => (
                          <li key={t.id}>
                            <button type="button" className="link-btn" onClick={() => onOpenTheme(t.id)}>
                              <Layers size={13} aria-hidden="true" /> {t.title}
                            </button>{' '}
                            <span className="muted">{t.count} this week</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {p.urgent.length > 0 && (
                    <div className="dp-block">
                      <h4>Needs attention</h4>
                      <ul>
                        {p.urgent.map((u) => (
                          <li key={u.id}>
                            <span className="voice-mark neg" aria-hidden="true" />
                            <button type="button" className="link-btn" onClick={() => onOpen(u.id)}>
                              {u.headline}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {p.praise.length > 0 && (
                    <div className="dp-block">
                      <h4>Praise</h4>
                      <ul>
                        {p.praise.map((g) => (
                          <li key={g.id}>
                            <span className="voice-mark pos" aria-hidden="true" />
                            <button type="button" className="link-btn" onClick={() => onOpen(g.id)}>
                              {g.headline}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </article>
      )}
    </div>
  );
}

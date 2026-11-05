import { useId, useMemo, useRef, useState } from 'react';
import { useWidth } from '../lib/useWidth.js';
import { rollingIndex } from '../lib/buckets.js';
import { signed } from '../lib/format.js';

const fmtDay = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Tiny trend line for a KPI card. */
export function Sparkline({ values, tone = 'ink', height = 32 }) {
  const ref = useRef(null);
  const width = useWidth(ref, 120);
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return <div ref={ref} className="sparkline empty" style={{ height }} />;
  const vals = pts.map(([, v]) => v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v) => height - 3 - ((v - min) / span) * (height - 6);
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const [li, lv] = pts[pts.length - 1];
  return (
    <div ref={ref} className={`sparkline ${tone}`} aria-hidden="true">
      <svg width={width} height={height}>
        <path d={d} />
        <circle cx={x(li)} cy={y(lv)} r="2.5" />
      </svg>
    </div>
  );
}

/**
 * Sentiment index over time (rolling 7 days). The area above zero is green,
 * below zero red, so the trend reads at a glance. Hover shows the value.
 */
export function TrendChart({ items, rangeDays, height = 220 }) {
  const ref = useRef(null);
  const width = useWidth(ref);
  const clipId = useId().replace(/:/g, '');
  const [hover, setHover] = useState(null);
  const series = useMemo(() => rollingIndex(items, rangeDays), [items, rangeDays]);
  const pts = series.map((p, i) => ({ ...p, i })).filter((p) => p.value != null);

  if (pts.length < 2) return <div ref={ref} className="chart-empty">Not enough feedback in this period to show a trend.</div>;

  const pad = { top: 12, right: 12, bottom: 26, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (i) => pad.left + (i / Math.max(1, series.length - 1)) * plotW;
  const y = (v) => pad.top + ((100 - v) / 200) * plotH;
  const zero = y(0);
  const line = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = `${line}L${x(pts[pts.length - 1].i).toFixed(1)},${zero}L${x(pts[0].i).toFixed(1)},${zero}Z`;
  const labelEvery = Math.ceil(series.length / Math.max(2, Math.floor(plotW / 80)));
  const hp = hover != null ? series[hover] : null;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left - pad.left) / plotW) * (series.length - 1));
    setHover(i >= 0 && i < series.length ? i : null);
  };

  return (
    <div className="trend-chart" ref={ref}>
      <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Sentiment index over time, rolling 7 days">
        <defs>
          <clipPath id={`above-${clipId}`}>
            <rect x={pad.left} y={pad.top} width={plotW} height={Math.max(0, zero - pad.top)} />
          </clipPath>
          <clipPath id={`below-${clipId}`}>
            <rect x={pad.left} y={zero} width={plotW} height={Math.max(0, pad.top + plotH - zero)} />
          </clipPath>
        </defs>
        {[100, 50, 0, -50, -100].map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} className={v === 0 ? 'zero' : 'grid'} />
            <text x={pad.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="axis-label">
              {signed(v)}
            </text>
          </g>
        ))}
        <path d={area} className="area pos" clipPath={`url(#above-${clipId})`} />
        <path d={area} className="area neg" clipPath={`url(#below-${clipId})`} />
        <path d={line} className="line" />
        {series.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.t} x={x(i)} y={height - 8} textAnchor="middle" className="axis-label">
              {fmtDay(p.t)}
            </text>
          ) : null
        )}
        {hp && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} className="crosshair" />
            {hp.value != null && <circle cx={x(hover)} cy={y(hp.value)} r="4" className={`dot ${hp.value >= 0 ? 'pos' : 'neg'}`} />}
          </g>
        )}
      </svg>
      {hp && (
        <div className="chart-tooltip" style={{ left: Math.min(width - 170, Math.max(0, x(hover) - 80)), top: 0 }}>
          <div className="tt-title">
            7 days to {fmtDay(hp.t)}
            <span className="tt-total">{hp.value == null ? '—' : signed(hp.value)}</span>
          </div>
          <div className="tt-row">{hp.total ? `${hp.total} pieces of feedback` : 'No feedback'}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Diverging bars: negative to the left of the centre line, positive to the
 * right, neutral split across the middle. One row per category.
 * rows: [{ key, label, negative, neutral, positive }]
 */
export function DivergingBars({ rows, onSelect }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.negative + r.neutral / 2, r.positive + r.neutral / 2)));
  const pct = (n) => `${(n / max) * 100}%`;
  return (
    <div className="diverging">
      <div className="div-axis-labels" aria-hidden="true">
        <span />
        <span className="neg-text">Negative</span>
        <span className="pos-text">Positive</span>
        <span className="muted">Index</span>
      </div>
      <ul>
        {rows.map((r) => {
          const total = r.negative + r.neutral + r.positive;
          const index = total ? Math.round(((r.positive - r.negative) / total) * 100) : 0;
          return (
            <li key={r.key}>
              <button
                type="button"
                className="div-row"
                onClick={onSelect ? () => onSelect(r.key) : undefined}
                title={`${r.label}: ${r.negative} negative, ${r.neutral} neutral, ${r.positive} positive`}
              >
                <span className="div-label">{r.label}</span>
                <span className="div-side left">
                  {r.negative > 0 && <span className="div-num neg-text">{r.negative}</span>}
                  <span className="div-bar neg" style={{ width: pct(r.negative) }} />
                  <span className="div-bar neu" style={{ width: pct(r.neutral / 2) }} />
                </span>
                <span className="div-side right">
                  <span className="div-bar neu" style={{ width: pct(r.neutral / 2) }} />
                  <span className="div-bar pos" style={{ width: pct(r.positive) }} />
                  {r.positive > 0 && <span className="div-num pos-text">{r.positive}</span>}
                </span>
                <span className={`div-index ${index < 0 ? 'neg-text' : index > 0 ? 'pos-text' : 'muted'}`}>{signed(index)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Simple ranked horizontal bars with value labels (one series). rows: [{ key, label, value }] */
export function HBars({ rows, onSelect }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.key}>
          <button type="button" className="hbar-row" onClick={onSelect ? () => onSelect(r.key) : undefined}>
            <span className="hbar-label">{r.label}</span>
            <span className="hbar-track">
              <span className="hbar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
            <span className="hbar-value">
              {r.value} <span className="muted">({total ? Math.round((r.value / total) * 100) : 0}%)</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

import { useMemo, useRef, useState } from 'react';
import { useWidth } from '../lib/useWidth.js';
import { SENTIMENTS } from '../lib/format.js';
import { bucketize } from '../lib/buckets.js';

const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 32 };
const GAP = 2; // surface gap between stacked segments

function niceMax(n) {
  if (n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / (pow / 2)) * (pow / 2);
}

const fmtDay = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Bottom → top: negative, neutral, positive.
const STACK = ['negative', 'neutral', 'positive'];

export default function VolumeChart({ items, rangeDays }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef);
  const [hover, setHover] = useState(null);
  const { buckets, unit } = useMemo(() => bucketize(items, rangeDays), [items, rangeDays]);

  if (!buckets.length) return <div ref={wrapRef} className="chart-empty">No feedback in this period.</div>;

  const max = niceMax(Math.max(...buckets.map((b) => b.total)));
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / buckets.length;
  const barW = Math.max(2, Math.min(28, slot * 0.7));
  const y = (v) => (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(buckets.length / Math.max(2, Math.floor(plotW / 70)));

  const hovered = hover != null ? buckets[hover] : null;

  return (
    <div className="volume-chart" ref={wrapRef}>
      <svg width={width} height={HEIGHT} role="img" aria-label={`Feedback per ${unit}, split by sentiment`}>
        {ticks.map((t) => (
          <g key={t} transform={`translate(0, ${PAD.top + plotH - y(t)})`}>
            <line x1={PAD.left} x2={width - PAD.right} className="grid" />
            <text x={PAD.left - 8} dy="0.32em" className="axis-label" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          let acc = 0;
          const segs = STACK.filter((k) => b[k] > 0);
          return (
            <g key={b.t}>
              {segs.map((k, si) => {
                const h = y(b[k]);
                const top = PAD.top + plotH - acc - h;
                acc += h;
                const isTop = si === segs.length - 1;
                const r = isTop ? Math.min(4, barW / 2, h) : 0;
                // Leave a 2px surface gap above every segment except the top one.
                const drawH = Math.max(1, isTop ? h : h - GAP);
                const drawTop = isTop ? top : top + GAP;
                return (
                  <path
                    key={k}
                    className={`bar ${k} ${hover === i ? 'is-hover' : ''}`}
                    d={roundedTopRect(cx - barW / 2, drawTop, barW, drawH, r)}
                  />
                );
              })}
              {i % labelEvery === 0 && (
                <text x={cx} y={HEIGHT - 8} className="axis-label" textAnchor="middle">
                  {fmtDay(b.t)}
                </text>
              )}
              <rect
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={plotH}
                className="hit"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
        <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} className="baseline" />
      </svg>
      {hovered && (
        <div
          className="chart-tooltip"
          style={{
            left: Math.min(width - 170, Math.max(0, PAD.left + slot * hover + slot / 2 - 80)),
            top: Math.max(0, PAD.top + plotH - y(hovered.total) - 104),
          }}
        >
          <div className="tt-title">
            {unit === 'week' ? `Week of ${fmtDay(hovered.t)}` : fmtDay(hovered.t)}
            <span className="tt-total">{hovered.total}</span>
          </div>
          {[...SENTIMENTS].reverse().map((s) => (
            <div key={s.key} className="tt-row">
              <span className={`swatch ${s.key}`} aria-hidden="true" />
              {s.label}
              <span className="tt-val">{hovered[s.key]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function roundedTopRect(x, y, w, h, r) {
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

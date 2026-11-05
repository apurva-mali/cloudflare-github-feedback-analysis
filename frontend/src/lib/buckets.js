const DAY = 86400000;

export function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Calendar-day arithmetic. Days are not always 24h long (daylight saving
// adds or removes an hour), so never step through dates by adding milliseconds.
function addDays(t, n) {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}
const daysBetween = (later, earlier) => Math.round((startOfDay(later) - startOfDay(earlier)) / DAY);

/** Bucket items per day (or per week when the span is long). */
export function bucketize(items, rangeDays, now = Date.now()) {
  const times = items.map((i) => new Date(i.timestamp).getTime()).filter(Number.isFinite);
  if (!times.length) return { buckets: [], unit: 'day' };
  const end = startOfDay(now);
  const start = rangeDays ? addDays(end, -(rangeDays - 1)) : startOfDay(Math.min(...times, end));
  const spanDays = daysBetween(end, start) + 1;
  const stepDays = spanDays > 60 ? 7 : 1;
  const buckets = [];
  for (let i = 0; i * stepDays < spanDays; i++) {
    buckets.push({ t: addDays(start, i * stepDays), negative: 0, neutral: 0, positive: 0, total: 0 });
  }
  for (const item of items) {
    const ts = new Date(item.timestamp).getTime();
    if (!Number.isFinite(ts)) continue;
    const idx = Math.floor(daysBetween(ts, start) / stepDays);
    if (idx < 0 || idx >= buckets.length) continue; // outside the chart's window
    const bucket = buckets[idx];
    if (!(item.sentiment in bucket)) continue;
    bucket[item.sentiment]++;
    bucket.total++;
  }
  return { buckets, unit: stepDays === 1 ? 'day' : 'week' };
}

/** Rolling sentiment index per day: (positive − negative) / total over the last `window` days. */
export function rollingIndex(items, rangeDays, window = 7) {
  const { buckets } = bucketize(items, rangeDays);
  return buckets.map((b, i) => {
    let pos = 0;
    let neg = 0;
    let total = 0;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      pos += buckets[j].positive;
      neg += buckets[j].negative;
      total += buckets[j].total;
    }
    return { t: b.t, value: total ? Math.round(((pos - neg) / total) * 100) : null, total };
  });
}

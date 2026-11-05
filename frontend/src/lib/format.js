// Shared vocabulary and helpers for the dashboard.

// Sentiment buckets match the Worker: 1-4 negative, 5-7 neutral, 8-10 positive.
export const SENTIMENTS = [
  { key: 'negative', label: 'Negative', className: 'Detractor', min: 1, max: 4 },
  { key: 'neutral', label: 'Neutral', className: 'Passive', min: 5, max: 7 },
  { key: 'positive', label: 'Positive', className: 'Promoter', min: 8, max: 10 },
];

export function sentimentOf(score) {
  const s = Number(score) || 5;
  if (s >= 8) return 'positive';
  if (s >= 5) return 'neutral';
  return 'negative';
}

export const URGENCY_ORDER = { High: 0, Neutral: 1, Low: 2 };
export const PRIORITIES = [
  { key: 'P0', hint: 'Outage or data loss' },
  { key: 'P1', hint: 'Blocks customers' },
  { key: 'P2', hint: 'Should fix soon' },
  { key: 'P3', hint: 'Nice to have' },
];
export const TICKET_STATUSES = ['Open', 'In Progress', 'Resolved'];

export function priorityFromUrgency(urgency) {
  return urgency === 'High' ? 'P1' : urgency === 'Low' ? 'P3' : 'P2';
}

export const ticketKey = (id) => `CV-${id}`;

/** Sentiment index: % positive minus % negative, -100..100. */
export function sentimentIndex(items) {
  if (!items.length) return 0;
  let pos = 0;
  let neg = 0;
  for (const i of items) {
    if (i.sentiment === 'positive') pos++;
    else if (i.sentiment === 'negative') neg++;
  }
  return Math.round(((pos - neg) / items.length) * 100);
}

export function countBySentiment(items) {
  const counts = { negative: 0, neutral: 0, positive: 0 };
  for (const i of items) counts[i.sentiment]++;
  return counts;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function timeAgo(iso) {
  if (!iso) return '';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fullDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

const isReply = (row) => Boolean(row.title && row.title.startsWith('Re: '));

function firstSentence(text) {
  const s = text.split(/(?<=[.!?])\s/)[0] || text;
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

/** "+12", "−36", "0" with a true minus sign. */
export const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Normalise a row from GET /all into what the UI uses. */
export function normalizeFeedback(row) {
  const text = row.original_text || row.text || '';
  return {
    id: row.id,
    timestamp: row.feedback_timestamp || row.created_at || null,
    author: row.user_id || null,
    source: row.source || 'Unknown',
    product: row.product_category || 'Unknown',
    userType: row.user_type || 'Unknown',
    urgency: row.urgency_level || 'Neutral',
    type: row.feedback_type || 'Other',
    summary: row.summary || '',
    action: row.recommended_action || '',
    status: row.feedback_status || 'Open',
    text,
    score: Number(row.sentiment_score) || 5,
    sentiment: sentimentOf(row.sentiment_score),
    title: row.title || null,
    // A Hacker News comment's title is its thread; what the person said is more useful.
    headline: isReply(row) ? row.summary || firstSentence(text) : row.title || row.summary || firstSentence(text),
    thread: isReply(row) ? row.title.replace(/^Re: /, '') : null,
    url: row.source_url || null,
    repo: row.repo || null,
    labels: Array.isArray(row.labels) ? row.labels : [],
    upstreamState: row.source_state || null,
    reactions: Number(row.reactions) || 0,
    comments: Number(row.comments_count) || 0,
    ticketId: row.ticket_id ?? null,
    ticketStatus: row.ticket_status ?? null,
    ticketPriority: row.ticket_priority ?? null,
  };
}

export const RANGES = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: 'all', label: 'All time', days: null },
];

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

// Values written by the AI or older code can be any type; the UI only ever sees clean strings.
const str = (v, fallback = '') => {
  if (v == null) return fallback;
  if (typeof v === 'string') return v.trim() || fallback;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return fallback;
  }
};

function normUrgency(v) {
  const u = str(v).toLowerCase();
  if (u.startsWith('high') || u === 'urgent' || u === 'critical') return 'High';
  if (u.startsWith('low')) return 'Low';
  return 'Neutral';
}

function firstSentence(text) {
  const m = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  const s = (m ? m[0] : text).trim();
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

/** "+12", "−36", "0" with a true minus sign. */
export const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function parseLabels(v) {
  if (Array.isArray(v)) return v.map((l) => str(l)).filter(Boolean);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map((l) => str(l)).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Normalise a row from GET /all into what the UI uses. Never throws. */
export function normalizeFeedback(row) {
  const text = str(row.original_text ?? row.text);
  const title = str(row.title) || null;
  const reply = Boolean(title && title.startsWith('Re: '));
  const summary = str(row.summary);
  const ts = str(row.feedback_timestamp ?? row.created_at) || null;
  const rawScore = Math.round(Number(row.sentiment_score));
  const score = Number.isFinite(rawScore) && rawScore >= 1 ? Math.min(10, rawScore) : 5;
  return {
    id: str(row.id),
    timestamp: ts && Number.isFinite(new Date(ts).getTime()) ? ts : null,
    author: str(row.user_id) || null,
    source: str(row.source, 'Unknown'),
    product: str(row.product_category, 'Unknown'),
    userType: str(row.user_type, 'Unknown'),
    urgency: normUrgency(row.urgency_level),
    type: str(row.feedback_type, 'Other'),
    summary,
    action: str(row.recommended_action),
    status: str(row.feedback_status, 'Open'),
    text,
    score,
    sentiment: sentimentOf(score),
    title,
    // A Hacker News comment's title is its thread; what the person said is more useful.
    headline: (reply ? summary || firstSentence(text) : title || summary || firstSentence(text)) || 'Untitled feedback',
    thread: reply ? title.replace(/^Re: /, '') : null,
    url: str(row.source_url) || null,
    repo: str(row.repo) || null,
    labels: parseLabels(row.labels),
    upstreamState: str(row.source_state) || null,
    reactions: Number(row.reactions) || 0,
    comments: Number(row.comments_count) || 0,
    ticketId: row.ticket_id ?? null,
    ticketStatus: str(row.ticket_status) || null,
    ticketPriority: str(row.ticket_priority) || null,
    // Triage
    starred: Boolean(Number(row.starred)),
    reviewedAt: str(row.reviewed_at) || null,
    dismissedReason: str(row.dismissed_reason) || null,
    highlightTags: parseLabels(row.highlight_tags),
    respondedAt: str(row.responded_at) || null,
    subject: str(row.subject) || null,
    notesCount: Number(row.notes_count) || 0,
  };
}

/** Praise gets "save" actions; everything else gets "fix" actions. */
export const isPraise = (item) => item.sentiment === 'positive';

/** Still waiting for someone to look at it. */
export const inInbox = (item) => !item.reviewedAt && item.status === 'Open';

/** GitHub closed the issue, but it's still open on our side. */
export const closedUpstream = (item) => item.upstreamState === 'closed' && (item.status === 'Open' || item.status === 'Ticket Raised');

/** Resolved, has somewhere to reply, and nobody has told the author yet. */
export const needsReply = (item) => item.status === 'Resolved' && Boolean(item.url) && !item.respondedAt;

export const HIGHLIGHT_TAGS = ['Customer story', 'Launch quote', 'Team shout-out', 'Competitive win'];
export const DISMISS_REASONS = ['Duplicate', 'Not actionable', 'Off-topic', 'Spam', 'Other'];

export const STATUS_FILTERS = ['Open', 'Ticket Raised', 'Resolved', 'Closed on GitHub', 'Needs reply'];

export function matchesStatus(item, status) {
  if (!status) return true;
  if (status === 'Starred') return item.starred;
  if (status === 'Closed on GitHub') return closedUpstream(item);
  if (status === 'Needs reply') return needsReply(item);
  return item.status === status;
}

export const RANGES = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: 'all', label: 'All time', days: null },
];

// Same-origin by default (the Worker serves both the API and this app).
// In `npm run dev`, vite.config.js proxies API routes to `wrangler dev` on :8787.
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  feedback: () => request('/all'),
  tickets: () => request('/tickets'),
  syncStatus: () => request('/sync/status'),
  search: (q) => request(`/search?q=${encodeURIComponent(q)}&limit=25`),
  updateFeedback: (id, changes) => request(`/feedback/${id}`, { method: 'PATCH', body: changes }),
  bulkUpdate: (ids, changes) => request('/feedback/bulk', { method: 'POST', body: { ids, changes } }),
  notes: (id) => request(`/feedback/${id}/notes`),
  addNote: (id, body, author) => request(`/feedback/${id}/notes`, { method: 'POST', body: { body, author } }),
  deleteNote: (noteId) => request(`/notes/${noteId}`, { method: 'DELETE' }),
  createTicket: (ticket) => request('/tickets', { method: 'POST', body: ticket }),
  updateTicket: (id, changes) => request(`/tickets/${id}`, { method: 'PATCH', body: changes }),
  productSummaries: () => request('/products/summaries'),
  refreshProductSummaries: () => request('/products/summaries/refresh', { method: 'POST' }),
};

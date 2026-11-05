import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { PRIORITIES, priorityFromUrgency } from '../lib/format.js';
import { SourceTag } from './bits.jsx';

function defaultDescription(item) {
  const lines = [
    item.summary && `Summary: ${item.summary}`,
    item.action && `Suggested next step: ${item.action}`,
    `Source: ${item.source}${item.author ? ` (${item.author})` : ''}`,
    item.url && `Link: ${item.url}`,
    '',
    'Original feedback:',
    item.text.length > 1500 ? `${item.text.slice(0, 1500)}…` : item.text,
  ];
  return lines.filter((l) => l !== false && l != null).join('\n');
}

export default function TicketForm({ item, products, onCancel, onSubmit }) {
  const [form, setForm] = useState(() => ({
    title: item.headline.slice(0, 200),
    priority: priorityFromUrgency(item.urgency),
    team: item.product !== 'Unknown' ? item.product : '',
    assignee: '',
    description: defaultDescription(item),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const titleRef = useRef(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return setError('Give the ticket a title.');
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ feedback_id: item.id, ...form });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-layer">
      <div className="modal-scrim" onClick={onCancel} aria-hidden="true" />
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="ticket-heading" onSubmit={submit}>
        <header className="modal-head">
          <div>
            <h2 id="ticket-heading">Raise a ticket</h2>
            <p className="muted modal-from">
              From <SourceTag source={item.source} /> feedback about {item.product}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onCancel} aria-label="Cancel">
            <X size={18} />
          </button>
        </header>

        <div className="modal-body">
          <label className="field">
            <span>Title</span>
            <input ref={titleRef} value={form.title} onChange={set('title')} maxLength={200} required />
          </label>

          <fieldset className="field">
            <legend>Priority</legend>
            <div className="priority-picker">
              {PRIORITIES.map((p) => (
                <label key={p.key} className={`priority-option ${form.priority === p.key ? 'checked' : ''}`}>
                  <input type="radio" name="priority" value={p.key} checked={form.priority === p.key} onChange={set('priority')} />
                  <strong>{p.key}</strong>
                  <span>{p.hint}</span>
                </label>
              ))}
            </div>
            <p className="field-hint">Suggested from the feedback's urgency ({item.urgency}).</p>
          </fieldset>

          <div className="field-row">
            <label className="field">
              <span>Team</span>
              <input value={form.team} onChange={set('team')} list="team-options" placeholder="e.g. R2" maxLength={80} />
              <datalist id="team-options">
                {products.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>
                Assignee <span className="muted">(optional)</span>
              </span>
              <input value={form.assignee} onChange={set('assignee')} placeholder="Name or email" maxLength={120} />
            </label>
          </div>

          <label className="field">
            <span>Description</span>
            <textarea value={form.description} onChange={set('description')} rows={9} maxLength={5000} />
          </label>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="modal-foot">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create ticket'}
          </button>
        </footer>
      </form>
    </div>
  );
}

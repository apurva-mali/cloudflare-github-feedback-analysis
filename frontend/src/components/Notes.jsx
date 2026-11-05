import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { fullDate, timeAgo } from '../lib/format.js';

const NAME_KEY = 'cv-note-author';
function savedName() {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}

/** Internal notes on one feedback item. */
export default function Notes({ feedbackId, onCountChange, notify }) {
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [name, setName] = useState(savedName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .notes(feedbackId)
      .then((d) => live && setNotes(d.notes))
      .catch((e) => live && setError(e.status === 500 ? 'Notes need the latest database update (npm run db:migrate).' : e.message));
    return () => {
      live = false;
    };
  }, [feedbackId]);

  const add = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    try {
      try {
        localStorage.setItem(NAME_KEY, name.trim());
      } catch {
        /* storage unavailable */
      }
      const { note } = await api.addNote(feedbackId, text.trim(), name.trim() || null);
      const next = [...(notes || []), note];
      setNotes(next);
      onCountChange(next.length);
      setText('');
    } catch (err) {
      notify(`Couldn't save note: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    try {
      await api.deleteNote(id);
      const next = notes.filter((n) => n.id !== id);
      setNotes(next);
      onCountChange(next.length);
    } catch (err) {
      notify(`Couldn't delete note: ${err.message}`, 'error');
    }
  };

  return (
    <section className="notes" aria-labelledby={`notes-${feedbackId}`}>
      <h3 id={`notes-${feedbackId}`}>Team notes</h3>
      {error && <p className="muted small">{error}</p>}
      {notes?.length > 0 && (
        <ul className="note-list">
          {notes.map((n) => (
            <li key={n.id}>
              <div className="note-meta">
                <strong>{n.author || 'Someone'}</strong>
                <span className="muted" title={fullDate(n.created_at)}>
                  {timeAgo(n.created_at)}
                </span>
                <button type="button" className="icon-btn small" onClick={() => remove(n.id)} aria-label="Delete note">
                  <Trash2 size={14} />
                </button>
              </div>
              <p>{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      {!error && (
        <form className="note-form" onSubmit={add}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Add context for the team, e.g. who you asked or what you found" maxLength={4000} />
          <div className="note-form-row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={80} aria-label="Your name" />
            <button type="submit" className="btn" disabled={saving || !text.trim()}>
              Add note
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

import { useMemo, useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { EmptyState, SourceTag, TagChips } from './bits.jsx';
import { HighlightMenu } from './DetailPanel.jsx';
import { HIGHLIGHT_TAGS, plural } from '../lib/format.js';

function excerpt(text, max = 320) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max).replace(/\s\S*$/, '')}…` : t;
}

function quoteText(item) {
  const when = item.timestamp ? new Date(item.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  return `“${excerpt(item.text, 600)}”\n— ${item.author || 'A developer'} on ${item.source}${when ? `, ${when}` : ''}${item.url ? `\n${item.url}` : ''}`;
}

export default function HighlightsView({ items, unavailable, onUpdate, onOpen, notify }) {
  const [tag, setTag] = useState('');

  const saved = useMemo(() => items.filter((i) => i.highlightTags.length).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)), [items]);
  const counts = useMemo(() => {
    const c = {};
    for (const i of saved) for (const t of i.highlightTags) c[t] = (c[t] || 0) + 1;
    return c;
  }, [saved]);
  const tags = [...new Set([...HIGHLIGHT_TAGS, ...Object.keys(counts)])];
  const shown = tag ? saved.filter((i) => i.highlightTags.includes(tag)) : saved;
  const unsavedPraise = items.filter((i) => i.sentiment === 'positive' && !i.highlightTags.length).length;

  const copy = async (item) => {
    try {
      await navigator.clipboard.writeText(quoteText(item));
      notify('Quote copied with attribution and link');
    } catch {
      notify('Copy failed. Select the text and copy it instead.', 'error');
    }
  };

  if (unavailable) {
    return (
      <EmptyState title="Highlights need the latest database update">
        Run <code>npm run db:migrate</code> in the project folder, then deploy.
      </EmptyState>
    );
  }

  return (
    <div className="highlights-view">
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Highlight tag">
          <button type="button" aria-pressed={!tag} onClick={() => setTag('')}>
            All <span className="seg-count">{saved.length}</span>
          </button>
          {tags.map((t) => (
            <button key={t} type="button" aria-pressed={tag === t} onClick={() => setTag(t)}>
              {t} <span className="seg-count">{counts[t] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState title={saved.length ? 'Nothing saved with this tag' : 'No highlights yet'}>
          {saved.length
            ? 'Pick another tag above.'
            : `Open any positive feedback and choose Save to highlights. ${unsavedPraise ? `There ${unsavedPraise === 1 ? 'is' : 'are'} ${plural(unsavedPraise, 'positive item')} in this view to go through.` : ''}`}
        </EmptyState>
      ) : (
        <ul className="highlight-grid">
          {shown.map((item) => (
            <li key={item.id} className="highlight-card">
              <blockquote>
                <button type="button" className="quote-btn" onClick={() => onOpen(item.id)}>
                  “{excerpt(item.text)}”
                </button>
              </blockquote>
              <div className="hl-meta">
                <SourceTag source={item.source} />
                <span>{item.author || 'Unknown author'}</span>
                <span className="muted">{item.product}</span>
                <span className="muted">{new Date(item.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </div>
              <div className="hl-foot">
                <TagChips tags={item.highlightTags} />
                <div className="hl-actions">
                  <HighlightMenu item={item} onUpdate={onUpdate} label="Tags" />
                  <button type="button" className="btn ghost" onClick={() => copy(item)}>
                    <Copy size={15} aria-hidden="true" /> Copy quote
                  </button>
                  {item.url && (
                    <a className="icon-btn" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`Open on ${item.source}`} title={`Open on ${item.source}`}>
                      <ExternalLink size={16} />
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

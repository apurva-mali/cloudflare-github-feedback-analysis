import { useEffect, useRef, useState } from 'react';
import DetailPanel from './DetailPanel.jsx';
import { isPraise } from '../lib/format.js';

/**
 * Side drawer around DetailPanel, with keyboard triage:
 *   j / k  next / previous      r  mark reviewed (and move on)     s  star
 *   t  raise ticket             x  resolve                          d  dismiss…
 *   h  save to highlights…      o  open the original post           Esc  close
 */
export default function DetailDrawer({ item, nav, onClose, onUpdate, onRaiseTicket, ...panelProps }) {
  const ref = useRef(null);
  // Which action menu is open, tied to the item so it closes when moving on.
  const [menu, setMenu] = useState({ id: null, which: null });
  const menuState = (which) => [menu.id === item?.id && menu.which === which, (open) => setMenu({ id: item?.id, which: open ? which : null })];

  useEffect(() => {
    if (!item) return;
    // Focus the panel itself (not a button) so keyboard shortcuts work without a stray focus ring.
    ref.current?.focus();
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!item) return;
    const onKey = (e) => {
      if (e.key === 'Escape') return onClose();
      if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]')) return;
      const praise = isPraise(item);
      const open = !item.ticketId && item.status === 'Open';
      const act = {
        j: () => nav?.onNext(),
        ArrowDown: () => nav?.onNext(),
        k: () => nav?.onPrev(),
        ArrowUp: () => nav?.onPrev(),
        r: () => {
          onUpdate(item, { reviewed: true }, 'Marked as reviewed');
          nav?.onNext();
        },
        s: () => onUpdate(item, { starred: !item.starred }, item.starred ? 'Star removed' : 'Starred'),
        t: () => !praise && open && onRaiseTicket(item),
        x: () => !praise && open && onUpdate(item, { feedback_status: 'Resolved' }, 'Marked as resolved'),
        d: () => !praise && open && setMenu({ id: item.id, which: 'dismiss' }),
        h: () => praise && !item.ticketId && setMenu({ id: item.id, which: 'highlight' }),
        o: () => item.url && window.open(item.url, '_blank', 'noopener'),
      }[e.key];
      if (act) {
        e.preventDefault();
        act();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!item) return null;
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabIndex={-1}>
        <DetailPanel
          key={item.id}
          item={item}
          nav={nav}
          onClose={onClose}
          onUpdate={onUpdate}
          onRaiseTicket={onRaiseTicket}
          headingId="drawer-title"
          menus={{ highlight: menuState('highlight'), dismiss: menuState('dismiss') }}
          {...panelProps}
        />
        <p className="drawer-keys muted" aria-label="Keyboard shortcuts">
          <span><kbd>j</kbd> <kbd>k</kbd> next, previous</span>
          <span><kbd>r</kbd> reviewed</span>
          <span><kbd>s</kbd> star</span>
          <span><kbd>t</kbd> ticket</span>
          <span><kbd>x</kbd> resolve</span>
          <span><kbd>d</kbd> dismiss</span>
          <span><kbd>h</kbd> highlight</span>
        </p>
      </aside>
    </>
  );
}

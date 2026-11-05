import { useEffect, useRef } from 'react';
import DetailPanel from './DetailPanel.jsx';

/** Side drawer wrapper around DetailPanel. */
export default function DetailDrawer({ item, onClose, ...panelProps }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!item) return;
    ref.current?.querySelector('[data-autofocus]')?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null;
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <DetailPanel item={item} onClose={onClose} headingId="drawer-title" {...panelProps} />
      </aside>
    </>
  );
}

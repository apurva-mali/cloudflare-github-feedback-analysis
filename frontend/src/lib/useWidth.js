import { useLayoutEffect, useState } from 'react';

/** Width of a container, kept up to date with ResizeObserver. */
export function useWidth(ref, fallback = 640) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(1, Math.round(entry.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

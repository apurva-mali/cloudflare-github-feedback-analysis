import { useSyncExternalStore } from 'react';

const QUERIES = { sm: '(max-width: 760px)', md: '(max-width: 1100px)' };

function subscribe(cb) {
  const lists = Object.values(QUERIES).map((q) => window.matchMedia(q));
  lists.forEach((l) => l.addEventListener('change', cb));
  return () => lists.forEach((l) => l.removeEventListener('change', cb));
}

function snapshot() {
  if (window.matchMedia(QUERIES.sm).matches) return 'sm';
  if (window.matchMedia(QUERIES.md).matches) return 'md';
  return 'lg';
}

/** 'sm' (phone), 'md' (tablet / narrow laptop) or 'lg'. Tables use it to choose columns. */
export function useBreakpoint() {
  return useSyncExternalStore(subscribe, snapshot, () => 'lg');
}

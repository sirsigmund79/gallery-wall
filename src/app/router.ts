import { useSyncExternalStore } from 'react';

// Minimal hash router: three top-level tabs don't justify a routing library
// (see DECISIONS.md). Hash routing also works on any static host without
// rewrite rules.
export type Tab = 'walls' | 'art' | 'settings';
export const TABS: readonly Tab[] = ['walls', 'art', 'settings'];

function parse(): Tab {
  const t = location.hash.replace(/^#\/?/, '').split('/')[0];
  return (TABS as readonly string[]).includes(t ?? '') ? (t as Tab) : 'walls';
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useTab(): Tab {
  return useSyncExternalStore(subscribe, parse, () => 'walls');
}

import { useSyncExternalStore } from 'react';

// Minimal hash router (see DECISIONS.md). Routes:
//   #/walls            #/walls/new        #/walls/<id>
//   #/art              #/art/new          #/art/<id>
//   #/settings
export type Tab = 'walls' | 'art' | 'settings';
export const TABS: readonly Tab[] = ['walls', 'art', 'settings'];

export interface Route {
  tab: Tab;
  /** Path segments after the tab. */
  rest: string[];
}

const getHash = () => location.hash;

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const t = parts[0];
  if (t && (TABS as readonly string[]).includes(t)) return { tab: t as Tab, rest: parts.slice(1) };
  return { tab: 'walls', rest: [] };
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, () => '');
  return parseRoute(hash);
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  const hash = `#/${path.replace(/^\/+/, '')}`;
  if (opts.replace) location.replace(hash);
  else location.hash = hash;
}

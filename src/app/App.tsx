import { useEffect } from 'react';
import { ArtScreen } from '../features/art/ArtScreen.tsx';
import { SettingsScreen } from '../features/settings/SettingsScreen.tsx';
import { WallsScreen } from '../features/walls/WallsScreen.tsx';
import { useSettings } from '../state/settings.ts';
import { TABS, useTab, type Tab } from './router.ts';

const LABELS: Record<Tab, string> = { walls: 'Walls', art: 'Art', settings: 'Settings' };
const ICONS: Record<Tab, string> = {
  walls: 'M3 4h18v16H3z M7 8h4v5H7z M13 8h4v8h-4z',
  art: 'M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4',
  settings: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3',
};

export function App() {
  const tab = useTab();
  const load = useSettings((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="app">
      <main className="content">
        {tab === 'walls' && <WallsScreen />}
        {tab === 'art' && <ArtScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <a key={t} href={`#/${t}`} aria-current={tab === t ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={ICONS[t]} />
            </svg>
            <span>{LABELS[t]}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

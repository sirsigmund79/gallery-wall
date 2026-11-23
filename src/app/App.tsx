import { Suspense, lazy, useEffect } from 'react';
import { ArtScreen } from '../features/art/ArtScreen.tsx';
import { PieceEditor } from '../features/art/PieceEditor.tsx';
import { HangGuide } from '../features/export/HangGuide.tsx';
import { SettingsScreen } from '../features/settings/SettingsScreen.tsx';
import { WallWizard } from '../features/walls/WallWizard.tsx';
import { WallsScreen } from '../features/walls/WallsScreen.tsx';
import { useSettings } from '../state/settings.ts';
import { TABS, useRoute, type Route, type Tab } from './router.ts';

// The canvas editor pulls in Konva; load it only when a wall is opened.
const WallEditor = lazy(() => import('../features/editor/WallEditor.tsx').then((m) => ({ default: m.WallEditor })));

const LABELS: Record<Tab, string> = { walls: 'Walls', art: 'Art', settings: 'Settings' };
const ICONS: Record<Tab, string> = {
  walls: 'M3 4h18v16H3z M7 8h4v5H7z M13 8h4v8h-4z',
  art: 'M4 4h16v16H4z M4 16l5-5 4 4 3-3 4 4',
  settings: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3',
};

function Screen({ route }: { route: Route }) {
  const [a, b, c] = route.rest;
  if (route.tab === 'art') return a ? <PieceEditor key={a} id={a} /> : <ArtScreen />;
  if (route.tab === 'settings') return <SettingsScreen />;
  if (a === 'new') return <WallWizard key="new" />;
  if (a && b === 'calibrate') return <WallWizard key={`cal-${a}`} wallId={a} />;
  if (a && b === 'guide') return <HangGuide wallId={a} layoutId={c} />;
  if (a)
    return (
      <Suspense fallback={<p className="muted center">Loading editor…</p>}>
        <WallEditor key={a} wallId={a} layoutId={b === 'edit' ? c : undefined} />
      </Suspense>
    );
  return <WallsScreen />;
}

export function App() {
  const route = useRoute();
  const load = useSettings((s) => s.load);
  const loaded = useSettings((s) => s.loaded);
  useEffect(() => {
    void load();
  }, [load]);

  // The editor takes the full screen; everything else scrolls above the tab bar.
  const fullscreen = route.tab === 'walls' && !!route.rest[0] && route.rest[0] !== 'new' && !['calibrate', 'guide'].includes(route.rest[1] ?? '');

  return (
    <div className="app">
      <main className={fullscreen ? 'content full' : 'content'}>{loaded && <Screen route={route} />}</main>
      {!fullscreen && (
        <nav className="tabbar" aria-label="Main">
          {TABS.map((t) => (
            <a key={t} href={`#/${t}`} aria-current={route.tab === t ? 'page' : undefined}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={ICONS[t]} />
              </svg>
              <span>{LABELS[t]}</span>
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

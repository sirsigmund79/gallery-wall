import { useLiveQuery } from 'dexie-react-hooks';
import { deleteWall, listWalls } from '../../db/repo.ts';
import { accuracyPct, axisScales } from '../../geometry/calibration.ts';
import { formatLength } from '../../geometry/units.ts';
import { useSettings } from '../../state/settings.ts';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { QualityBadge } from '../../ui/QualityBadge.tsx';
import { Thumb } from '../../ui/Thumb.tsx';
import { TopBar } from '../../ui/TopBar.tsx';

export function WallsScreen() {
  const walls = useLiveQuery(listWalls);
  const units = useSettings((s) => s.units);
  const add = (
    <a className="button primary" href="#/walls/new">
      Add a wall
    </a>
  );
  if (walls === undefined) return null;
  return (
    <section>
      <TopBar title="Walls" actions={walls.length > 0 && add} />
      {walls.length === 0 ? (
        <EmptyState title="No walls yet" body="Photograph a wall, type one measurement, and plan your art on it at true scale." action={add} />
      ) : (
        <ul className="list">
          {walls.map((w) => {
            const b = w.bounds;
            const { sx, sy } = axisScales(w.calibration);
            const aspect = w.photo.widthPx / sx / (w.photo.heightPx / sy);
            const pieces = w.layouts.reduce((n, l) => Math.max(n, l.placements.length), 0);
            return (
              <li key={w.id} className="wall-row">
                <a href={`#/walls/${w.id}/edit`} className="wall-link">
                  <span className="wall-thumb">
                    <Thumb blob={w.thumb ?? w.photo.rectified} alt="" aspect={aspect} />
                  </span>
                  <span className="wall-text">
                    <strong>{w.name}</strong>
                    <span className="muted">
                      {formatLength(b.right - b.left, units)} × {formatLength(b.bottom - b.top, units)}
                    </span>
                    <span>
                      <QualityBadge quality={w.calibration.quality} pct={accuracyPct(w.calibration)} />{' '}
                      <span className="muted">
                        {w.layouts.length} layout{w.layouts.length === 1 ? '' : 's'} · {pieces} piece{pieces === 1 ? '' : 's'}
                      </span>
                    </span>
                  </span>
                </a>
                <details className="row-menu">
                  <summary aria-label={`More for ${w.name}`}>⋯</summary>
                  <div>
                    <a href={`#/walls/${w.id}/calibrate`}>Re-measure</a>
                    <a href={`#/walls/${w.id}/advanced`}>Edges & measurements</a>
                    <button
                      className="danger"
                      onClick={() => {
                        if (confirm(`Delete wall “${w.name}” and its layouts? Your art library is not affected.`)) void deleteWall(w.id);
                      }}
                    >
                      Delete wall
                    </button>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

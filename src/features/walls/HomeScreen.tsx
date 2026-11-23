// Home: your rooms, each a row of wall "photos" with the planned art drawn in.
// Swipe across a room's walls; tap one to step into it.
import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { stepInto } from '../../app/transition.ts';
import { DEFAULT_ROOM } from '../../db/schema.ts';
import { deleteWall, listPieces, listWalls, moveWallToRoom, renameRoom, renameWall, roomOrder } from '../../db/repo.ts';
import type { Wall } from '../../domain/types.ts';
import { accuracyPct } from '../../geometry/calibration.ts';
import { formatLength } from '../../geometry/units.ts';
import { useSettings } from '../../state/settings.ts';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { QualityBadge } from '../../ui/QualityBadge.tsx';
import { TopBar } from '../../ui/TopBar.tsx';
import { WallPreview } from '../../ui/WallPreview.tsx';

/** The layout to show on a card: the one edited most recently. */
const currentLayout = (w: Wall) => [...w.layouts].sort((a, b) => b.updatedAt - a.updatedAt)[0];

export function HomeScreen() {
  const walls = useLiveQuery(listWalls);
  const pieces = useLiveQuery(listPieces);
  const units = useSettings((s) => s.units);
  const byId = useMemo(() => new Map((pieces ?? []).map((p) => [p.id, p])), [pieces]);

  const rooms = useMemo(() => {
    const m = new Map<string, Wall[]>();
    // Rooms in order of most recent activity; walls in walk-around order.
    for (const w of walls ?? []) {
      const r = w.room ?? DEFAULT_ROOM;
      if (!m.has(r)) m.set(r, []);
      m.get(r)!.push(w);
    }
    return [...m].map(([room, ws]) => ({ room, walls: roomOrder(ws) }));
  }, [walls]);

  if (!walls || !pieces) return null;
  const add = (
    <a className="button primary" href="#/walls/new">
      Add a wall
    </a>
  );

  return (
    <section>
      <TopBar title="Home" actions={walls.length > 0 && add} />
      {walls.length === 0 ? (
        <EmptyState title="Add your first wall" body="Photograph a wall, tap something you know the size of, and plan your art on it at true scale." action={add} />
      ) : (
        rooms.map(({ room, walls: ws }) => (
          <div key={room} className="room">
            <div className="room-head">
              <h2>{room}</h2>
              <button
                className="link small"
                onClick={() => {
                  const to = prompt('Rename room', room)?.trim();
                  if (to && to !== room) void renameRoom(room, to);
                }}
              >
                Rename
              </button>
            </div>
            <ul className="room-walls" aria-label={`Walls in ${room}`}>
              {ws.map((w) => {
                const layout = currentLayout(w);
                const n = layout?.placements.length ?? 0;
                const b = w.bounds;
                return (
                  <li key={w.id} className="wall-card">
                    <a
                      href={`#/walls/${w.id}/edit`}
                      className="wall-card-link"
                      aria-label={`${w.name}, ${n} piece${n === 1 ? '' : 's'}`}
                      onClick={(e) => {
                        e.preventDefault();
                        stepInto(`walls/${w.id}/edit`, e.currentTarget.querySelector<HTMLElement>('.wall-card-img'));
                      }}
                    >
                      <WallPreview className="wall-card-img" wall={w} placements={layout?.placements ?? []} pieces={byId} label={`${w.name} with ${layout?.name ?? 'no layout'}`} />
                      <span className="wall-card-text">
                        <strong>{w.name}</strong>
                        <span className="muted">
                          {formatLength(b.right - b.left, units)} × {formatLength(b.bottom - b.top, units)} · {n} piece{n === 1 ? '' : 's'}
                        </span>
                      </span>
                    </a>
                    <div className="wall-card-foot">
                      <QualityBadge quality={w.calibration.quality} pct={accuracyPct(w.calibration)} />
                      <details className="row-menu">
                        <summary aria-label={`More for ${w.name}`}>⋯</summary>
                        <div>
                          <button
                            onClick={() => {
                              const to = prompt('Wall name', w.name)?.trim();
                              if (to) void renameWall(w.id, to);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => {
                              const to = prompt(`Move to which room?\nExisting: ${rooms.map((r) => r.room).join(', ')}`, room)?.trim();
                              if (to) void moveWallToRoom(w.id, to);
                            }}
                          >
                            Move to room…
                          </button>
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
                    </div>
                  </li>
                );
              })}
              <li className="wall-card add-card">
                <a href="#/walls/new" className="wall-card-add">
                  <span aria-hidden="true">+</span>
                  <span>Add a wall</span>
                </a>
              </li>
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

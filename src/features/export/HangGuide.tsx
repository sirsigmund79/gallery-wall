import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { navigate } from '../../app/router.ts';
import { getWall, listPieces, savePiece } from '../../db/repo.ts';
import type { Wall } from '../../domain/types.ts';
import { DATUM_LABEL, availableDatums, hookPositions, type VerticalDatum } from '../../geometry/layout/hang.ts';
import { formatLength } from '../../geometry/units.ts';
import { useSettings } from '../../state/settings.ts';
import { TopBar } from '../../ui/TopBar.tsx';

export function HangGuide({ wallId, layoutId }: { wallId: string; layoutId?: string }) {
  const units = useSettings((s) => s.units);
  const [wall, setWall] = useState<Wall | null>(null);
  const pieces = useLiveQuery(listPieces);
  const [datum, setDatum] = useState<VerticalDatum | null>(null);

  useEffect(() => {
    void getWall(wallId).then((w) => (w ? setWall(w) : navigate('walls', { replace: true })));
  }, [wallId]);

  if (!wall || !pieces) return null;
  const layout = wall.layouts.find((l) => l.id === layoutId) ?? wall.layouts[0]!;
  const datums = availableDatums(wall);
  const d = datum ?? datums[0]!;
  const byId = new Map(pieces.map((p) => [p.id, p]));
  // Order left to right, then top to bottom: the order you'd hang them in.
  const rows = layout.placements
    .flatMap((pl) => {
      const p = byId.get(pl.pieceId);
      return p ? [{ pl, p, hooks: hookPositions(pl, p.hang, wall, d) }] : [];
    })
    .sort((a, b) => a.hooks[0]!.fromLeft - b.hooks[0]!.fromLeft || a.pl.y - b.pl.y);

  async function markHung() {
    for (const { p } of rows) if (p.status !== 'hung') await savePiece({ ...p, status: 'hung' });
  }

  return (
    <section className="guide">
      <TopBar title="Hang guide" backHref={`#/walls/${wall.id}/edit/${layout.id}`} />
      <p className="muted">
        {wall.name} · {layout.name}
      </p>
      {d === 'top' && (
        <p className="hint no-print">
          Tip: mark the floor line when calibrating the wall, so nail heights can be measured up from the floor with a tape.
        </p>
      )}
      <div className="field no-print">
        <label htmlFor="datum">Measure heights</label>
        <select id="datum" value={d} onChange={(e) => setDatum(e.target.value as VerticalDatum)}>
          {datums.map((x) => (
            <option key={x} value={x}>
              {DATUM_LABEL[x]}
            </option>
          ))}
        </select>
      </div>
      <p>
        Horizontal distances are from the <strong>left edge of the wall</strong>; heights are <strong>{DATUM_LABEL[d]}</strong>. Each nail position is
        where the hanger rests (top of the taut wire, the D-ring, or the sawtooth notch).
      </p>
      {rows.length === 0 ? (
        <p className="muted">This layout has no pieces yet.</p>
      ) : (
        <table className="guide-table">
          <thead>
            <tr>
              <th>Piece</th>
              <th>Nail</th>
              <th>From left</th>
              <th>Height</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, hooks }) =>
              hooks.map((h, i) => (
                <tr key={`${p.id}-${i}`} className={i === 0 ? 'first' : ''}>
                  {i === 0 && (
                    <td rowSpan={hooks.length}>
                      <strong>{p.name}</strong>
                      <br />
                      <span className="muted">
                        {formatLength(p.widthMm, units)} × {formatLength(p.heightMm, units)}
                      </span>
                      {hooks.length > 1 && (
                        <>
                          <br />
                          <span className="muted">Level between nails, {formatLength(hooks[1]!.fromLeft - hooks[0]!.fromLeft, units)} apart</span>
                        </>
                      )}
                    </td>
                  )}
                  <td>{hooks.length > 1 ? i + 1 : '•'}</td>
                  <td>{formatLength(h.fromLeft, units)}</td>
                  <td>{formatLength(h.vertical, units)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
      <p className="hint">Calibration: {wall.calibration.quality}. Check the first nail against the plan before putting in the rest.</p>
      <div className="actions no-print">
        <button className="primary" onClick={() => window.print()}>
          Print
        </button>
        {rows.length > 0 && <button onClick={() => void markHung()}>Mark these as hung</button>}
      </div>
    </section>
  );
}

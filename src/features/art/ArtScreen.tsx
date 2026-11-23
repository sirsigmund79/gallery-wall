import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { listPieces } from '../../db/repo.ts';
import type { PieceStatus } from '../../domain/types.ts';
import { formatLength } from '../../geometry/units.ts';
import { useSettings } from '../../state/settings.ts';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { Thumb } from '../../ui/Thumb.tsx';
import { TopBar } from '../../ui/TopBar.tsx';
import { STATUSES, STATUS_LABEL } from './constants.ts';

export function ArtScreen() {
  const pieces = useLiveQuery(listPieces);
  const units = useSettings((s) => s.units);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<PieceStatus | ''>('');

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (pieces ?? []).filter(
      (p) =>
        (!status || p.status === status) &&
        (!needle || p.name.toLowerCase().includes(needle) || p.tags.some((t) => t.toLowerCase().includes(needle))),
    );
  }, [pieces, q, status]);

  const add = (
    <a className="button primary" href="#/art/new">
      Add art
    </a>
  );

  if (pieces === undefined) return null;
  return (
    <section>
      <TopBar title="Art" actions={pieces.length > 0 && add} />
      {pieces.length === 0 ? (
        <EmptyState
          title="Your art library is empty"
          body="Add each piece with its real outer size (including the frame). A photo is optional."
          action={add}
        />
      ) : (
        <>
          <div className="filters">
            <input type="search" placeholder="Search name or tag" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            <select value={status} onChange={(e) => setStatus(e.target.value as PieceStatus | '')} aria-label="Filter by status">
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <ul className="grid">
            {shown.map((p) => (
              <li key={p.id}>
                <a className="tile" href={`#/art/${p.id}`}>
                  <Thumb blob={p.thumb} alt={p.name} aspect={p.widthMm / p.heightMm} label={p.name} />
                  <strong>{p.name}</strong>
                  <span className="muted">
                    {formatLength(p.widthMm, units)} × {formatLength(p.heightMm, units)}
                  </span>
                  <span className={`chip status-${p.status}`}>{STATUS_LABEL[p.status]}</span>
                </a>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="muted center">No pieces match.</p>}
        </>
      )}
    </section>
  );
}

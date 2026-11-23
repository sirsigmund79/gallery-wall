import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getWall, listPieces, listWalls, newLayout, roomOrder } from '../../db/repo.ts';
import { DEFAULT_ROOM } from '../../db/schema.ts';
import { navigate } from '../../app/router.ts';
import { newId } from '../../db/ids.ts';
import type { ArtPiece, LengthUnit, Mm, Placement, Wall } from '../../domain/types.ts';
import { accuracyPct } from '../../geometry/calibration.ts';
import { DATUM_LABEL, availableDatums, hookPositions } from '../../geometry/layout/hang.ts';
import { formatLength, inToMm } from '../../geometry/units.ts';
import { useSettings } from '../../state/settings.ts';
import { LengthInput } from '../../ui/LengthInput.tsx';
import { QualityBadge } from '../../ui/QualityBadge.tsx';
import { Thumb } from '../../ui/Thumb.tsx';
import { fitsWall, freeSpot } from './placement.ts';
import { useEditor } from './store.ts';
import { WallCanvas } from './WallCanvas.tsx';
import { SuggestSheet } from './SuggestSheet.tsx';

const nudgeStep = (u: LengthUnit): Mm => (u === 'in' ? inToMm(1 / 8) : 1);

export function WallEditor({ wallId, layoutId }: { wallId: string; layoutId?: string }) {
  const units = useSettings((s) => s.units);
  const ed = useEditor();
  const allPieces = useLiveQuery(listPieces);
  const allWalls = useLiveQuery(listWalls);
  const swipe = useRef<number | null>(null);
  const [sheet, setSheet] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const fitRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let alive = true;
    void getWall(wallId).then((w) => {
      if (!alive) return;
      if (!w) return navigate('walls', { replace: true });
      useEditor.getState().open(w, layoutId);
    });
    return () => {
      alive = false;
      void useEditor.getState().close();
    };
  }, [wallId, layoutId]);

  const pieces = useMemo(() => new Map((allPieces ?? []).map((p) => [p.id, p])), [allPieces]);
  const wall = ed.wall;
  const placements = ed.history.present;
  const sel = placements.find((p) => p.pieceId === ed.selectedId);
  const selPiece = sel ? pieces.get(sel.pieceId) : undefined;

  // Desktop keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useEditor.getState().redo();
        else useEditor.getState().undo();
        return;
      }
      const id = useEditor.getState().selectedId;
      if (!id) return;
      const step = nudgeStep(units) * (e.shiftKey ? 8 : 1);
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const mv = d[e.key];
      if (mv) {
        e.preventDefault();
        move(id, mv[0], mv[1]);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove(id);
      } else if (e.key === 'Escape') ed.select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!wall || !allPieces) return <p className="muted center">Loading…</p>;
  const layout = wall.layouts.find((l) => l.id === ed.layoutId)!;
  // Neighbouring walls in the same room ("walk around the room").
  const inRoom = roomOrder((allWalls ?? []).filter((w) => (w.room ?? DEFAULT_ROOM) === (wall.room ?? DEFAULT_ROOM)));
  const at = inRoom.findIndex((w) => w.id === wall.id);
  const prev = at > 0 ? inRoom[at - 1] : undefined;
  const next = at >= 0 && at < inRoom.length - 1 ? inRoom[at + 1] : undefined;
  const goWall = (w?: Wall) => w && navigate(`walls/${w.id}/edit`);
  const datum = availableDatums(wall)[0]!;
  const b = wall.bounds;

  const update = (id: string, patch: Partial<Placement>) =>
    ed.apply((ps) => ps.map((p) => (p.pieceId === id ? { ...p, ...patch } : p)));
  function move(id: string, dx: Mm, dy: Mm) {
    ed.apply((ps) => ps.map((p) => (p.pieceId === id && !p.locked ? { ...p, x: p.x + dx, y: p.y + dy } : p)));
  }
  function remove(id: string) {
    ed.apply((ps) => ps.filter((p) => p.pieceId !== id));
    ed.select(null);
  }
  function add(piece: ArtPiece) {
    const placed = placements.flatMap((p) => {
      const pc = pieces.get(p.pieceId);
      return pc ? [{ x: p.x, y: p.y, w: pc.widthMm, h: pc.heightMm }] : [];
    });
    const pos = freeSpot(wall!, piece, placed);
    ed.apply((ps) => [...ps, { pieceId: piece.id, ...pos }]);
    ed.select(piece.id);
    setSheet(false);
  }

  // ── Layout management ──
  function layoutAction(action: string) {
    if (!wall) return;
    const now = Date.now();
    if (action === 'new') {
      const l = newLayout(`Layout ${wall.layouts.length + 1}`);
      ed.setLayouts([...wall.layouts, l], l.id);
    } else if (action === 'duplicate') {
      const l = { ...layout, id: newId(), name: `${layout.name} copy`, placements: placements.map((p) => ({ ...p })), createdAt: now, updatedAt: now };
      ed.setLayouts([...wall.layouts, l], l.id);
    } else if (action === 'rename') {
      const name = prompt('Layout name', layout.name)?.trim();
      if (name) ed.setLayouts(wall.layouts.map((l) => (l.id === layout.id ? { ...l, name } : l)), layout.id);
    } else if (action === 'delete') {
      if (wall.layouts.length < 2) return alert('A wall needs at least one layout.');
      if (!confirm(`Delete “${layout.name}”?`)) return;
      const rest = wall.layouts.filter((l) => l.id !== layout.id);
      ed.setLayouts(rest, rest[0]!.id);
    }
  }

  const onWall = new Set(placements.map((p) => p.pieceId));
  const verticalOf = (y: Mm) => (datum === 'floor' ? wall.datums.floorY! - y : datum === 'ceiling' ? y - wall.datums.ceilingY! : y - b.top);
  const fromVertical = (v: Mm) => (datum === 'floor' ? wall.datums.floorY! - v : datum === 'ceiling' ? wall.datums.ceilingY! + v : b.top + v);

  return (
    <div className="editor">
      <header
        className="editor-bar"
        onTouchStart={(e) => (swipe.current = e.touches[0]!.clientX)}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0]!.clientX - (swipe.current ?? e.changedTouches[0]!.clientX);
          swipe.current = null;
          if (Math.abs(dx) > 60) goWall(dx < 0 ? next : prev);
        }}
      >
        <div className="editor-row">
          <a className="icon-btn" href="#/walls" aria-label="Back to Home">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </a>
          <button className="icon-btn" aria-label={prev ? `Previous wall: ${prev.name}` : 'No previous wall'} disabled={!prev} onClick={() => goWall(prev)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 7l-5 5 5 5" /></svg>
          </button>
          <div className="editor-title">
            <span className="muted">{wall.room ?? DEFAULT_ROOM}</span>
            <strong>{wall.name}</strong>
          </div>
          <button className="icon-btn" aria-label={next ? `Next wall: ${next.name}` : 'No next wall'} disabled={!next} onClick={() => goWall(next)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" /></svg>
          </button>
          <button className="icon-btn" onClick={ed.undo} disabled={!ed.history.past.length} aria-label="Undo">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3" /></svg>
          </button>
          <button className="icon-btn" onClick={ed.redo} disabled={!ed.history.future.length} aria-label="Redo">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h3" /></svg>
          </button>
        </div>
        <div className="layout-chips" role="tablist" aria-label="Layouts">
          {wall.layouts.map((l) => (
            <button key={l.id} role="tab" aria-selected={l.id === layout.id} className={`chip-btn${l.id === layout.id ? ' on' : ''}`} onClick={() => ed.switchLayout(l.id)}>
              {l.name}
            </button>
          ))}
          <button className="chip-btn" onClick={() => layoutAction('new')} aria-label="New layout">
            + New
          </button>
          <details className="row-menu layout-menu">
            <summary aria-label="Layout options">⋯</summary>
            <div>
              <button onClick={() => layoutAction('duplicate')}>Duplicate “{layout.name}”</button>
              <button onClick={() => layoutAction('rename')}>Rename…</button>
              <button className="danger" onClick={() => layoutAction('delete')}>
                Delete…
              </button>
            </div>
          </details>
        </div>
      </header>

      <WallCanvas
        wall={wall}
        placements={placements}
        pieces={pieces}
        selectedId={ed.selectedId}
        snapping={ed.snapping}
        units={units}
        onSelect={ed.select}
        onMove={(id, x, y) => update(id, { x, y })}
        fitRef={fitRef}
      />

      <div className="editor-panel">
        {sel && selPiece ? (
          <div className="sel">
            <div className="sel-head">
              <strong>{selPiece.name}</strong>
              <span className="muted">
                {formatLength(selPiece.widthMm, units)} × {formatLength(selPiece.heightMm, units)}
              </span>
              <button className="link" onClick={() => ed.select(null)}>
                Done
              </button>
            </div>
            <div className="row2">
              <LengthInput
                key={`x-${sel.pieceId}-${sel.x}`}
                label="Left edge, from wall’s left"
                unit={units}
                valueMm={sel.x - b.left}
                allowNegative
                commitOnBlur
                onChange={(v) => v !== null && update(sel.pieceId, { x: b.left + v })}
              />
              <LengthInput
                key={`y-${sel.pieceId}-${sel.y}`}
                label={`Top edge, ${DATUM_LABEL[datum]}`}
                unit={units}
                valueMm={verticalOf(sel.y)}
                allowNegative
                commitOnBlur
                onChange={(v) => v !== null && update(sel.pieceId, { y: fromVertical(v) })}
              />
            </div>
            <div className="sel-tools">
              <Nudge onMove={(dx, dy) => move(sel.pieceId, dx * nudgeStep(units), dy * nudgeStep(units))} disabled={!!sel.locked} />
              <div className="sel-buttons">
                <button disabled={sel.locked} onClick={() => update(sel.pieceId, { x: (b.left + b.right) / 2 - selPiece.widthMm / 2 })}>
                  Centre on wall
                </button>
                <button onClick={() => update(sel.pieceId, { locked: !sel.locked })}>{sel.locked ? 'Unlock' : 'Lock'}</button>
                <button className="danger" onClick={() => remove(sel.pieceId)}>
                  Remove
                </button>
              </div>
            </div>
            <ul className="nails">
              {hookPositions(sel, selPiece.hang, wall, datum).map((h) => (
                <li key={h.index}>
                  <span aria-hidden="true">✚</span> Nail{selPiece.hang.hooks.length > 1 ? ` ${h.index + 1}` : ''}: {formatLength(h.fromLeft, units)} from left,{' '}
                  {formatLength(h.vertical, units)} {DATUM_LABEL[datum]}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="idle">
            <div className="actions">
              <button className="primary" onClick={() => setSheet(true)}>
                Add art
              </button>
              <button onClick={() => setSuggest(true)}>Suggest</button>
              <a className="button" href={`#/walls/${wall.id}/guide/${layout.id}`}>
                Hang guide
              </a>
              <button onClick={() => fitRef.current?.()}>Fit</button>
            </div>
            <div className="idle-meta">
              <label className="check-row">
                <input type="checkbox" checked={ed.snapping} onChange={(e) => ed.setSnapping(e.target.checked)} />
                Snap to edges and equal gaps
              </label>
              <span className="muted">
                <QualityBadge quality={wall.calibration.quality} pct={accuracyPct(wall.calibration)} />{' '}
                <a href={`#/walls/${wall.id}/calibrate`}>Calibration</a>
              </span>
            </div>
            {!placements.length && <p className="hint">Tap “Add art” to place pieces yourself, or “Suggest” for ideas that fit this wall.</p>}
          </div>
        )}
      </div>

      {suggest && (
        <SuggestSheet
          wall={wall}
          placements={placements}
          pieces={allPieces}
          onApply={(ps) => {
            ed.apply(() => ps);
            ed.select(null);
            setSuggest(false);
          }}
          onSaveAsNew={(ps, name) => {
            const now = Date.now();
            const l = { id: newId(), name, placements: ps, createdAt: now, updatedAt: now };
            ed.setLayouts([...wall.layouts, l], l.id);
            setSuggest(false);
          }}
          onClose={() => setSuggest(false)}
        />
      )}
      {sheet && <AddSheet wall={wall} pieces={allPieces} onWall={onWall} units={units} onAdd={add} onClose={() => setSheet(false)} />}
    </div>
  );
}

function Nudge({ onMove, disabled }: { onMove: (dx: number, dy: number) => void; disabled?: boolean }) {
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const stop = () => {
    clearInterval(timer.current);
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => stop, []);
  const btn = (label: string, dx: number, dy: number, path: string) => (
    <button
      className="icon-btn"
      aria-label={label}
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        onMove(dx, dy);
        // Hold to repeat.
        timer.current = setTimeout(() => {
          timer.current = setInterval(() => onMove(dx, dy), 60);
        }, 350);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onMove(dx, dy)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg>
    </button>
  );
  return (
    <div className="nudge" role="group" aria-label="Nudge">
      <span />
      {btn('Nudge up', 0, -1, 'M6 15l6-6 6 6')}
      <span />
      {btn('Nudge left', -1, 0, 'M15 6l-6 6 6 6')}
      <span className="nudge-mid" />
      {btn('Nudge right', 1, 0, 'M9 6l6 6-6 6')}
      <span />
      {btn('Nudge down', 0, 1, 'M6 9l6 6 6-6')}
      <span />
    </div>
  );
}

interface AddSheetProps {
  wall: Wall;
  pieces: ArtPiece[];
  onWall: Set<string>;
  units: LengthUnit;
  onAdd: (p: ArtPiece) => void;
  onClose: () => void;
}

function AddSheet({ wall, pieces, onWall, units, onAdd, onClose }: AddSheetProps) {
  const [onlyFits, setOnlyFits] = useState(false);
  const shown = pieces.filter((p) => !onlyFits || fitsWall(wall, p));
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Add art" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Add art</h2>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
        {pieces.length === 0 ? (
          <p>
            Your library is empty. <a href="#/art/new">Add a piece</a> first.
          </p>
        ) : (
          <>
            <label className="check-row">
              <input type="checkbox" checked={onlyFits} onChange={(e) => setOnlyFits(e.target.checked)} />
              Only pieces that fit this wall
            </label>
            <ul className="sheet-list">
              {shown.map((p) => {
                const placed = onWall.has(p.id);
                return (
                  <li key={p.id}>
                    <button disabled={placed} onClick={() => onAdd(p)}>
                      <span className="sheet-thumb">
                        <Thumb blob={p.thumb} alt="" aspect={p.widthMm / p.heightMm} />
                      </span>
                      <span className="sheet-text">
                        <strong>{p.name}</strong>
                        <span className="muted">
                          {formatLength(p.widthMm, units)} × {formatLength(p.heightMm, units)}
                          {placed ? ' · on this wall' : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <a href="#/art/new">+ New piece</a>
          </>
        )}
      </div>
    </div>
  );
}

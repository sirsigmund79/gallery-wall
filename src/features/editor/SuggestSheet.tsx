// Mix-and-match suggestions (spec §6.6): a few good-looking layouts that fit
// this wall, from the whole library or just what's on the wall. Shuffle for more.
import { useEffect, useMemo, useState } from 'react';
import type { ArtPiece, Placement, Wall } from '../../domain/types.ts';
import type { ArrangePiece, StyleChoice, Variant } from '../../geometry/layout/arrange/index.ts';
import { inToMm } from '../../geometry/units.ts';
import { ErrorDetails } from '../../ui/ErrorDetails.tsx';
import { WallPreview } from '../../ui/WallPreview.tsx';
import { suggestInWorker } from '../../workers/arrangeClient.ts';
import { artZone } from '../../geometry/layout/arrange/index.ts';
import { axisScales } from '../../geometry/calibration.ts';
import { kindOf } from '../walls/tags.ts';

/** Space between pieces in suggestions (~2 in). */
export const SUGGEST_GAP_MM = inToMm(2);

const STYLE_LABEL: Record<StyleChoice, string> = { any: 'Any', row: 'Row', grid: 'Grid', salon: 'Salon', symmetric: 'Symmetric' };

interface Props {
  wall: Wall;
  placements: Placement[];
  pieces: ArtPiece[];
  onApply: (placements: Placement[]) => void;
  onSaveAsNew: (placements: Placement[], name: string) => void;
  onClose: () => void;
}

export function SuggestSheet({ wall, placements, pieces, onApply, onSaveAsNew, onClose }: Props) {
  const [mode, setMode] = useState<'mix' | 'rearrange'>(placements.length >= 2 ? 'rearrange' : 'mix');
  const [style, setStyle] = useState<StyleChoice>('any');
  const [seed, setSeed] = useState(() => (Math.random() * 2 ** 31) | 0);
  const [result, setResult] = useState<{ key: string; variants: Variant[] } | null>(null);
  const [error, setError] = useState<string>();
  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);
  const onWall = useMemo(() => new Map(placements.map((p) => [p.pieceId, p])), [placements]);

  const pool: ArrangePiece[] = useMemo(() => {
    const toArr = (p: ArtPiece): ArrangePiece => {
      const pl = onWall.get(p.id);
      return { id: p.id, w: p.widthMm, h: p.heightMm, locked: pl?.locked ? { x: pl.x, y: pl.y } : undefined };
    };
    if (mode === 'rearrange') return placements.flatMap((pl) => (byId.has(pl.pieceId) ? [toArr(byId.get(pl.pieceId)!)] : []));
    // Library: everything except pieces already hanging somewhere else.
    return pieces.filter((p) => onWall.has(p.id) || p.status !== 'hung').map(toArr);
  }, [mode, placements, pieces, byId, onWall]);

  const spec = useMemo(
    () => ({
      bounds: wall.bounds,
      floorY: wall.datums.floorY,
      ceilingY: wall.datums.ceilingY,
      keepOut: (wall.keepOut ?? []).map((k) => ({ x: k.x, y: k.y, w: k.w, h: k.h, kind: kindOf(k) })),
      hangArea: wall.hangArea,
    }),
    [wall],
  );
  // Previews zoom to where art can go (plus what it sits above), so the art is big enough to judge.
  const previewArea = useMemo(() => {
    const z = artZone(spec);
    const { sx, sy } = axisScales(wall.calibration);
    const W = wall.photo.widthPx / sx, H = wall.photo.heightPx / sy;
    // The target group box, generously padded.
    const gw = z.targetWidth * 1.7, gh = Math.max(z.targetHeight * 1.7, gw * 0.5);
    const gcy = z.align === 'bottom' ? z.target.y - z.targetHeight / 2 : z.target.y;
    let x0 = Math.max(z.usable.x - 100, z.target.x - gw / 2), x1 = Math.min(z.usable.x + z.usable.w + 100, z.target.x + gw / 2);
    let y0 = Math.max(z.usable.y - 100, gcy - gh / 2), y1 = Math.min(z.usable.y + z.usable.h + 100, gcy + gh / 2);
    for (const k of spec.keepOut)
      if ((k.kind === 'tv' || k.kind === 'furniture') && k.x < x1 && k.x + k.w > x0) {
        // Include the TV/sofa the art sits above, for context.
        if (Math.abs(k.x + k.w / 2 - z.target.x) < k.w) {
          x0 = Math.min(x0, k.x);
          x1 = Math.max(x1, k.x + k.w);
          y1 = Math.max(y1, k.y + k.h);
        }
      }
    const pad = Math.max(x1 - x0, y1 - y0) * 0.08;
    x0 = Math.max(0, x0 - pad);
    y0 = Math.max(0, y0 - pad);
    x1 = Math.min(W, x1 + pad);
    y1 = Math.min(H, y1 + pad);
    // Match the card's 4:3 shape around the centre.
    let w = x1 - x0, h = y1 - y0;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (w / h > 4 / 3) h = (w * 3) / 4;
    else w = (h * 4) / 3;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }, [spec, wall]);
  // A door used as the size reference is added automatically; it doesn't count as "told us".
  const untagged = !wall.hangArea && !(wall.keepOut ?? []).some((k) => kindOf(k) !== 'door');

  const key = `${mode}|${style}|${seed}|${pool.map((p) => p.id).join(',')}`;
  useEffect(() => {
    if (!pool.length) return;
    let alive = true;
    suggestInWorker({
      wall: spec,
      pool,
      mode,
      style,
      gap: SUGGEST_GAP_MM,
      seed,
    })
      .then((variants) => alive && setResult({ key, variants }))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [key, pool, mode, style, seed, spec]);

  const variants = result?.key === key ? result.variants : null;
  const toPlacements = (v: Variant): Placement[] => v.placements.map((q) => ({ pieceId: q.id, x: q.x, y: q.y, locked: onWall.get(q.id)?.locked }));

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet sheet-tall" role="dialog" aria-label="Suggestions" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Suggestions</h2>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
        {untagged && (
          <a className="banner" href={`#/walls/${wall.id}/objects`}>
            <strong>Tell us what’s on this wall</strong>
            <span>Mark a TV, windows or furniture (art stays clear) or a panel (art goes inside) for better ideas.</span>
          </a>
        )}
        <div className="seg seg-wide" role="tablist" aria-label="Which art">
          <button role="tab" aria-selected={mode === 'mix'} onClick={() => setMode('mix')}>
            Mix from my art
          </button>
          <button role="tab" aria-selected={mode === 'rearrange'} onClick={() => setMode('rearrange')} disabled={!placements.length}>
            Rearrange these
          </button>
        </div>
        <div className="chips" aria-label="Style">
          {(Object.keys(STYLE_LABEL) as StyleChoice[]).map((s) => (
            <button key={s} className={`chip-btn${style === s ? ' on' : ''}`} aria-pressed={style === s} onClick={() => setStyle(s)}>
              {STYLE_LABEL[s]}
            </button>
          ))}
        </div>
        {!pool.length ? (
          <p className="hint">{mode === 'mix' ? 'Add some art to your library first.' : 'Place some art on this wall first, or mix from your library.'}</p>
        ) : error ? (
          <ErrorDetails message={error} />
        ) : !variants ? (
          <div className="center">
            <div className="spinner" aria-hidden="true" />
          </div>
        ) : !variants.length ? (
          <p className="hint">
            Nothing fits nicely in this style. Try another style{mode === 'rearrange' ? ', or mix from your library' : ''}, or check the wall’s size.
          </p>
        ) : (
          <ul className="suggestions">
            {variants.map((v, i) => (
              <li key={i}>
                <button className="suggestion" onClick={() => onApply(toPlacements(v))} aria-label={`Use suggestion ${i + 1}: ${STYLE_LABEL[v.style]}, ${v.placements.length} pieces`}>
                  <WallPreview wall={wall} placements={toPlacements(v)} pieces={byId} className="suggestion-img" crop={previewArea} />
                  <span className="suggestion-meta">
                    {STYLE_LABEL[v.style]} · {v.placements.length} piece{v.placements.length === 1 ? '' : 's'}
                  </span>
                </button>
                <button className="link small" onClick={() => onSaveAsNew(toPlacements(v), `${STYLE_LABEL[v.style]} idea`)}>
                  Save as new layout
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button className="primary" onClick={() => setSeed((s) => (s * 1103515245 + 12345) & 0x7fffffff)}>
            Shuffle
          </button>
        </div>
      </div>
    </div>
  );
}

// Tap anything outlined on a wall photo and say what it is: the size
// reference, the area art hangs in, something art must stay off (TV,
// window…), or not important. Small things sit on top of big ones, and tiny
// rectangles get grips that don't overlap.
import type { ReactNode } from 'react';
import type { KeepOutKind } from '../domain/types.ts';
import type { Quad } from '../geometry/quad.ts';
import type { Pt } from '../geometry/vec.ts';
import { KIND_LABEL, KINDS, drawOrder, setTag, type Tag, type TagItem } from '../features/walls/tags.ts';
import { PhotoMarkup, type Handle } from './PhotoMarkup.tsx';

/** Below this on-screen size, corner grips move outside the corners. */
const SMALL_SIDE_PX = 70;
const GRIP_PX = 26;

interface Props {
  image: HTMLImageElement;
  items: TagItem[];
  onItems: (items: TagItem[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Offer "I know its size" (adding a wall). */
  allowRef: boolean;
  /** Reference editor for the item tagged as the reference. */
  refPanel?: (item: TagItem) => ReactNode;
  /** Extra handles/overlay (floor line, measuring line). */
  extraHandles?: Handle[];
  onExtraMove?: (id: string, at: Pt) => void;
  overlay?: (unit: number) => ReactNode;
}

const STYLE = {
  ref: { stroke: '#ff9f0a', fill: '#ff9f0a22', dash: false },
  hang: { stroke: '#0a84ff', fill: '#0a84ff14', dash: false },
  keep: { stroke: '#ff453a', fill: '#ff453a1c', dash: true },
  none: { stroke: '#ffffff', fill: 'transparent', dash: true },
} as const;

function label(it: TagItem): string | null {
  const t = it.tag;
  if (t?.as === 'ref') return '★ Size';
  if (t?.as === 'hang') return 'Hang art here';
  if (t?.as === 'keep') return `${KIND_LABEL[t.kind]} · no art`;
  if (it.guess) return `${KIND_LABEL[it.guess]}?`;
  return null;
}

const minSide = (q: Quad) => Math.min(...q.map((p, i) => Math.hypot(q[(i + 1) % 4]![0] - p[0], q[(i + 1) % 4]![1] - p[1])));
const OUT: Pt[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => [x! * Math.SQRT1_2, y! * Math.SQRT1_2]);

export function WallTagger({ image, items, onItems, selectedId, onSelect, allowRef, refPanel, extraHandles = [], onExtraMove, overlay }: Props) {
  const visible = items.filter((it) => it.tag?.as !== 'ignore' || it.id === selectedId);
  const sel = items.find((it) => it.id === selectedId);

  const handles = (unit: number): Handle[] => {
    const hs: Handle[] = [...extraHandles];
    if (sel) {
      const small = minSide(sel.quad) / unit < SMALL_SIDE_PX;
      sel.quad.forEach((p, i) =>
        hs.push({ id: `${sel.id}:${i}`, at: p, color: '#0a84ff', label: `Corner ${i + 1}`, grip: small ? [OUT[i]![0] * GRIP_PX, OUT[i]![1] * GRIP_PX] : undefined }),
      );
    }
    return hs;
  };

  const tag = (t: Tag | undefined) => sel && onItems(setTag(items, sel.id, t));

  return (
    <>
      <PhotoMarkup
        image={image}
        handles={handles}
        onMove={(hid, at) => {
          const [id, k] = hid.split(':');
          const it = items.find((x) => x.id === id);
          if (!it || k === undefined) return onExtraMove?.(hid, at);
          onItems(items.map((x) => (x.id === id ? { ...x, quad: x.quad.map((p, i) => (i === Number(k) ? at : p)) as Quad } : x)));
        }}
      >
        {(u) => (
          <>
            {drawOrder(visible).map((it) => {
              const st = it.tag && it.tag.as !== 'ignore' ? STYLE[it.tag.as] : STYLE.none;
              const isSel = it.id === selectedId;
              const text = label(it);
              const [x0, y0] = [Math.min(...it.quad.map((p) => p[0])), Math.min(...it.quad.map((p) => p[1]))];
              return (
                <g key={it.id}>
                  <polygon
                    points={it.quad.map((p) => p.join(',')).join(' ')}
                    fill={isSel ? '#0a84ff22' : st.fill}
                    stroke={isSel ? '#0a84ff' : st.stroke}
                    strokeOpacity={it.tag ? 1 : 0.8}
                    strokeWidth={(isSel ? 3 : 2) * u}
                    strokeDasharray={st.dash && !isSel ? `${6 * u} ${5 * u}` : undefined}
                    pointerEvents="all"
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onSelect(it.id);
                    }}
                  />
                  {text && (
                    <text x={x0 + 4 * u} y={y0 - 6 * u} fontSize={13 * u} className="svg-label" pointerEvents="none">
                      {text}
                    </text>
                  )}
                </g>
              );
            })}
            {overlay?.(u)}
          </>
        )}
      </PhotoMarkup>

      {sel && (
        <div className="card tag-panel" role="group" aria-label="What is this?">
          <div className="tag-head">
            <strong>What is this?</strong>
            <button className="link" onClick={() => onSelect(null)}>
              Done
            </button>
          </div>
          {!sel.tag && sel.guess && (
            <button className="primary" onClick={() => tag({ as: 'keep', kind: sel.guess! })}>
              It’s a {KIND_LABEL[sel.guess]}: keep art off it
            </button>
          )}
          <div className="chips" role="radiogroup" aria-label="Tag">
            {allowRef && (
              <button role="radio" aria-checked={sel.tag?.as === 'ref'} className={`chip-btn${sel.tag?.as === 'ref' ? ' on' : ''}`} onClick={() => tag({ as: 'ref' })}>
                I know its size
              </button>
            )}
            <button role="radio" aria-checked={sel.tag?.as === 'hang'} className={`chip-btn${sel.tag?.as === 'hang' ? ' on' : ''}`} onClick={() => tag({ as: 'hang' })}>
              Hang art inside this
            </button>
            <button
              role="radio"
              aria-checked={sel.tag?.as === 'keep'}
              className={`chip-btn${sel.tag?.as === 'keep' ? ' on' : ''}`}
              onClick={() => tag({ as: 'keep', kind: sel.tag?.as === 'keep' ? sel.tag.kind : (sel.guess ?? 'other') })}
            >
              Keep art off this
            </button>
            <button role="radio" aria-checked={sel.tag?.as === 'ignore'} className={`chip-btn${sel.tag?.as === 'ignore' ? ' on' : ''}`} onClick={() => tag({ as: 'ignore' })}>
              Not important
            </button>
          </div>
          {sel.tag?.as === 'keep' && (
            <div className="chips" role="radiogroup" aria-label="Kind">
              {KINDS.map((k: KeepOutKind) => (
                <button key={k} role="radio" aria-checked={sel.tag?.as === 'keep' && sel.tag.kind === k} className={`chip-btn small${sel.tag?.as === 'keep' && sel.tag.kind === k ? ' on' : ''}`} onClick={() => tag({ as: 'keep', kind: k })}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          )}
          {sel.tag?.as === 'hang' && <p className="hint">Art will only be planned inside this area (e.g. a panel moulding).</p>}
          {sel.tag?.as === 'ref' && refPanel?.(sel)}
        </div>
      )}
    </>
  );
}

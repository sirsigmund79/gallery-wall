// A photo with an SVG overlay in image-pixel coordinates, draggable handles,
// and a magnifier loupe while dragging (spec §5.3).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Pt } from '../geometry/vec.ts';
import { clamp } from '../geometry/vec.ts';

export interface Handle {
  id: string;
  at: Pt;
  /** Constrain dragging to one axis. */
  axis?: 'x' | 'y';
  label?: string;
  color?: string;
}

interface Props {
  image: HTMLImageElement;
  handles: Handle[];
  onMove: (id: string, at: Pt) => void;
  onActivate?: (id: string) => void;
  /** Extra SVG drawn under the handles; receives the px size of 1 screen px in image units. */
  children?: (unit: number) => ReactNode;
}

const HANDLE_PX = 22; // touch target radius on screen
const LOUPE_PX = 132;
const LOUPE_ZOOM = 4; // relative to the on-screen photo

export function PhotoMarkup({ image, handles, onMove, onActivate, children }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const [displayW, setDisplayW] = useState(0);
  const [drag, setDrag] = useState<{ id: string; screen: Pt; at: Pt; boxW: number } | null>(null);
  const W = image.naturalWidth;
  const H = image.naturalHeight;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDisplayW(svg.current?.getBoundingClientRect().width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const unit = displayW ? W / displayW : 1; // image px per screen px

  const toImage = useCallback(
    (clientX: number, clientY: number): Pt => {
      const r = svg.current!.getBoundingClientRect();
      return [clamp(((clientX - r.left) / r.width) * W, 0, W), clamp(((clientY - r.top) / r.height) * H, 0, H)];
    },
    [W, H],
  );

  // Draw the loupe.
  useEffect(() => {
    const c = loupe.current;
    if (!drag || !c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.height = LOUPE_PX * dpr;
    const ctx = c.getContext('2d')!;
    const srcSize = (LOUPE_PX * unit) / LOUPE_ZOOM;
    const [x, y] = drag.at;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(image, x - srcSize / 2, y - srcSize / 2, srcSize, srcSize, 0, 0, c.width, c.height);
    const m = c.width / 2;
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(m, m - 14 * dpr); ctx.lineTo(m, m - 4 * dpr);
    ctx.moveTo(m, m + 4 * dpr); ctx.lineTo(m, m + 14 * dpr);
    ctx.moveTo(m - 14 * dpr, m); ctx.lineTo(m - 4 * dpr, m);
    ctx.moveTo(m + 4 * dpr, m); ctx.lineTo(m + 14 * dpr, m);
    ctx.stroke();
  }, [drag, image, unit]);

  const startDrag = (h: Handle) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    onActivate?.(h.id);
    // Keep the offset between finger and handle so the handle doesn't jump under the finger.
    const start = toImage(e.clientX, e.clientY);
    const off: Pt = [h.at[0] - start[0], h.at[1] - start[1]];
    const move = (ev: PointerEvent) => {
      const p = toImage(ev.clientX, ev.clientY);
      let at: Pt = [clamp(p[0] + off[0], 0, W), clamp(p[1] + off[1], 0, H)];
      if (h.axis === 'x') at = [at[0], h.at[1]];
      if (h.axis === 'y') at = [h.at[0], at[1]];
      onMove(h.id, at);
      const r = wrap.current!.getBoundingClientRect();
      setDrag({ id: h.id, screen: [ev.clientX - r.left, ev.clientY - r.top], at, boxW: r.width });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    const r = wrap.current!.getBoundingClientRect();
    setDrag({ id: h.id, screen: [e.clientX - r.left, e.clientY - r.top], at: h.at, boxW: r.width });
  };

  // Loupe sits above the finger; flips below near the top edge.
  const loupeTop = drag ? (drag.screen[1] - LOUPE_PX - 48 < 0 ? drag.screen[1] + 48 : drag.screen[1] - LOUPE_PX - 48) : 0;
  const loupeLeft = drag ? clamp(drag.screen[0] - LOUPE_PX / 2, 0, drag.boxW - LOUPE_PX) : 0;

  return (
    <div className="markup" ref={wrap}>
      <img src={image.src} alt="" draggable={false} />
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {children?.(unit)}
        {handles.map((h) => (
          <g key={h.id} transform={`translate(${h.at[0]} ${h.at[1]})`}>
            <circle
              r={HANDLE_PX * unit}
              className="hit"
              onPointerDown={startDrag(h)}
              role="slider"
              aria-label={h.label ?? h.id}
              aria-valuetext={`${Math.round(h.at[0])}, ${Math.round(h.at[1])}`}
            />
            <circle r={7 * unit} fill="none" stroke={h.color ?? '#ff3b30'} strokeWidth={2.5 * unit} pointerEvents="none" />
            <circle r={1.5 * unit} fill={h.color ?? '#ff3b30'} pointerEvents="none" />
          </g>
        ))}
      </svg>
      {drag && <canvas ref={loupe} className="loupe" style={{ top: loupeTop, left: loupeLeft, width: LOUPE_PX, height: LOUPE_PX }} />}
    </div>
  );
}

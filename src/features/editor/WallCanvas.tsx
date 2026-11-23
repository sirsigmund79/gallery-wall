import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Konva from 'konva';
import { Group, Image as KImage, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { ArtPiece, LengthUnit, Mm, Placement, Wall } from '../../domain/types.ts';
import { axisScales } from '../../geometry/calibration.ts';
import { snapRect, type GapMark, type Guide } from '../../geometry/layout/snap.ts';
import { formatLength } from '../../geometry/units.ts';
import { EYE_LEVEL_MM } from './placement.ts';
import { useBlobImage } from '../../media/useBlobUrl.ts';

// Allow pinch-zoom while a drag is in progress.
Konva.hitOnDragEnabled = true;

/** Snap distance in screen pixels (spec §6.5). */
const SNAP_SCREEN_PX = 10;
const MIN_SCALE = 0.02;
const MAX_SCALE = 20;

interface View {
  scale: number; // screen px per mm
  x: number;
  y: number;
}

interface Props {
  wall: Wall;
  placements: Placement[];
  pieces: Map<string, ArtPiece>;
  selectedId: string | null;
  snapping: boolean;
  units: LengthUnit;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: Mm, y: Mm) => void;
  /** Exposes a fit-to-screen action to the parent. */
  fitRef?: React.MutableRefObject<(() => void) | null>;
}

export function wallLines(wall: Wall): { linesX: Mm[]; linesY: Mm[]; eyeY?: Mm } {
  const b = wall.bounds;
  const linesX = [b.left, b.right, (b.left + b.right) / 2];
  const linesY = [b.top, b.bottom, (b.top + b.bottom) / 2];
  let eyeY: Mm | undefined;
  if (wall.datums.floorY !== undefined) {
    eyeY = wall.datums.floorY - EYE_LEVEL_MM;
    linesY.push(wall.datums.floorY, eyeY);
  }
  if (wall.datums.ceilingY !== undefined) linesY.push(wall.datums.ceilingY);
  return { linesX, linesY, eyeY };
}

export function WallCanvas({ wall, placements, pieces, selectedId, snapping, units, onSelect, onMove, fitRef }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [guides, setGuides] = useState<Guide[]>([]);
  const [gaps, setGaps] = useState<GapMark[]>([]);
  const photo = useBlobImage(wall.photo.rectified);
  const { sx, sy } = axisScales(wall.calibration);
  const photoW = wall.photo.widthPx / sx;
  const photoH = wall.photo.heightPx / sy;
  const lines = useMemo(() => wallLines(wall), [wall]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!size.w || !size.h) return;
    const scale = Math.min(size.w / photoW, size.h / photoH) * 0.96;
    setView({ scale, x: (size.w - photoW * scale) / 2, y: (size.h - photoH * scale) / 2 });
  }, [size, photoW, photoH]);

  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && size.w) {
      fit();
      fitted.current = true;
    }
  }, [fit, size.w]);
  useEffect(() => {
    if (fitRef) fitRef.current = fit;
  }, [fit, fitRef]);

  const px = 1 / view.scale; // one screen px in mm

  // ── Zoom (wheel + pinch) ──
  const zoomAt = (screen: { x: number; y: number }, newScale: number, base = view) => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
    const wx = (screen.x - base.x) / base.scale;
    const wy = (screen.y - base.y) / base.scale;
    setView({ scale, x: screen.x - wx * scale, y: screen.y - wy * scale });
  };

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = stageRef.current!.getPointerPosition();
    if (!p) return;
    zoomAt(p, view.scale * Math.exp(-e.evt.deltaY * 0.0015));
  };

  const pinch = useRef<{ dist: number; center: { x: number; y: number }; view: View } | null>(null);
  const onTouchMove = (e: KonvaEventObject<TouchEvent>) => {
    const t = e.evt.touches;
    if (t.length !== 2) return;
    e.evt.preventDefault();
    const stage = stageRef.current!;
    if (stage.isDragging()) stage.stopDrag();
    const r = stage.container().getBoundingClientRect();
    const a = { x: t[0]!.clientX - r.left, y: t[0]!.clientY - r.top };
    const b = { x: t[1]!.clientX - r.left, y: t[1]!.clientY - r.top };
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (!pinch.current) {
      pinch.current = { dist, center, view };
      return;
    }
    const p0 = pinch.current;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, p0.view.scale * (dist / p0.dist)));
    // Keep the world point under the initial centre under the moving centre.
    const wx = (p0.center.x - p0.view.x) / p0.view.scale;
    const wy = (p0.center.y - p0.view.y) / p0.view.scale;
    setView({ scale, x: center.x - wx * scale, y: center.y - wy * scale });
  };
  const onTouchEnd = () => {
    pinch.current = null;
  };

  // ── Piece dragging with snapping ──
  const others = (id: string) =>
    placements
      .filter((p) => p.pieceId !== id)
      .flatMap((p) => {
        const pc = pieces.get(p.pieceId);
        return pc ? [{ x: p.x, y: p.y, w: pc.widthMm, h: pc.heightMm }] : [];
      });

  const onPieceDragMove = (id: string, piece: ArtPiece) => (e: KonvaEventObject<DragEvent>) => {
    const node = e.target;
    if (!snapping) {
      setGuides([]);
      setGaps([]);
      return;
    }
    const s = snapRect(
      { x: node.x(), y: node.y(), w: piece.widthMm, h: piece.heightMm },
      { others: others(id), linesX: lines.linesX, linesY: lines.linesY },
      SNAP_SCREEN_PX * px,
    );
    node.position({ x: s.x, y: s.y });
    setGuides(s.guides);
    setGaps(s.gaps);
  };

  const onPieceDragEnd = (id: string) => (e: KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    setGuides([]);
    setGaps([]);
    onMove(id, e.target.x(), e.target.y());
  };

  const b = wall.bounds;
  return (
    <div className="canvas-box" ref={box}>
      {size.w > 0 && (
        <Stage
          ref={stageRef}
          width={size.w}
          height={size.h}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          draggable
          onDragEnd={(e) => {
            if (e.target === stageRef.current) setView({ ...view, x: e.target.x(), y: e.target.y() });
          }}
          onWheel={onWheel}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onDblClick={(e) => e.target === stageRef.current && fit()}
          onDblTap={(e) => e.target === stageRef.current && fit()}
          onMouseDown={(e) => (e.target === stageRef.current || e.target.name() === 'bg') && onSelect(null)}
          onTouchStart={(e) => (e.target === stageRef.current || e.target.name() === 'bg') && onSelect(null)}
        >
          <Layer listening>
            {photo ? (
              <KImage name="bg" image={photo} width={photoW} height={photoH} />
            ) : (
              <Rect name="bg" width={photoW} height={photoH} fill="#ccc" />
            )}
            {/* Dim outside the usable wall area */}
            <Rect listening={false} x={0} y={0} width={photoW} height={b.top} fill="#000" opacity={0.35} />
            <Rect listening={false} x={0} y={b.bottom} width={photoW} height={photoH - b.bottom} fill="#000" opacity={0.35} />
            <Rect listening={false} x={0} y={b.top} width={b.left} height={b.bottom - b.top} fill="#000" opacity={0.35} />
            <Rect listening={false} x={b.right} y={b.top} width={photoW - b.right} height={b.bottom - b.top} fill="#000" opacity={0.35} />
            <Rect listening={false} x={b.left} y={b.top} width={b.right - b.left} height={b.bottom - b.top} stroke="#0a84ff" strokeWidth={1.5} strokeScaleEnabled={false} />
            {lines.eyeY !== undefined && (
              <>
                <Line listening={false} points={[b.left, lines.eyeY, b.right, lines.eyeY]} stroke="#ffffff" opacity={0.7} strokeWidth={1} dash={[6, 6]} strokeScaleEnabled={false} />
                <Text listening={false} x={b.left + 6 * px} y={lines.eyeY - 16 * px} text="Eye level" fontSize={12 * px} fill="#fff" />
              </>
            )}
            {(wall.keepOut ?? []).map((k, i) => (
              <Group key={`ko${i}`} listening={false}>
                <Rect x={k.x} y={k.y} width={k.w} height={k.h} stroke="#ffffff" opacity={0.6} strokeWidth={1.5} dash={[8, 6]} strokeScaleEnabled={false} />
                <Text x={k.x + 6 * px} y={k.y + 6 * px} text={`${k.label} · no art`} fontSize={12 * px} fill="#fff" opacity={0.85} />
              </Group>
            ))}
            {wall.datums.floorY !== undefined && (
              <Line listening={false} points={[0, wall.datums.floorY, photoW, wall.datums.floorY]} stroke="#30d158" strokeWidth={1.5} strokeScaleEnabled={false} />
            )}
          </Layer>
          <Layer>
            {placements.map((pl) => {
              const pc = pieces.get(pl.pieceId);
              if (!pc) return null;
              return (
                <PieceNode
                  key={pl.pieceId}
                  piece={pc}
                  placement={pl}
                  selected={pl.pieceId === selectedId}
                  px={px}
                  onSelect={() => onSelect(pl.pieceId)}
                  onDragStart={() => onSelect(pl.pieceId)}
                  onDragMove={onPieceDragMove(pl.pieceId, pc)}
                  onDragEnd={onPieceDragEnd(pl.pieceId)}
                />
              );
            })}
          </Layer>
          <Layer listening={false}>
            {guides.map((g, i) =>
              g.axis === 'x' ? (
                <Line key={i} points={[g.at, 0, g.at, photoH]} stroke="#ff2d92" strokeWidth={1} strokeScaleEnabled={false} />
              ) : (
                <Line key={i} points={[0, g.at, photoW, g.at]} stroke="#ff2d92" strokeWidth={1} strokeScaleEnabled={false} />
              ),
            )}
            {gaps.map((g, i) => {
              const pts = g.axis === 'x' ? [g.from, g.cross, g.to, g.cross] : [g.cross, g.from, g.cross, g.to];
              const mid = (g.from + g.to) / 2;
              return (
                <Group key={`gap${i}`}>
                  <Line points={pts} stroke="#ff2d92" strokeWidth={2} strokeScaleEnabled={false} />
                  <Text
                    x={g.axis === 'x' ? mid - 40 * px : g.cross + 4 * px}
                    y={g.axis === 'x' ? g.cross + 4 * px : mid - 6 * px}
                    width={g.axis === 'x' ? 80 * px : undefined}
                    align="center"
                    text={formatLength(g.to - g.from, units)}
                    fontSize={12 * px}
                    fill="#ff2d92"
                    fontStyle="bold"
                  />
                </Group>
              );
            })}
          </Layer>
        </Stage>
      )}
    </div>
  );
}

interface PieceNodeProps {
  piece: ArtPiece;
  placement: Placement;
  selected: boolean;
  px: number;
  onSelect: () => void;
  onDragStart: () => void;
  onDragMove: (e: KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: KonvaEventObject<DragEvent>) => void;
}

function PieceNode({ piece, placement, selected, px, onSelect, onDragStart, onDragMove, onDragEnd }: PieceNodeProps) {
  const img = useBlobImage(piece.image);
  const w = piece.widthMm;
  const h = piece.heightMm;
  return (
    <Group
      x={placement.x}
      y={placement.y}
      draggable={!placement.locked}
      onClick={onSelect}
      onTap={onSelect}
      onDragStart={(e) => {
        e.cancelBubble = true;
        onDragStart();
      }}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
    >
      {img ? (
        <KImage image={img} width={w} height={h} shadowColor="#000" shadowBlur={8 * px} shadowOpacity={0.4} shadowOffset={{ x: 2 * px, y: 3 * px }} />
      ) : (
        <>
          <Rect width={w} height={h} fill="#e8e2d6" stroke="#5a5247" strokeWidth={1} strokeScaleEnabled={false} shadowColor="#000" shadowBlur={8 * px} shadowOpacity={0.35} />
          <Text width={w} height={h} align="center" verticalAlign="middle" text={piece.name} fontSize={Math.min(14 * px, h / 4, w / 6)} fill="#3d372f" padding={4 * px} />
        </>
      )}
      {selected && (
        <>
          <Rect width={w} height={h} stroke="#0a84ff" strokeWidth={3} strokeScaleEnabled={false} />
          {piece.hang.hooks.map((hk, i) => (
            <Group key={i} x={hk.dx} y={hk.dy} listening={false}>
              <Line points={[-8 * px, 0, 8 * px, 0]} stroke="#ff3b30" strokeWidth={2} strokeScaleEnabled={false} />
              <Line points={[0, -8 * px, 0, 8 * px]} stroke="#ff3b30" strokeWidth={2} strokeScaleEnabled={false} />
            </Group>
          ))}
        </>
      )}
      {placement.locked && <Text x={4 * px} y={4 * px} text="🔒" fontSize={14 * px} listening={false} />}
    </Group>
  );
}

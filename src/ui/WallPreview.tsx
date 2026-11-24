// A wall photo with art drawn at true scale: used by suggestions and Home.
import { useEffect, useState } from 'react';
import { getBlob } from '../db/repo.ts';
import type { ArtPiece, Placement, Wall } from '../domain/types.ts';
import { axisScales } from '../geometry/calibration.ts';
import { useBlobUrl } from '../media/useBlobUrl.ts';

/** Object URLs for many blobs at once (revoked on change/unmount). */
export function useBlobUrls(refs: (string | undefined)[]): Map<string, string> {
  const key = refs.filter(Boolean).sort().join('|');
  const [map, setMap] = useState<{ key: string; urls: Map<string, string> }>({ key: '', urls: new Map() });
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    const ids = key ? key.split('|') : [];
    void Promise.all(ids.map(async (id) => [id, await getBlob(id)] as const)).then((pairs) => {
      if (!alive) return;
      const urls = new Map<string, string>();
      for (const [id, b] of pairs)
        if (b) {
          const u = URL.createObjectURL(b);
          made.push(u);
          urls.set(id, u);
        }
      setMap({ key, urls });
    });
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [key]);
  return map.key === key ? map.urls : new Map();
}

interface Props {
  wall: Wall;
  placements: Pick<Placement, 'pieceId' | 'x' | 'y'>[];
  pieces: Map<string, ArtPiece>;
  /** Crop to the wall area (default), show the whole photo, or show a given area (mm). */
  crop?: 'wall' | 'photo' | { x: number; y: number; w: number; h: number };
  className?: string;
  label?: string;
  /** Pieces to outline (e.g. the spot something hangs now). */
  ghosts?: { x: number; y: number; w: number; h: number }[];
}

export function WallPreview({ wall, placements, pieces, crop = 'wall', className, label, ghosts = [] }: Props) {
  const photo = useBlobUrl(wall.thumb ?? wall.photo.rectified);
  const thumbs = useBlobUrls(placements.map((p) => pieces.get(p.pieceId)?.thumb));
  const { sx, sy } = axisScales(wall.calibration);
  const W = wall.photo.widthPx / sx, H = wall.photo.heightPx / sy;
  const b = wall.bounds;
  const vb = typeof crop === 'object' ? [crop.x, crop.y, crop.w, crop.h] : crop === 'wall' ? [b.left, b.top, b.right - b.left, b.bottom - b.top] : [0, 0, W, H];
  const stroke = Math.max(vb[2]!, vb[3]!) / 300;
  return (
    <svg className={className} viewBox={vb.join(' ')} preserveAspectRatio="xMidYMid slice" role="img" aria-label={label}>
      <rect x={0} y={0} width={W} height={H} fill="#cfc8bb" />
      {photo && <image href={photo} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />}
      {ghosts.map((g, i) => (
        <rect key={`g${i}`} x={g.x} y={g.y} width={g.w} height={g.h} fill="none" stroke="#fff" strokeOpacity={0.9} strokeWidth={stroke} strokeDasharray={`${stroke * 4} ${stroke * 3}`} />
      ))}
      {placements.map((pl) => {
        const p = pieces.get(pl.pieceId);
        if (!p) return null;
        const url = p.thumb ? thumbs.get(p.thumb) : undefined;
        return (
          <g key={pl.pieceId}>
            <rect x={pl.x + stroke} y={pl.y + stroke * 1.5} width={p.widthMm} height={p.heightMm} fill="#000" opacity={0.25} />
            {url ? (
              <image href={url} x={pl.x} y={pl.y} width={p.widthMm} height={p.heightMm} preserveAspectRatio="none" />
            ) : (
              <rect x={pl.x} y={pl.y} width={p.widthMm} height={p.heightMm} fill="#e8e2d6" stroke="#5a5247" strokeWidth={stroke} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

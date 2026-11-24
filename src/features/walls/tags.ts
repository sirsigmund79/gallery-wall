// Tagging what's on a wall: each outlined rectangle can be the size reference,
// the area art hangs in, something art must stay off, or ignored. Pure.
import type { RGBAImage } from '../../cv/types.ts';
import type { KeepOutKind, Mm, Wall } from '../../domain/types.ts';
import type { Quad } from '../../geometry/quad.ts';
import { polygonArea } from '../../geometry/quad.ts';

export type Tag = { as: 'ref' } | { as: 'hang' } | { as: 'keep'; kind: KeepOutKind } | { as: 'ignore' };

export interface TagItem {
  id: string;
  quad: Quad;
  tag?: Tag;
  /** What we think it is (shown as "TV?"), for the user to confirm. */
  guess?: KeepOutKind;
  /** Doorway whose top is out of frame: only its width can be a reference. */
  widthOnly?: boolean;
}

export const KIND_LABEL: Record<KeepOutKind, string> = { tv: 'TV', window: 'Window', door: 'Door', furniture: 'Furniture', other: 'Other' };
export const KINDS = Object.keys(KIND_LABEL) as KeepOutKind[];
/** Kinds that art sits above (centred, with a gap), rather than just avoiding. */
export const ANCHOR_KINDS: KeepOutKind[] = ['tv', 'furniture'];

/** Draw largest first so smaller rectangles sit on top and win taps (a switch inside a panel). */
export const drawOrder = (items: TagItem[]) => [...items].sort((a, b) => polygonArea(b.quad) - polygonArea(a.quad));

/** Mean brightness (0–255) inside a quad's bounding box, sampled. */
export function meanLuma(img: RGBAImage, q: Quad): number {
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(img.width, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(img.height, Math.ceil(Math.max(...ys)));
  const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 40));
  let sum = 0, n = 0;
  for (let y = y0 + step; y < y1 - step; y += step)
    for (let x = x0 + step; x < x1 - step; x += step) {
      const i = (y * img.width + x) * 4;
      sum += 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
      n++;
    }
  return n ? sum / n : 128;
}

/** Dark and TV-shaped (16:9 to 2:1, landscape) → probably a TV. */
export function guessKind(img: RGBAImage, q: Quad): KeepOutKind | undefined {
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const aspect = w / h;
  if (aspect >= 1.5 && aspect <= 2.2 && w >= img.width * 0.15 && meanLuma(img, q) < 70) return 'tv';
  return undefined;
}

/** Give one item a tag. Only one reference and one hanging area at a time. */
export function setTag(items: TagItem[], id: string, tag: Tag | undefined): TagItem[] {
  return items.map((it) => {
    if (it.id === id) return { ...it, tag };
    if (tag && (tag.as === 'ref' || tag.as === 'hang') && it.tag?.as === tag.as) return { ...it, tag: undefined };
    return it;
  });
}

type Box = { x: Mm; y: Mm; w: Mm; h: Mm };

/** Turn tagged items into wall data, given how image px map to wall mm. */
export function tagsToWall(items: TagItem[], toMmBox: (q: Quad) => Box): { keepOut: NonNullable<Wall['keepOut']>; hang?: Box } {
  const keepOut = items.flatMap((it) =>
    it.tag?.as === 'keep' ? [{ ...toMmBox(it.quad), kind: it.tag.kind, label: KIND_LABEL[it.tag.kind] }] : [],
  );
  const h = items.find((it) => it.tag?.as === 'hang');
  return { keepOut, hang: h ? toMmBox(h.quad) : undefined };
}

/** Older walls stored keep-outs without a kind (only doors existed then). */
export const kindOf = (k: { kind?: KeepOutKind; label: string }): KeepOutKind => k.kind ?? (k.label === 'Door' ? 'door' : 'other');

// "What's on this wall": tag a TV, windows, furniture (art stays off them) or
// a panel (art goes inside it) on an existing wall. Used for better
// suggestions; doesn't change the wall's size or photo.
import { useEffect, useRef, useState } from 'react';
import { navigate } from '../../app/router.ts';
import { blobToRGBA, cloneImage, cvCall, releaseCv } from '../../cv/client.ts';
import { error as logError, info } from '../../diag/log.ts';
import { newId } from '../../db/ids.ts';
import { getBlob, getWall, saveWall } from '../../db/repo.ts';
import type { Wall } from '../../domain/types.ts';
import { axisScales } from '../../geometry/calibration.ts';
import { bboxIoU, orderQuad, type Quad } from '../../geometry/quad.ts';
import { EDIT_MAX_PX } from '../../media/image.ts';
import { ErrorDetails } from '../../ui/ErrorDetails.tsx';
import { TopBar } from '../../ui/TopBar.tsx';
import { WallTagger } from '../../ui/WallTagger.tsx';
import { WorkingPanel } from '../../ui/WorkingPanel.tsx';
import { defaultQuad } from '../scan/scanMath.ts';
import { guessKind, kindOf, tagsToWall, type TagItem } from './tags.ts';

const boxQuad = (x: number, y: number, w: number, h: number): Quad => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

export function WallObjects({ wallId }: { wallId: string }) {
  const [wall, setWall] = useState<Wall | null>(null);
  const [el, setEl] = useState<HTMLImageElement | null>(null);
  const [items, setItems] = useState<TagItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const hangFromBounds = useRef<string | null>(null);
  const url = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const w = await getWall(wallId);
        if (!w) return navigate('walls', { replace: true });
        const blob = await getBlob(w.photo.rectified);
        if (!blob) throw new Error('This wall’s photo is missing.');
        const img = await blobToRGBA(blob, EDIT_MAX_PX);
        const u = URL.createObjectURL(blob);
        url.current = u;
        const image = new Image();
        image.src = u;
        await image.decode();
        // Image px per mm (the working image may be smaller than the stored photo).
        const { sx, sy } = axisScales(w.calibration);
        const kx = (sx * img.width) / w.photo.widthPx, ky = (sy * img.height) / w.photo.heightPx;
        const existing: TagItem[] = (w.keepOut ?? []).map((k) => ({ id: newId(), quad: boxQuad(k.x * kx, k.y * ky, k.w * kx, k.h * ky), tag: { as: 'keep', kind: kindOf(k) } }));
        const b = w.bounds;
        const full = b.left <= 1 && b.top <= 1 && Math.abs(b.right * kx - img.width) < 3 && Math.abs(b.bottom * ky - img.height) < 3;
        if (!full) {
          const it: TagItem = { id: newId(), quad: boxQuad(b.left * kx, b.top * ky, (b.right - b.left) * kx, (b.bottom - b.top) * ky), tag: { as: 'hang' } };
          hangFromBounds.current = it.id;
          existing.push(it);
        }
        const copy = cloneImage(img);
        const f = await cvCall('wallFeatures', { img: copy }, [copy.data.buffer]);
        const detected: TagItem[] = f.quads
          .filter((q) => !existing.some((e) => bboxIoU(e.quad, q) > 0.7))
          .map((quad) => ({ id: newId(), quad, guess: guessKind(img, quad) }));
        info(`Wall objects: ${detected.length} new outline(s), ${existing.length} existing tag(s)`);
        if (!alive) return;
        setWall(w);
        setEl(image);
        setItems([...existing, ...detected]);
        // Keep the scale for saving.
        scale.current = { kx, ky };
      } catch (e) {
        logError('Wall objects failed:', e);
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
      releaseCv();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, [wallId]);
  const scale = useRef({ kx: 1, ky: 1 });

  async function save() {
    if (!wall || !el) return;
    setSaving(true);
    const { kx, ky } = scale.current;
    const toMm = (q: Quad) => {
      const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      return { x: x0 / kx, y: y0 / ky, w: (Math.max(...xs) - x0) / kx, h: (Math.max(...ys) - y0) / ky };
    };
    const t = tagsToWall(items, toMm);
    const { sx, sy } = axisScales(wall.calibration);
    const fullBounds = { left: 0, top: 0, right: wall.photo.widthPx / sx, bottom: wall.photo.heightPx / sy };
    const hangStillTagged = items.some((it) => it.id === hangFromBounds.current && it.tag?.as === 'hang');
    const bounds = t.hang
      ? { left: t.hang.x, top: t.hang.y, right: t.hang.x + t.hang.w, bottom: t.hang.y + t.hang.h }
      : hangFromBounds.current && !hangStillTagged
        ? fullBounds
        : wall.bounds;
    const hangArea = t.hang ? true : hangFromBounds.current && !hangStillTagged ? false : wall.hangArea;
    await saveWall({ ...wall, keepOut: t.keepOut, bounds, hangArea });
    info(`Wall objects: saved ${t.keepOut.length} keep-out(s)${t.hang ? ' and a hanging area' : ''}`);
    navigate(`walls/${wall.id}/edit`, { replace: true });
  }

  return (
    <section className="wizard">
      <TopBar title="What’s on this wall" backHref={`#/walls/${wallId}/edit`} />
      {error ? (
        <ErrorDetails message={error} />
      ) : !wall || !el ? (
        <WorkingPanel status="Looking for the TV, windows, doors and frames… The first time, this also downloads the image tools (about 3.5 MB)." />
      ) : (
        <>
          <p className="step-hint">
            <strong>Tap things on the wall</strong>: keep art off a TV, windows or furniture, or mark a panel to hang art inside. Suggestions use this.
          </p>
          <WallTagger image={el} items={items} onItems={setItems} selectedId={selected} onSelect={setSelected} allowRef={false} />
          <div className="panel">
            <div className="actions">
              <button
                onClick={() => {
                  const it: TagItem = { id: newId(), quad: orderQuad(defaultQuad(el.naturalWidth, el.naturalHeight)) };
                  setItems([...items, it]);
                  setSelected(it.id);
                }}
              >
                Draw a box
              </button>
            </div>
            <p className="hint">Furniture in front of the wall (a sofa, a console) usually isn’t outlined: draw a box over it.</p>
            <div className="actions">
              <button className="primary" disabled={saving} onClick={() => void save()}>
                Save
              </button>
              <a className="button" href={`#/walls/${wallId}/edit`}>
                Cancel
              </a>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// Add a wall in three screens: photo → size it (tap something you know) → done.
// Same "tap the thing you know" interaction as Scan art. A known rectangle
// (e.g. a door) also corrects the photo's angle (spec §5.5); a floor line is
// suggested automatically. Wall edges default to the whole photo; adjusting
// them is an optional extra (advanced screen).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { navigate } from '../../app/router.ts';
import { GuidedCamera, type GuidedShot } from '../../capture/GuidedCamera.tsx';
import { requestMotionPermission, type MotionPermission } from '../../capture/sensors.ts';
import { blobToRGBA, cloneImage, cvCall, releaseCv, rgbaToBlob } from '../../cv/client.ts';
import type { RGBAImage } from '../../cv/types.ts';
import { error as logError, info } from '../../diag/log.ts';
import { newId } from '../../db/ids.ts';
import { deleteBlobs, getBlob, getWall, listWalls, newLayout, putBlob, saveWall } from '../../db/repo.ts';
import type { CalibrationRecord, Mm, Wall } from '../../domain/types.ts';
import { accuracyPct, axisScales, fitCalibration, qualityFromSpread } from '../../geometry/calibration.ts';
import { DEFAULT_F35_MM } from '../../geometry/gravity.ts';
import { applyH } from '../../geometry/mat3.ts';
import { bboxIoU, orderQuad, type Quad } from '../../geometry/quad.ts';
import { formatLength } from '../../geometry/units.ts';
import { dist, type Pt } from '../../geometry/vec.ts';
import { EDIT_MAX_PX, importPhoto, resizeToBlob, THUMB_MAX_PX } from '../../media/image.ts';
import { useSettings } from '../../state/settings.ts';
import { ErrorDetails } from '../../ui/ErrorDetails.tsx';
import { LengthInput } from '../../ui/LengthInput.tsx';
import type { Handle } from '../../ui/PhotoMarkup.tsx';
import { WallTagger } from '../../ui/WallTagger.tsx';
import { guessKind, tagsToWall, type TagItem } from './tags.ts';
import { QualityBadge } from '../../ui/QualityBadge.tsx';
import { ReferencePicker } from '../../ui/ReferencePicker.tsx';
import { RoomPicker } from '../../ui/RoomPicker.tsx';
import { TopBar } from '../../ui/TopBar.tsx';
import { WorkingPanel } from '../../ui/WorkingPanel.tsx';
import { defaultQuad, orientPreset, rectOf } from '../scan/scanMath.ts';
import { LENGTH_PRESETS } from './presets.ts';
import { chooseCalibration, DEFAULT_ROOM, mapQuad, nextWallName, planRectify, quadBoxMm, refErrorPct, sizeOnlyScale, wallPresets, type RefKind } from './wallMath.ts';

type Step = 'photo' | 'camera' | 'working' | 'size' | 'done';

interface Shot {
  original: string;
  edit: string;
  thumb: string;
  img: RGBAImage;
  url: string;
  el: HTMLImageElement;
  capture: { kind: 'guided' | 'import'; gravity?: CalibrationRecord['gravity'] };
}

interface Ref {
  quadId: string;
  widthMm: Mm | null;
  heightMm: Mm | null;
  kind: RefKind;
}

interface Result {
  edit: string;
  thumb: string;
  width: number;
  height: number;
  calibration: CalibrationRecord;
  floorYmm?: Mm;
  keepOut: NonNullable<Wall['keepOut']>;
  /** True if the photo was re-warped face-on. */
  rewarped: boolean;
  url: string;
  /** Rough ± (%) from the reference's size in the photo. */
  errPct?: number;
  /** Area art hangs in (from a tag), in mm. */
  hang?: { x: Mm; y: Mm; w: Mm; h: Mm };
  ceilingYmm?: Mm;
  /** Why the reference was used for size only (no straightening). */
  sizeOnlyReason?: 'level' | 'one-side' | 'small' | 'implausible';
}

const SIZE_ONLY_NOTE = {
  level: 'Taken with the level camera, so the photo is already straight. Your reference set the size.',
  small: 'Used for size only. Tap something bigger (a door) to also correct the camera angle.',
  implausible: 'Straightening from that reference would distort the photo, so it is kept as taken.',
} as const;

const loadEl = (url: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Could not display photo'));
    i.src = url;
  });

export function AddWall({ wallId }: { wallId?: string }) {
  const units = useSettings((s) => s.units);
  const walls = useLiveQuery(listWalls);
  const [existing, setExisting] = useState<Wall | null>(null);
  const [step, setStep] = useState<Step>(wallId ? 'working' : 'photo');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string>();
  const [motion, setMotion] = useState<MotionPermission>('unavailable');
  const [shot, setShot] = useState<Shot | null>(null);
  const [items, setItems] = useState<TagItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  /** Size typed for the item tagged as the reference. */
  const [refSize, setRefSize] = useState<{ forId: string; widthMm: Mm | null; heightMm: Mm | null; kind: RefKind }>({ forId: '', widthMm: null, heightMm: null, kind: 'other' });
  const [ceiling, setCeiling] = useState<{ y: number; confirmed: boolean } | null>(null);
  const [lineMode, setLineMode] = useState(false);
  const [line, setLine] = useState<{ p: Pt; q: Pt; lengthMm: Mm | null }>({ p: [0, 0], q: [0, 0], lengthMm: null });
  const [floor, setFloor] = useState<{ y: number; suggested: boolean; confirmed: boolean } | null>(null);
  const [options, setOptions] = useState<{ asTaken: Result; warped?: Result } | null>(null);
  const [useWarp, setUseWarp] = useState(false);
  const result = options ? (useWarp && options.warped ? options.warped : options.asTaken) : null;
  const [name, setName] = useState('');
  const [room, setRoom] = useState<string | null>(null);
  const created = useRef<string[]>([]); // blobs to clean up on cancel
  const urls = useRef<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      releaseCv();
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );
  const objectUrl = (b: Blob) => {
    const u = URL.createObjectURL(b);
    urls.current.push(u);
    return u;
  };

  const rooms = useMemo(() => {
    const rs = [...new Set((walls ?? []).map((w) => w.room ?? DEFAULT_ROOM))];
    return rs.length ? rs : [DEFAULT_ROOM];
  }, [walls]);
  const chosenRoom = room ?? existing?.room ?? walls?.[0]?.room ?? DEFAULT_ROOM;

  // ── Re-measuring an existing wall: start from its current photo ──
  useEffect(() => {
    if (!wallId) return;
    void (async () => {
      const w = await getWall(wallId);
      if (!w) return navigate('walls', { replace: true });
      setExisting(w);
      setName(w.name);
      const blob = await getBlob(w.photo.rectified);
      if (!blob) return setError('This wall’s photo is missing.');
      await analyse({ original: w.photo.original, edit: w.photo.rectified, thumb: w.thumb ?? w.photo.rectified, blob, capture: { kind: w.capture ?? 'import', gravity: w.calibration.gravity } });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallId]);

  /** Detect rectangles and the floor line, then show the Size-it screen. */
  async function analyse(input: { original: string; edit: string; thumb: string; blob: Blob; capture: Shot['capture'] }) {
    setStep('working');
    setError(undefined);
    try {
      setStatus('Looking for doors, windows and frames… The first time, this also downloads the image tools (about 3.5 MB).');
      const img = await blobToRGBA(input.blob, EDIT_MAX_PX);
      const url = objectUrl(input.blob);
      const el = await loadEl(url);
      const a = cloneImage(img);
      const f = await cvCall('wallFeatures', { img: a }, [a.data.buffer]);
      info(`Wall: ${f.quads.length} rectangle(s), ${f.doorways.length} doorway(s); floor ${f.floorY === null ? 'not found' : `at y=${Math.round(f.floorY)}`}; ceiling ${f.ceilingY === null ? 'not found' : `at y=${Math.round(f.ceilingY)}`}`);
      const found: TagItem[] = f.quads.map((quad) => ({ id: newId(), quad, guess: guessKind(img, quad) }));
      // Doorways: mark a matching rectangle as "Door?", or add the doorway itself.
      for (const d of f.doorways) {
        const same = found.find((it) => bboxIoU(it.quad, d.quad) > 0.6);
        if (same) same.guess = 'door';
        else found.push({ id: newId(), quad: d.quad, guess: 'door', widthOnly: !d.topVisible });
      }
      setShot({ ...input, img, url, el });
      setItems(found);
      setSelected(null);
      setCeiling(f.ceilingY !== null && f.floorY !== null ? { y: f.ceilingY, confirmed: false } : null);
      setLineMode(found.length === 0 && f.ceilingY === null);
      const floorY = f.floorY;
      setLine({ p: [img.width * 0.3, img.height * 0.6], q: [img.width * 0.7, img.height * 0.6], lengthMm: null });
      setFloor(floorY === null ? null : { y: floorY, suggested: true, confirmed: false });
      setStep('size');
    } catch (e) {
      logError('Wall: analysis failed:', e);
      setError(`Could not read the photo: ${(e as Error).message}`);
      setStep(wallId ? 'size' : 'photo');
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      setStep('working');
      setStatus('Preparing photo…');
      const ph = await importPhoto(file);
      const [original, edit, thumb] = await Promise.all([putBlob(ph.original.blob), putBlob(ph.edit.blob), putBlob(ph.thumb.blob)]);
      created.current.push(original, edit, thumb);
      await analyse({ original, edit, thumb, blob: ph.edit.blob, capture: { kind: 'import' } });
    } catch (e) {
      logError('Wall: import failed:', e);
      setError('That photo could not be read. Try a JPEG or PNG.');
      setStep('photo');
    }
  }

  async function onGuided(s: GuidedShot) {
    try {
      setStep('working');
      setStatus('Straightening photo…');
      const { straighten } = await import('../../capture/straighten.ts');
      const st = await straighten(s.blob, s.gravity?.g ?? null, 'wall');
      const bmp = await createImageBitmap(st.blob);
      const thumbBlob = (await resizeToBlob(bmp, THUMB_MAX_PX, 0.8)).blob;
      bmp.close();
      const [original, edit, thumb] = await Promise.all([putBlob(s.blob), putBlob(st.blob), putBlob(thumbBlob)]);
      created.current.push(original, edit, thumb);
      const capture: Shot['capture'] =
        st.corrected && s.gravity
          ? { kind: 'guided', gravity: { betaDeg: s.gravity.betaDeg, gammaDeg: s.gravity.gammaDeg, f35mm: DEFAULT_F35_MM, fSource: 'default' } }
          : { kind: 'import' };
      await analyse({ original, edit, thumb, blob: st.blob, capture });
    } catch (e) {
      logError('Wall: camera photo failed:', e);
      setError(`Could not process the photo: ${(e as Error).message}`);
      setStep('photo');
    }
  }

  async function openCamera() {
    // iOS: the permission request must be the first thing in the tap handler.
    setMotion(await requestMotionPermission());
    setStep('camera');
  }

  async function cancel() {
    await deleteBlobs(created.current);
    navigate(existing ? `walls/${existing.id}` : 'walls');
  }

  // ── Calibrate (Size it → Done) ──
  const refItem = items.find((it) => it.tag?.as === 'ref');
  const ref: Ref | null = refItem
    ? { quadId: refItem.id, ...(refSize.forId === refItem.id ? { widthMm: refSize.widthMm, heightMm: refSize.heightMm, kind: refSize.kind } : { widthMm: null, heightMm: null, kind: 'other' as RefKind }) }
    : null;
  const refQuad = refItem?.quad;
  const canContinue = lineMode ? !!line.lengthMm && dist(line.p, line.q) > 10 : !!refQuad && !!(ref!.widthMm || ref!.heightMm);

  async function finish() {
    if (!shot) return;
    setStep('working');
    setStatus('Measuring the wall…');
    try {
      const img = shot.img;
      const guided = shot.capture.kind === 'guided';
      const base = { gravity: shot.capture.gravity };
      const floorPx = floor && (floor.confirmed || floor.suggested) ? floor.y : undefined;
      const ceilingPx = ceiling?.confirmed ? ceiling.y : undefined;
      /** Tagged keep-outs and hanging area in mm, plus the door used as the reference. */
      const withTags = (toMm: (q: Quad) => { x: Mm; y: Mm; w: Mm; h: Mm }, refDoor?: { x: Mm; y: Mm; w: Mm; h: Mm }) => {
        const t = tagsToWall(items, toMm);
        return { keepOut: [...t.keepOut, ...(refDoor ? [{ ...refDoor, kind: 'door' as const, label: 'Door' }] : [])], hang: t.hang };
      };
      let asTaken: Result;
      let warped: Result | undefined;
      if (lineMode || !refQuad || !ref) {
        const m = { p: line.p, q: line.q, lengthMm: line.lengthMm! };
        const fit = fitCalibration([m], { guided })!;
        const tagged = tagsToWall(items, (q) => quadBoxMm(q, fit.pxPerMm));
        asTaken = {
          edit: shot.edit, thumb: shot.thumb, width: img.width, height: img.height, url: shot.url, rewarped: false, keepOut: tagged.keepOut, hang: tagged.hang,
          ceilingYmm: ceilingPx !== undefined ? ceilingPx / fit.pxPerMm : undefined,
          calibration: { ...base, method: 'measure', measurements: [m], pxPerMm: fit.pxPerMm, anisotropy: fit.anisotropy, spreadPct: fit.spreadPct, quality: fit.quality },
          floorYmm: floorPx !== undefined ? floorPx / (fit.anisotropy?.sy ?? fit.pxPerMm) : undefined,
        };
      } else {
        // Reference rectangle. Always available: use it for size only, photo as taken.
        const size = sizeOnlyScale(refQuad, ref.widthMm, ref.heightMm)!;
        const errPct = refErrorPct(refQuad);
        const [tl, tr, , bl] = refQuad;
        const measurements = [
          ...(ref.widthMm ? [{ p: tl, q: tr, lengthMm: ref.widthMm }] : []),
          ...(ref.heightMm ? [{ p: tl, q: bl, lengthMm: ref.heightMm }] : []),
        ];
        const worst = qualityFromSpread(Math.max(size.spreadPct, errPct));
        const quality = guided ? worst : worst === 'good' ? 'check' : worst;
        asTaken = {
          edit: shot.edit, thumb: shot.thumb, width: img.width, height: img.height, url: shot.url, rewarped: false,
          calibration: { ...base, method: 'measure', measurements, pxPerMm: size.pxPerMm, spreadPct: size.spreadPct, quality },
          floorYmm: floorPx !== undefined ? floorPx / size.pxPerMm : undefined,
          ceilingYmm: ceilingPx !== undefined ? ceilingPx / size.pxPerMm : undefined,
          ...withTags((q) => quadBoxMm(q, size.pxPerMm), ref.kind === 'door' ? quadBoxMm(refQuad, size.pxPerMm) : undefined),
          errPct,
        };
        // Optionally also a face-on version, only when that's safe (see chooseCalibration).
        let Hmm: number[] | undefined;
        if (!guided && ref.widthMm && ref.heightMm) Hmm = await cvCall('perspective', { src: [...refQuad], dst: rectOf(ref.widthMm, ref.heightMm) });
        const choice = chooseCalibration({ guided, bothSides: !!(ref.widthMm && ref.heightMm), refQuad, w: img.width, h: img.height, Hmm });
        asTaken.sizeOnlyReason = choice.kind === 'size' ? choice.reason : undefined;
        const plan = choice.kind === 'warp' && Hmm ? planRectify(Hmm, img.width, img.height) : null;
        if (plan) {
          setStatus('Straightening the wall…');
          const copy = cloneImage(img);
          const out = await cvCall('warp', { img: copy, H: plan.H, width: plan.width, height: plan.height }, [copy.data.buffer]);
          const blob = await rgbaToBlob(out, 0.92);
          const bmp = await createImageBitmap(blob);
          const thumbBlob = (await resizeToBlob(bmp, THUMB_MAX_PX, 0.8)).blob;
          bmp.close();
          const [edit, thumb] = await Promise.all([putBlob(blob), putBlob(thumbBlob)]);
          created.current.push(edit, thumb);
          const q2 = mapQuad(plan.H, refQuad);
          const k = plan.pxPerMm;
          const floorY2 = floorPx !== undefined ? (applyH(plan.H, [0, floorPx])[1] + applyH(plan.H, [img.width, floorPx])[1]) / 2 : undefined;
          warped = {
            edit, thumb, width: plan.width, height: plan.height, url: objectUrl(blob), rewarped: true,
            calibration: {
              ...base,
              method: 'rect',
              measurements: [
                { p: q2[0], q: q2[1], lengthMm: ref.widthMm! },
                { p: q2[0], q: q2[3], lengthMm: ref.heightMm! },
              ],
              pxPerMm: k,
              homography: plan.H,
              spreadPct: 0,
              quality: errPct <= 1.5 ? 'good' : 'check',
            },
            floorYmm: floorY2 !== undefined ? floorY2 / k : undefined,
            ceilingYmm: ceilingPx !== undefined ? (applyH(plan.H, [0, ceilingPx])[1] + applyH(plan.H, [img.width, ceilingPx])[1]) / 2 / k : undefined,
            ...withTags((q) => quadBoxMm(mapQuad(plan.H, q), k), ref.kind === 'door' ? quadBoxMm(q2, k) : undefined),
            errPct,
          };
        }
      }
      const r = warped ?? asTaken;
      info(`Wall: calibrated (${r.calibration.method}, ${r.calibration.pxPerMm.toFixed(3)} px/mm, ${r.calibration.quality})${r.rewarped ? ', straightened face-on' : ''}`);
      setOptions({ asTaken, warped });
      setUseWarp(!!warped);
      if (!name) setName(nextWallName((walls ?? []).map((w) => w.name)));
      setStep('done');
    } catch (e) {
      logError('Wall: measuring failed:', e);
      setError((e as Error).message);
      setStep('size');
    }
  }

  async function save() {
    if (!shot || !result) return;
    const now = Date.now();
    const { sx, sy } = axisScales(result.calibration);
    const fullBounds = { left: 0, top: 0, right: result.width / sx, bottom: result.height / sy };
    let bounds: Wall['bounds'] = fullBounds;
    if (existing && !result.rewarped) {
      // Same photo, new scale: keep the edges the user set, in pixels.
      const old = axisScales(existing.calibration);
      const b = existing.bounds;
      bounds = { left: (b.left * old.sx) / sx, top: (b.top * old.sy) / sy, right: (b.right * old.sx) / sx, bottom: (b.bottom * old.sy) / sy };
    }
    if (result.hang) bounds = { left: result.hang.x, top: result.hang.y, right: result.hang.x + result.hang.w, bottom: result.hang.y + result.hang.h };
    const wall: Wall = {
      id: existing?.id ?? newId(),
      name: name.trim() || nextWallName((walls ?? []).map((w) => w.name)),
      room: chosenRoom.trim() || DEFAULT_ROOM,
      photo: { original: shot.original, rectified: result.edit, widthPx: result.width, heightPx: result.height },
      thumb: result.thumb,
      capture: shot.capture.kind,
      calibration: result.calibration,
      bounds,
      datums: { ceilingY: result.ceilingYmm ?? (existing && !result.rewarped ? existing.datums.ceilingY : undefined), floorY: result.floorYmm },
      keepOut: result.keepOut.length ? result.keepOut : existing?.keepOut,
      foreground: existing?.foreground ?? [],
      layouts: existing?.layouts ?? [newLayout('Layout 1')],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await saveWall(wall);
    // Blobs replaced by a re-warp are no longer used.
    const keep = new Set([wall.photo.original, wall.photo.rectified, wall.thumb]);
    const stale = [...created.current, ...(existing && result.rewarped ? [existing.photo.rectified, existing.thumb] : [])].filter(
      (b) => b && !keep.has(b) && b !== existing?.photo.original,
    );
    await deleteBlobs(stale);
    created.current = [];
    navigate(`walls/${wall.id}/edit`, { replace: true });
  }

  const title = existing ? 'Re-measure wall' : 'Add a wall';
  const back = existing ? `#/walls/${existing.id}/edit` : '#/walls';

  // ── Render ──
  if (step === 'camera')
    return (
      <GuidedCamera
        mode="wall"
        motion={motion}
        onCapture={(s) => void onGuided(s)}
        onCancel={() => setStep('photo')}
        onUseFile={() => {
          setStep('photo');
          fileRef.current?.click();
        }}
      />
    );

  if (step === 'photo' || step === 'working' || !shot) {
    return (
      <section>
        <TopBar title={title} backHref={back} />
        {step === 'working' ? (
          <WorkingPanel status={status} onCancel={() => void cancel()} />
        ) : (
          <div className="card">
            <h2>Photograph the wall</h2>
            <ul className="tips">
              <li>Stand back and face the wall. Hold the phone upright.</li>
              <li>Include something you know the size of: a door is ideal.</li>
            </ul>
            <div className="actions">
              <button className="primary" onClick={() => void openCamera()}>
                Use camera with level
              </button>
              <label className="button">
                Choose a photo
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
              </label>
            </div>
            {error && <ErrorDetails message={error} />}
          </div>
        )}
      </section>
    );
  }

  if (step === 'size') {
    const W = shot.img.width, H = shot.img.height;
    const extra: Handle[] = [];
    if (lineMode) extra.push({ id: 'line:p', at: line.p, label: 'Line start' }, { id: 'line:q', at: line.q, label: 'Line end' });
    if (floor) extra.push({ id: 'floor', at: [W * 0.12, floor.y], axis: 'y', color: '#30d158', label: 'Floor line' });
    if (ceiling) extra.push({ id: 'ceiling', at: [W * 0.12, ceiling.y], axis: 'y', color: '#ff9f0a', label: 'Ceiling line' });
    const presets = wallPresets(units);
    const tagged = items.some((it) => it.tag && it.tag.as !== 'ignore');

    return (
      <section className="wizard">
        <TopBar title={title} backHref={back} />
        <p className="step-hint">
          {lineMode ? (
            <>
              <strong>Drag the dots</strong> to the ends of something you know the length of, then type it.
            </>
          ) : (
            <>
              <strong>Tap things on the wall</strong> to say what they are. One needs a known size: a door, a frame, a switch plate.
            </>
          )}
        </p>
        <WallTagger
          image={shot.el}
          items={items}
          onItems={setItems}
          selectedId={selected}
          onSelect={setSelected}
          allowRef={!lineMode}
          extraHandles={extra}
          onExtraMove={(hid, at) => {
            if (hid === 'floor') setFloor((f) => f && { ...f, y: at[1], confirmed: true });
            else if (hid === 'ceiling') setCeiling((c) => c && { y: at[1], confirmed: true });
            else if (hid === 'line:p') setLine((l) => ({ ...l, p: at }));
            else if (hid === 'line:q') setLine((l) => ({ ...l, q: at }));
          }}
          overlay={(u) => (
            <>
              {lineMode && <line x1={line.p[0]} y1={line.p[1]} x2={line.q[0]} y2={line.q[1]} stroke="#ff3b30" strokeWidth={3 * u} />}
              {floor && (
                <>
                  <line x1={0} x2={W} y1={floor.y} y2={floor.y} stroke="#30d158" strokeWidth={3 * u} strokeDasharray={floor.confirmed ? undefined : `${10 * u} ${6 * u}`} pointerEvents="none" />
                  <text x={W * 0.12 + 26 * u} y={floor.y - 8 * u} fontSize={14 * u} className="svg-label">{floor.confirmed ? 'Floor' : 'Floor?'}</text>
                </>
              )}
              {ceiling && (
                <>
                  <line x1={0} x2={W} y1={ceiling.y} y2={ceiling.y} stroke="#ff9f0a" strokeWidth={3 * u} strokeDasharray={ceiling.confirmed ? undefined : `${10 * u} ${6 * u}`} pointerEvents="none" />
                  <text x={W * 0.12 + 26 * u} y={ceiling.y + 20 * u} fontSize={14 * u} className="svg-label">{ceiling.confirmed ? 'Ceiling' : 'Ceiling?'}</text>
                </>
              )}
            </>
          )}
          refPanel={(it) => (
            <ReferencePicker
              title="Its size"
              units={units}
              widthMm={ref?.widthMm ?? null}
              heightMm={it.widthOnly ? null : (ref?.heightMm ?? null)}
              onChange={(v) => setRefSize({ forId: it.id, widthMm: ref?.widthMm ?? null, heightMm: ref?.heightMm ?? null, ...v, kind: 'other' })}
              presets={it.widthOnly ? presets.filter((p) => p.kind === 'door') : presets}
              onPreset={(p) =>
                setRefSize(
                  it.widthOnly
                    ? { forId: it.id, widthMm: p.a, heightMm: null, kind: p.kind }
                    : { forId: it.id, ...orientPreset(it.quad, p.a, p.b), kind: p.kind },
                )
              }
              hint={
                it.widthOnly
                  ? 'The top of this doorway is out of the photo, so only its width is used.'
                  : `About ±${Math.max(1, Math.round(refErrorPct(it.quad)))}% from something this size in the photo.${refErrorPct(it.quad) > 2 ? ' A door, or floor to ceiling, would be more accurate.' : ''}`
              }
            />
          )}
        />

        <div className="panel">
          {!selected && !lineMode && !items.length && <p className="hint">Nothing outlined automatically. Draw a box around something you know, or measure a line.</p>}
          {!selected && !lineMode && items.length > 0 && !refItem && (
            <p className="hint">Tip: tap something you know the size of and choose “I know its size”. Mark a TV or windows to keep art off them, or a panel to hang art inside.</p>
          )}

          {ceiling && floor && !lineMode && (
            <div className="floor-row">
              <span>Know the floor-to-ceiling height?</span>
              {[96, 108, 120].map((inches) => (
                <button
                  key={inches}
                  className="chip-btn"
                  onClick={() => {
                    setCeiling({ ...ceiling, confirmed: true });
                    setFloor({ ...floor, confirmed: true });
                    setLine({ p: [W * 0.5, ceiling.y], q: [W * 0.5, floor.y], lengthMm: inches * 25.4 });
                    setLineMode(true);
                  }}
                >
                  {units === 'in' ? `${inches / 12} ft` : `${Math.round(inches * 2.54) / 100} m`}
                </button>
              ))}
            </div>
          )}

          {lineMode && (
            <>
              <LengthInput label="Real length of the line" unit={units} valueMm={line.lengthMm} onChange={(lengthMm) => setLine({ ...line, lengthMm })} />
              <div className="chips" aria-label="Common lengths">
                {LENGTH_PRESETS.map((p) => (
                  <button key={p.label} type="button" className="chip-btn" onClick={() => setLine({ ...line, lengthMm: p.mm })}>
                    {p.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="actions">
            <button
              onClick={() => {
                const it: TagItem = { id: newId(), quad: orderQuad(defaultQuad(W, H)) };
                setItems([...items, it]);
                setSelected(it.id);
              }}
            >
              Draw a box
            </button>
            <button className="link" onClick={() => setLineMode(!lineMode)}>
              {lineMode ? 'Use a rectangle instead' : 'Measure a line instead'}
            </button>
          </div>

          <div className="floor-row">
            {floor ? (
              floor.confirmed ? (
                <span className="muted">Floor marked. Drag the green dot to adjust.</span>
              ) : (
                <>
                  <span>Is the green line the floor?</span>
                  <button onClick={() => setFloor({ ...floor, confirmed: true })}>Yes</button>
                  <button className="link" onClick={() => setFloor(null)}>
                    No
                  </button>
                </>
              )
            ) : (
              <button className="link" onClick={() => setFloor({ y: H * 0.9, suggested: false, confirmed: true })}>
                Mark the floor (optional)
              </button>
            )}
          </div>
          {ceiling && !ceiling.confirmed && (
            <div className="floor-row">
              <span>Is the orange line the ceiling?</span>
              <button onClick={() => setCeiling({ ...ceiling, confirmed: true })}>Yes</button>
              <button className="link" onClick={() => setCeiling(null)}>
                No
              </button>
            </div>
          )}

          {error && <ErrorDetails message={error} />}
          <div className="actions">
            <button className="primary" disabled={!canContinue} onClick={() => void finish()}>
              Continue
            </button>
            <button onClick={() => void cancel()}>Cancel</button>
          </div>
          {tagged && <p className="hint">Tagged things are saved with the wall. Change them any time from “What’s on this wall”.</p>}
        </div>
      </section>
    );
  }

  // ── Done ──
  const r = result!;
  const { sx, sy } = axisScales(r.calibration);
  return (
    <section>
      <TopBar title={title} backHref={back} />
      {options?.warped && (
        <div className="seg seg-wide" role="tablist" aria-label="Photo">
          <button role="tab" aria-selected={useWarp} onClick={() => setUseWarp(true)}>
            Straightened
          </button>
          <button role="tab" aria-selected={!useWarp} onClick={() => setUseWarp(false)}>
            As taken
          </button>
        </div>
      )}
      <img className="done-photo" src={r.url} alt="Your wall" />
      <p className="quality">
        <QualityBadge quality={r.calibration.quality} pct={accuracyPct(r.calibration)} />
        <span className="muted">
          Photo covers {formatLength(r.width / sx, units)} × {formatLength(r.height / sy, units)}
          {r.rewarped ? ', straightened face-on' : ', as taken'}
        </span>
      </p>
      {r.sizeOnlyReason && r.sizeOnlyReason !== 'one-side' && <p className="hint">{SIZE_ONLY_NOTE[r.sizeOnlyReason]}</p>}
      {r.errPct !== undefined && r.errPct > 1.5 && (
        <p className="hint">Sizes are about ±{Math.round(r.errPct)}% from that small reference. A door, or floor to ceiling, would be more accurate.</p>
      )}
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="wall-name">Name</label>
          <input id="wall-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <RoomPicker rooms={rooms} value={chosenRoom} onChange={setRoom} />
        <div className="actions">
          <button type="submit" className="primary">
            {existing ? 'Save' : 'Start arranging'}
          </button>
          <button type="button" onClick={() => setStep('size')}>
            Back
          </button>
        </div>
      </form>
    </section>
  );
}

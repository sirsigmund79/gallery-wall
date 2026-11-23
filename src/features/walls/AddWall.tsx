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
import { accuracyPct, axisScales, fitCalibration } from '../../geometry/calibration.ts';
import { DEFAULT_F35_MM } from '../../geometry/gravity.ts';
import { applyH } from '../../geometry/mat3.ts';
import { orderQuad, type Quad } from '../../geometry/quad.ts';
import { formatLength } from '../../geometry/units.ts';
import { dist, type Pt } from '../../geometry/vec.ts';
import { EDIT_MAX_PX, importPhoto, resizeToBlob, THUMB_MAX_PX } from '../../media/image.ts';
import { useSettings } from '../../state/settings.ts';
import { ErrorDetails } from '../../ui/ErrorDetails.tsx';
import { LengthInput } from '../../ui/LengthInput.tsx';
import { PhotoMarkup, type Handle } from '../../ui/PhotoMarkup.tsx';
import { QualityBadge } from '../../ui/QualityBadge.tsx';
import { ReferencePicker } from '../../ui/ReferencePicker.tsx';
import { TopBar } from '../../ui/TopBar.tsx';
import { WorkingPanel } from '../../ui/WorkingPanel.tsx';
import { defaultQuad, orientPreset, rectOf } from '../scan/scanMath.ts';
import { LENGTH_PRESETS } from './presets.ts';
import { DEFAULT_ROOM, mapQuad, nextWallName, planRectify, quadBoxMm, wallPresets, type RefKind } from './wallMath.ts';

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
}

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
  const [quads, setQuads] = useState<{ id: string; quad: Quad }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [ref, setRef] = useState<Ref | null>(null);
  const [lineMode, setLineMode] = useState(false);
  const [line, setLine] = useState<{ p: Pt; q: Pt; lengthMm: Mm | null }>({ p: [0, 0], q: [0, 0], lengthMm: null });
  const [floor, setFloor] = useState<{ y: number; suggested: boolean; confirmed: boolean } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [name, setName] = useState('');
  const [room, setRoom] = useState<string | null>(null);
  const [newRoom, setNewRoom] = useState<string | null>(null);
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
  const chosenRoom = newRoom ?? room ?? existing?.room ?? walls?.[0]?.room ?? DEFAULT_ROOM;

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
      const a = cloneImage(img), b = cloneImage(img);
      const [found, floorY] = await Promise.all([cvCall('detect', { img: a }, [a.data.buffer]), cvCall('floorLine', { img: b }, [b.data.buffer])]);
      info(`Wall: found ${found.length} rectangle(s); floor ${floorY === null ? 'not found' : `at y=${Math.round(floorY)}`}`);
      setShot({ ...input, img, url, el });
      setQuads(found.map((quad) => ({ id: newId(), quad })));
      setSelected(null);
      setRef(null);
      setLineMode(found.length === 0);
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
  const refQuad = ref ? quads.find((q) => q.id === ref.quadId)?.quad : undefined;
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
      let r: Result;
      if (lineMode || !refQuad || !ref) {
        const m = { p: line.p, q: line.q, lengthMm: line.lengthMm! };
        const fit = fitCalibration([m], { guided })!;
        r = {
          edit: shot.edit, thumb: shot.thumb, width: img.width, height: img.height, url: shot.url, rewarped: false, keepOut: [],
          calibration: { ...base, method: 'measure', measurements: [m], pxPerMm: fit.pxPerMm, anisotropy: fit.anisotropy, spreadPct: fit.spreadPct, quality: fit.quality },
          floorYmm: floorPx !== undefined ? floorPx / (fit.anisotropy?.sy ?? fit.pxPerMm) : undefined,
        };
      } else if (ref.widthMm && ref.heightMm) {
        // Known rectangle: correct the angle by re-warping the photo face-on.
        const Hmm = await cvCall('perspective', { src: [...refQuad], dst: rectOf(ref.widthMm, ref.heightMm) });
        const plan = planRectify(Hmm, img.width, img.height);
        if (!plan) throw new Error('That rectangle gives an impossible angle. Check its corners and size.');
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
        r = {
          edit, thumb, width: plan.width, height: plan.height, url: objectUrl(blob), rewarped: true,
          calibration: {
            ...base,
            method: 'rect',
            measurements: [
              { p: q2[0], q: q2[1], lengthMm: ref.widthMm },
              { p: q2[0], q: q2[3], lengthMm: ref.heightMm },
            ],
            pxPerMm: k,
            homography: plan.H,
            spreadPct: 0,
            quality: 'good',
          },
          floorYmm: floorY2 !== undefined ? floorY2 / k : undefined,
          keepOut: ref.kind === 'door' ? [{ ...quadBoxMm(q2, k), label: 'Door' }] : [],
        };
      } else {
        // One side known: uniform scale from that side.
        const [tl, tr, , bl] = refQuad;
        const m = ref.widthMm ? { p: tl, q: tr, lengthMm: ref.widthMm } : { p: tl, q: bl, lengthMm: ref.heightMm! };
        const fit = fitCalibration([m], { guided })!;
        r = {
          edit: shot.edit, thumb: shot.thumb, width: img.width, height: img.height, url: shot.url, rewarped: false,
          calibration: { ...base, method: 'measure', measurements: [m], pxPerMm: fit.pxPerMm, spreadPct: fit.spreadPct, quality: fit.quality },
          floorYmm: floorPx !== undefined ? floorPx / fit.pxPerMm : undefined,
          keepOut: ref.kind === 'door' ? [{ ...quadBoxMm(refQuad, fit.pxPerMm), label: 'Door' }] : [],
        };
      }
      info(`Wall: calibrated (${r.calibration.method}, ${r.calibration.pxPerMm.toFixed(3)} px/mm, ${r.calibration.quality})${r.rewarped ? ', straightened face-on' : ''}`);
      setResult(r);
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
    let bounds = fullBounds;
    if (existing && !result.rewarped) {
      // Same photo, new scale: keep the edges the user set, in pixels.
      const old = axisScales(existing.calibration);
      const b = existing.bounds;
      bounds = { left: (b.left * old.sx) / sx, top: (b.top * old.sy) / sy, right: (b.right * old.sx) / sx, bottom: (b.bottom * old.sy) / sy };
    }
    const wall: Wall = {
      id: existing?.id ?? newId(),
      name: name.trim() || nextWallName((walls ?? []).map((w) => w.name)),
      room: chosenRoom.trim() || DEFAULT_ROOM,
      photo: { original: shot.original, rectified: result.edit, widthPx: result.width, heightPx: result.height },
      thumb: result.thumb,
      capture: shot.capture.kind,
      calibration: result.calibration,
      bounds,
      datums: { ...(existing && !result.rewarped ? { ceilingY: existing.datums.ceilingY } : {}), floorY: result.floorYmm },
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
    const sel = quads.find((q) => q.id === selected);
    const handles: Handle[] = [];
    if (lineMode) {
      handles.push({ id: 'line:p', at: line.p, label: 'Line start' }, { id: 'line:q', at: line.q, label: 'Line end' });
    } else if (sel) {
      sel.quad.forEach((p, i) => handles.push({ id: `${sel.id}:${i}`, at: p, color: '#0a84ff', label: `Corner ${i + 1}` }));
    }
    if (floor) handles.push({ id: 'floor', at: [shot.img.width * 0.15, floor.y], axis: 'y', color: '#30d158', label: 'Floor line' });
    const presets = wallPresets(units);

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
              <strong>Tap something you know the size of</strong>: a door, a window, a frame.
            </>
          )}
        </p>
        <PhotoMarkup
          image={shot.el}
          handles={handles}
          onMove={(hid, at) => {
            if (hid === 'floor') return setFloor((f) => f && { ...f, y: at[1], confirmed: true });
            if (hid === 'line:p') return setLine((l) => ({ ...l, p: at }));
            if (hid === 'line:q') return setLine((l) => ({ ...l, q: at }));
            const [qid, k] = hid.split(':');
            setQuads((qs) => qs.map((q) => (q.id === qid ? { ...q, quad: q.quad.map((p, i) => (i === Number(k) ? at : p)) as Quad } : q)));
          }}
        >
          {(u) => (
            <>
              {!lineMode &&
                quads.map((q) => {
                  const isRef = q.id === ref?.quadId, isSel = q.id === selected;
                  return (
                    <polygon
                      key={q.id}
                      points={q.quad.map((p) => p.join(',')).join(' ')}
                      fill={isSel ? '#0a84ff33' : isRef ? '#ff9f0a33' : '#ffffff22'}
                      stroke={isSel ? '#0a84ff' : isRef ? '#ff9f0a' : '#ffffff'}
                      strokeWidth={(isSel || isRef ? 3 : 2) * u}
                      strokeDasharray={isSel || isRef ? undefined : `${6 * u} ${5 * u}`}
                      style={{ cursor: 'pointer' }}
                      onPointerDown={() => setSelected(q.id)}
                    />
                  );
                })}
              {lineMode && <line x1={line.p[0]} y1={line.p[1]} x2={line.q[0]} y2={line.q[1]} stroke="#ff3b30" strokeWidth={3 * u} />}
              {floor && (
                <>
                  <line x1={0} x2={shot.img.width} y1={floor.y} y2={floor.y} stroke="#30d158" strokeWidth={3 * u} strokeDasharray={floor.confirmed ? undefined : `${10 * u} ${6 * u}`} />
                  <text x={shot.img.width * 0.15 + 26 * u} y={floor.y - 8 * u} fontSize={14 * u} className="svg-label">
                    {floor.confirmed ? 'Floor' : 'Floor?'}
                  </text>
                </>
              )}
            </>
          )}
        </PhotoMarkup>

        <div className="panel">
          {!lineMode && sel && sel.id !== ref?.quadId && (
            <div className="actions">
              <button className="primary" onClick={() => setRef({ quadId: sel.id, widthMm: null, heightMm: null, kind: 'other' })}>
                I know its size
              </button>
              <button className="link" onClick={() => setSelected(null)}>
                Done
              </button>
            </div>
          )}
          {!lineMode && ref && refQuad && (
            <ReferencePicker
              title="Its size"
              units={units}
              widthMm={ref.widthMm}
              heightMm={ref.heightMm}
              onChange={(v) => setRef({ ...ref, ...v, kind: 'other' })}
              presets={presets}
              onPreset={(p) => setRef({ ...ref, ...orientPreset(refQuad, p.a, p.b), kind: p.kind })}
              hint={
                ref.widthMm && ref.heightMm
                  ? 'Both sides: the photo’s angle will be corrected too.'
                  : 'Tip: enter both sides to also correct the photo’s angle.'
              }
            />
          )}
          {!lineMode && !quads.length && <p className="hint">No rectangles found. Draw a box around something you know, or measure a line.</p>}

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
            {!lineMode && (
              <button
                onClick={() => {
                  const q = { id: newId(), quad: orderQuad(defaultQuad(shot.img.width, shot.img.height)) };
                  setQuads([...quads, q]);
                  setSelected(q.id);
                }}
              >
                Draw a box
              </button>
            )}
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
              <button className="link" onClick={() => setFloor({ y: shot.img.height * 0.9, suggested: false, confirmed: true })}>
                Mark the floor (optional)
              </button>
            )}
          </div>

          {error && <ErrorDetails message={error} />}
          <div className="actions">
            <button className="primary" disabled={!canContinue} onClick={() => void finish()}>
              Continue
            </button>
            <button onClick={() => void cancel()}>Cancel</button>
          </div>
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
      <img className="done-photo" src={r.url} alt="Your wall" />
      <p className="quality">
        <QualityBadge quality={r.calibration.quality} pct={accuracyPct(r.calibration)} />
        <span className="muted">
          Photo covers {formatLength(r.width / sx, units)} × {formatLength(r.height / sy, units)}
          {r.rewarped ? ', straightened face-on' : ''}
        </span>
      </p>
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
        <div className="field">
          <span className="label">Room</span>
          <div className="chips" role="radiogroup" aria-label="Room">
            {rooms.map((rm) => (
              <button
                key={rm}
                type="button"
                role="radio"
                aria-checked={newRoom === null && chosenRoom === rm}
                className={`chip-btn${newRoom === null && chosenRoom === rm ? ' on' : ''}`}
                onClick={() => {
                  setRoom(rm);
                  setNewRoom(null);
                }}
              >
                {rm}
              </button>
            ))}
            <button type="button" className={`chip-btn${newRoom !== null ? ' on' : ''}`} onClick={() => setNewRoom('')}>
              + New room
            </button>
          </div>
          {newRoom !== null && (
            <input aria-label="New room name" placeholder="e.g. Living room" value={newRoom} onChange={(e) => setNewRoom(e.target.value)} autoFocus />
          )}
        </div>
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

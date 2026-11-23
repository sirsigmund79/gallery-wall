// Photograph several pieces at once → detect, measure, crop, add to the library
// (spec §5.6, §6.3a), with the gyro-guided camera (§6.1).
import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../../app/router.ts';
import { GuidedCamera, type GuidedShot } from '../../capture/GuidedCamera.tsx';
import { requestMotionPermission, type MotionPermission } from '../../capture/sensors.ts';
import { straighten } from '../../capture/straighten.ts';
import { blobToRGBA, canvasToBlob, cloneImage, cvCall, releaseCv, rgbaToBlob } from '../../cv/client.ts';
import type { RGBAImage } from '../../cv/types.ts';
import { newId } from '../../db/ids.ts';
import { putBlob, savePiece } from '../../db/repo.ts';
import type { ArtPiece, Confidence, Mm } from '../../domain/types.ts';
import { defaultHangParams, makeHangSpec } from '../../geometry/layout/hang.ts';
import type { PlaneMap, Quad } from '../../geometry/quad.ts';
import { formatLength } from '../../geometry/units.ts';
import { EDIT_MAX_PX, resizeToBlob, THUMB_MAX_PX } from '../../media/image.ts';
import { useSettings } from '../../state/settings.ts';
import { LengthInput } from '../../ui/LengthInput.tsx';
import { PhotoMarkup, type Handle } from '../../ui/PhotoMarkup.tsx';
import { TopBar } from '../../ui/TopBar.tsx';
import { calibrationNote, cropSize, defaultQuad, measureAll, orientPreset, planCalibration, type Reference } from './scanMath.ts';

type Step = 'start' | 'camera' | 'working' | 'review' | 'results';

interface Photo {
  img: RGBAImage;
  url: string;
  el: HTMLImageElement;
  straightened: boolean;
}

interface QItem {
  id: string;
  quad: Quad;
}

interface Result {
  id: string;
  include: boolean;
  name: string;
  widthMm: Mm | null;
  heightMm: Mm | null;
  measuredW: Mm;
  measuredH: Mm;
  confidence: Confidence;
  edgeDiffPct: number;
  suggestion: { label: string; widthMm: Mm; heightMm: Mm } | null;
  crop: Blob;
  cropUrl: string;
  /** True once the user typed a size of their own. */
  typed: boolean;
}

/** Reference presets: things people often have to hand. */
const REF_PRESETS: { label: string; a: Mm; b: Mm }[] = [
  { label: 'US Letter sheet', a: 215.9, b: 279.4 },
  { label: 'A4 sheet', a: 210, b: 297 },
  { label: 'Credit card', a: 53.98, b: 85.6 },
];

const CONF_TEXT: Record<Confidence, string> = { high: 'Measured', check: 'Check size', low: 'Low confidence' };

function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Could not display photo'));
    i.src = url;
  });
}

async function rotateBlob90(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.height;
  c.height = bmp.width;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return canvasToBlob(c, 0.9);
}

export function ScanArt() {
  const units = useSettings((s) => s.units);
  const [step, setStep] = useState<Step>('start');
  const [motion, setMotion] = useState<MotionPermission>('unavailable');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string>();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [quads, setQuads] = useState<QItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [ref, setRef] = useState<Reference | null>(null);
  const [refNotArt, setRefNotArt] = useState(false);
  const [persp, setPersp] = useState<{ key: string; H: number[] } | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Free the worker and object URLs when leaving.
  const urls = useRef<string[]>([]);
  useEffect(
    () => () => {
      releaseCv();
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );
  const track = (u: string) => (urls.current.push(u), u);

  // ── Calibration (pixels → mm) from the reference ──
  const refQuad = ref ? quads.find((q) => q.id === ref.quadId)?.quad : undefined;
  const plan = useMemo(() => (ref && refQuad && photo ? planCalibration(refQuad, ref, photo.straightened) : null), [ref, refQuad, photo]);
  const perspKey = plan?.kind === 'perspective' ? JSON.stringify([plan.src, plan.dst]) : '';
  useEffect(() => {
    if (plan?.kind !== 'perspective') return;
    let alive = true;
    void cvCall('perspective', { src: plan.src, dst: plan.dst }).then((H) => alive && setPersp({ key: perspKey, H }));
    return () => {
      alive = false;
    };
  }, [perspKey, plan]);
  const plane: PlaneMap | null = useMemo(
    () =>
      !plan
        ? null
        : plan.kind === 'scale'
          ? { kind: 'scale', pxPerMm: plan.pxPerMm }
          : plan.kind === 'similarity'
            ? { kind: 'homography', H: plan.H }
            : persp?.key === perspKey
              ? { kind: 'homography', H: persp.H }
              : null,
    [plan, persp, perspKey],
  );
  const measured = useMemo(() => (plane ? measureAll(quads.map((q) => q.quad), plane) : null), [plane, quads]);

  // ── Photo intake ──
  async function process(get: () => Promise<{ img: RGBAImage; blob: Blob; straightened: boolean }>) {
    setStep('working');
    setError(undefined);
    try {
      setStatus('Preparing photo…');
      const { img, blob, straightened } = await get();
      const url = track(URL.createObjectURL(blob));
      const el = await loadImageEl(url);
      setStatus('Finding your art… The first time, this also downloads the measuring tools (about 3.5 MB).');
      const copy = cloneImage(img);
      const found = await cvCall('detect', { img: copy }, [copy.data.buffer]);
      setPhoto({ img, url, el, straightened });
      const items = found.map((quad) => ({ id: newId(), quad }));
      setQuads(items);
      setSelected(null);
      setRef(null);
      setStep('review');
    } catch (e) {
      setError(`Something went wrong: ${(e as Error).message}. Try another photo.`);
      setStep('start');
    }
  }

  const fromShot = (shot: GuidedShot) =>
    process(async () => {
      const s = await straighten(shot.blob, shot.gravity?.g ?? null, 'floor');
      return { img: s.img, blob: s.blob, straightened: s.corrected };
    });

  const fromFile = (file: File | undefined) =>
    file &&
    process(async () => {
      const img = await blobToRGBA(file, EDIT_MAX_PX);
      return { img, blob: await rgbaToBlob(img, 0.92), straightened: false };
    });

  async function openCamera() {
    // iOS: the permission request must be the first thing in the tap handler.
    const m = await requestMotionPermission();
    setMotion(m);
    setStep('camera');
  }

  // ── Results ──
  async function toResults() {
    if (!photo || !measured) return;
    setStep('working');
    setStatus('Cropping and straightening each piece…');
    try {
      const keep = quads.map((q, i) => ({ q, m: measured[i]! })).filter(({ q }) => !(refNotArt && q.id === ref?.quadId));
      const items = keep.map(({ q, m }) => ({ quad: q.quad, ...cropSize(m.widthMm, m.heightMm, q.quad) }));
      const copy = cloneImage(photo.img);
      const crops = await cvCall('crops', { img: copy, items }, [copy.data.buffer]);
      const rs: Result[] = [];
      for (const [i, { q, m }] of keep.entries()) {
        const crop = await rgbaToBlob(crops[i]!, 0.9);
        rs.push({
          id: q.id,
          include: true,
          name: `Piece ${i + 1}`,
          widthMm: m.widthMm,
          heightMm: m.heightMm,
          measuredW: m.widthMm,
          measuredH: m.heightMm,
          confidence: m.confidence,
          edgeDiffPct: m.edgeDiffPct,
          suggestion: m.suggestion,
          crop,
          cropUrl: track(URL.createObjectURL(crop)),
          typed: false,
        });
      }
      setResults(rs);
      setStep('results');
    } catch (e) {
      setError(`Could not crop the pieces: ${(e as Error).message}`);
      setStep('review');
    }
  }

  const updateResult = (id: string, patch: Partial<Result>) => setResults((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function rotate(r: Result) {
    const crop = await rotateBlob90(r.crop);
    updateResult(r.id, {
      crop,
      cropUrl: track(URL.createObjectURL(crop)),
      widthMm: r.heightMm,
      heightMm: r.widthMm,
      measuredW: r.measuredH,
      measuredH: r.measuredW,
      suggestion: r.suggestion && { label: r.suggestion.label, widthMm: r.suggestion.heightMm, heightMm: r.suggestion.widthMm },
    });
  }

  async function saveAll() {
    setSaving(true);
    try {
      const now = Date.now();
      for (const r of results) {
        if (!r.include || !r.widthMm || !r.heightMm) continue;
        const image = await putBlob(r.crop);
        const bmp = await createImageBitmap(r.crop);
        const thumb = await putBlob((await resizeToBlob(bmp, THUMB_MAX_PX, 0.8)).blob);
        bmp.close();
        const piece: ArtPiece = {
          id: newId(),
          name: r.name.trim() || 'Untitled',
          widthMm: r.widthMm,
          heightMm: r.heightMm,
          shape: 'rect',
          image,
          thumb,
          hang: makeHangSpec('wire', r.widthMm, defaultHangParams('wire')),
          status: 'owned',
          tags: [],
          notes: '',
          measurement: r.typed ? { method: 'manual', confidence: 'high' } : { method: 'photo', confidence: r.confidence, spreadPct: r.edgeDiffPct },
          createdAt: now,
          updatedAt: now,
        };
        await savePiece(piece);
      }
      navigate('art');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ──
  if (step === 'camera') {
    return (
      <GuidedCamera
        mode="floor"
        motion={motion}
        onCapture={(s) => void fromShot(s)}
        onCancel={() => setStep('start')}
        onUseFile={() => {
          setStep('start');
          fileRef.current?.click();
        }}
      />
    );
  }

  if (step === 'start' || step === 'working') {
    return (
      <section>
        <TopBar title="Scan art" backHref="#/art" />
        {step === 'working' ? (
          <div className="card center" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <p>{status}</p>
          </div>
        ) : (
          <div className="card">
            <h2>Photograph several pieces at once</h2>
            <ul className="tips">
              <li>Lay the art flat on the floor, with a little floor showing between pieces.</li>
              <li>A plain floor that contrasts with the frames works best.</li>
              <li>Include one piece you know the size of, or a sheet of paper or a credit card.</li>
              <li>Hold the phone flat above them. The level guide shows when it’s straight.</li>
            </ul>
            <div className="actions">
              <button className="primary" onClick={() => void openCamera()}>
                Use camera with level
              </button>
              <label className="button">
                Choose a photo
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void fromFile(e.target.files?.[0])} />
              </label>
            </div>
            {error && <p className="error">{error}</p>}
          </div>
        )}
      </section>
    );
  }

  if (step === 'review' && photo) {
    const sel = quads.find((q) => q.id === selected);
    const handles: Handle[] = sel ? sel.quad.map((p, i) => ({ id: `${sel.id}:${i}`, at: p, color: '#0a84ff', label: `Corner ${i + 1}` })) : [];
    const note = plan ? calibrationNote(plan, photo.straightened) : null;
    const refIndex = ref ? quads.findIndex((q) => q.id === ref.quadId) : -1;
    const artCount = quads.length - (refNotArt && ref ? 1 : 0);

    return (
      <section className="wizard">
        <TopBar title="Scan art" backHref="#/art" />
        <p className="step-hint">
          {quads.length ? (
            <>
              Found <strong>{quads.length}</strong> {quads.length === 1 ? 'shape' : 'shapes'}. Tap one to fix its corners.
            </>
          ) : (
            'No pieces found automatically. Add them by hand below.'
          )}
          {photo.straightened && <span className="muted"> Straightened with the level sensor.</span>}
        </p>
        <PhotoMarkup
          image={photo.el}
          handles={handles}
          onMove={(hid, at) => {
            const [qid, k] = hid.split(':');
            setQuads((qs) => qs.map((q) => (q.id === qid ? { ...q, quad: q.quad.map((p, i) => (i === Number(k) ? at : p)) as Quad } : q)));
          }}
        >
          {(u) =>
            quads.map((q, i) => {
              const isRef = q.id === ref?.quadId;
              const isSel = q.id === selected;
              const m = measured?.[i];
              const c = q.quad.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
              return (
                <g key={q.id} onPointerDown={() => setSelected(q.id)} style={{ cursor: 'pointer' }}>
                  <polygon
                    points={q.quad.map((p) => p.join(',')).join(' ')}
                    fill={isSel ? '#0a84ff33' : isRef ? '#ff9f0a33' : '#30d15822'}
                    stroke={isSel ? '#0a84ff' : isRef ? '#ff9f0a' : '#30d158'}
                    strokeWidth={(isSel ? 3 : 2) * u}
                  />
                  <text x={c[0]} y={c[1]} fontSize={15 * u} textAnchor="middle" className="svg-label">
                    {isRef ? '★ ' : ''}#{i + 1}
                  </text>
                  {m && (
                    <text x={c[0]} y={c[1] + 18 * u} fontSize={13 * u} textAnchor="middle" className="svg-label">
                      {formatLength(m.widthMm, units)} × {formatLength(m.heightMm, units)}
                    </text>
                  )}
                </g>
              );
            })
          }
        </PhotoMarkup>

        <div className="panel">
          {sel && (
            <div className="actions">
              <strong className="sel-label">#{quads.indexOf(sel) + 1}</strong>
              {sel.id !== ref?.quadId && (
                <button className="primary" onClick={() => setRef({ quadId: sel.id, widthMm: null, heightMm: null })}>
                  I know this one’s size
                </button>
              )}
              <button
                className="danger"
                onClick={() => {
                  setQuads(quads.filter((q) => q.id !== sel.id));
                  if (ref?.quadId === sel.id) setRef(null);
                  setSelected(null);
                }}
              >
                Not a piece
              </button>
              <button className="link" onClick={() => setSelected(null)}>
                Done
              </button>
            </div>
          )}
          <div className="actions">
            <button
              onClick={() => {
                const q = { id: newId(), quad: defaultQuad(photo.img.width, photo.img.height) };
                setQuads([...quads, q]);
                setSelected(q.id);
              }}
            >
              Add a missing piece
            </button>
          </div>

          {ref && refQuad ? (
            <fieldset className="card">
              <legend>★ Size reference: #{refIndex + 1}</legend>
              <div className="row2">
                <LengthInput label="Width (across)" unit={units} valueMm={ref.widthMm} onChange={(widthMm) => setRef({ ...ref, widthMm })} />
                <LengthInput label="Height (up-down)" unit={units} valueMm={ref.heightMm} onChange={(heightMm) => setRef({ ...ref, heightMm })} />
              </div>
              <div className="chips" aria-label="Common references">
                {REF_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="chip-btn"
                    onClick={() => {
                      setRef({ ...ref, ...orientPreset(refQuad, p.a, p.b) });
                      setRefNotArt(true);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <label className="check-row">
                <input type="checkbox" checked={refNotArt} onChange={(e) => setRefNotArt(e.target.checked)} />
                It’s only a reference (don’t add it to my art)
              </label>
              <p className="hint">
                {photo.straightened
                  ? 'One side is enough. Both sides is slightly better.'
                  : 'Enter both sides for the best accuracy, and use the biggest piece you know.'}
              </p>
            </fieldset>
          ) : (
            quads.length > 0 && (
              <p className="hint">
                <strong>Next:</strong> tap a piece you know the size of (or a sheet of paper or a credit card in the photo), then “I know this one’s size”.
              </p>
            )
          )}

          {note && (
            <p className="quality">
              <span className={`badge q-${note.quality}`}>{note.quality === 'good' ? '✓ Good' : '! Check'}</span>
              <span className="muted">{note.text}</span>
            </p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button className="primary" disabled={!measured || artCount === 0} onClick={() => void toResults()}>
              {artCount > 0 ? `Measure ${artCount} piece${artCount === 1 ? '' : 's'}` : 'Measure'}
            </button>
            <button onClick={() => setStep('start')}>Retake</button>
          </div>
        </div>
      </section>
    );
  }

  // ── Results ──
  const count = results.filter((r) => r.include && r.widthMm && r.heightMm).length;
  return (
    <section>
      <TopBar title="Check sizes" backHref="#/art" />
      <p className="muted">Check each size against a tape measure if you can. Tap a suggested standard size to use it.</p>
      <ul className="results">
        {results.map((r) => (
          <li key={r.id} className={`result card${r.include ? '' : ' excluded'}`}>
            <div className="result-top">
              <img src={r.cropUrl} alt={r.name} className="result-img" />
              <div className="result-meta">
                <label className="check-row">
                  <input type="checkbox" checked={r.include} onChange={(e) => updateResult(r.id, { include: e.target.checked })} />
                  Add to library
                </label>
                <span className={`badge conf-${r.typed ? 'high' : r.confidence}`}>{r.typed ? 'Typed by you' : CONF_TEXT[r.confidence]}</span>
                <button onClick={() => void rotate(r)}>Rotate 90°</button>
              </div>
            </div>
            <div className="field">
              <label htmlFor={`n-${r.id}`}>Name</label>
              <input id={`n-${r.id}`} value={r.name} onChange={(e) => updateResult(r.id, { name: e.target.value })} />
            </div>
            <div className="row2">
              <LengthInput label="Width" unit={units} valueMm={r.widthMm} onChange={(widthMm) => updateResult(r.id, { widthMm, typed: true })} />
              <LengthInput label="Height" unit={units} valueMm={r.heightMm} onChange={(heightMm) => updateResult(r.id, { heightMm, typed: true })} />
            </div>
            <p className="hint">
              Measured {formatLength(r.measuredW, units)} × {formatLength(r.measuredH, units)}
              {r.suggestion && (
                <>
                  {' · '}
                  <button
                    className="chip-btn"
                    onClick={() => updateResult(r.id, { widthMm: r.suggestion!.widthMm, heightMm: r.suggestion!.heightMm, typed: false })}
                  >
                    Use {r.suggestion.label}
                  </button>
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button className="primary" disabled={!count || saving} onClick={() => void saveAll()}>
          {saving ? 'Saving…' : `Add ${count} piece${count === 1 ? '' : 's'} to library`}
        </button>
        <button onClick={() => setStep('review')}>Back</button>
      </div>
    </section>
  );
}

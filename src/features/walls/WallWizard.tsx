import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../../app/router.ts';
import { newId } from '../../db/ids.ts';
import { deleteBlobs, getWall, newLayout, putBlob, saveWall } from '../../db/repo.ts';
import type { CalibrationRecord, Mm, Wall } from '../../domain/types.ts';
import { accuracyPct, axisScales, fitCalibration, type CalibrationFit } from '../../geometry/calibration.ts';
import { formatLength } from '../../geometry/units.ts';
import { dist, type Pt } from '../../geometry/vec.ts';
import { importPhoto } from '../../media/image.ts';
import { useBlobImage } from '../../media/useBlobUrl.ts';
import { useSettings } from '../../state/settings.ts';
import { LengthInput } from '../../ui/LengthInput.tsx';
import { PhotoMarkup, type Handle } from '../../ui/PhotoMarkup.tsx';
import { QualityBadge } from '../../ui/QualityBadge.tsx';
import { TopBar } from '../../ui/TopBar.tsx';
import { LENGTH_PRESETS } from './presets.ts';

type Step = 'photo' | 'measure' | 'bounds' | 'name';

interface MLine {
  id: string;
  p: Pt;
  q: Pt;
  lengthMm: Mm | null;
}

interface PhotoRefs {
  original: string;
  edit: string;
  thumb: string;
  w: number;
  h: number;
}

interface BoundsPx {
  left: number;
  top: number;
  right: number;
  bottom: number;
  floorY?: number;
  ceilingY?: number;
}

const COLORS = ['#ff3b30', '#0a84ff', '#30d158', '#ff9f0a', '#bf5af2'];

function defaultLine(w: number, h: number, index: number): MLine {
  // First line across, second up-down, then diagonals: one per axis is the most useful.
  const id = newId();
  if (index % 2 === 0) return { id, p: [w * 0.25, h * (0.5 + index * 0.05)], q: [w * 0.75, h * (0.5 + index * 0.05)], lengthMm: null };
  return { id, p: [w * (0.5 + index * 0.05), h * 0.25], q: [w * (0.5 + index * 0.05), h * 0.75], lengthMm: null };
}

export function WallWizard({ wallId }: { wallId?: string }) {
  const units = useSettings((s) => s.units);
  const [existing, setExisting] = useState<Wall | null>(null);
  const [step, setStep] = useState<Step>(wallId ? 'measure' : 'photo');
  const [photo, setPhoto] = useState<PhotoRefs | null>(null);
  const [lines, setLines] = useState<MLine[]>([]);
  const [active, setActive] = useState<string>();
  const [bounds, setBounds] = useState<BoundsPx | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const image = useBlobImage(photo?.edit);

  // Editing calibration of an existing wall: load its state in image px.
  useEffect(() => {
    if (!wallId) return;
    void getWall(wallId).then((w) => {
      if (!w) return navigate('walls', { replace: true });
      setExisting(w);
      const { sx, sy } = axisScales(w.calibration);
      setPhoto({ original: w.photo.original, edit: w.photo.rectified, thumb: w.thumb ?? w.photo.rectified, w: w.photo.widthPx, h: w.photo.heightPx });
      const ls = w.calibration.measurements.map((m) => ({ id: newId(), p: m.p, q: m.q, lengthMm: m.lengthMm }));
      setLines(ls);
      setActive(ls[0]?.id);
      setBounds({
        left: w.bounds.left * sx,
        right: w.bounds.right * sx,
        top: w.bounds.top * sy,
        bottom: w.bounds.bottom * sy,
        floorY: w.datums.floorY !== undefined ? w.datums.floorY * sy : undefined,
        ceilingY: w.datums.ceilingY !== undefined ? w.datums.ceilingY * sy : undefined,
      });
      setName(w.name);
    });
  }, [wallId]);

  const fit: CalibrationFit | null = useMemo(
    () =>
      fitCalibration(
        lines.filter((l) => l.lengthMm).map((l) => ({ p: l.p, q: l.q, lengthMm: l.lengthMm! })),
        { guided: existing?.capture === 'guided' },
      ),
    [lines, existing],
  );

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const ph = await importPhoto(file);
      const [original, edit, thumb] = await Promise.all([putBlob(ph.original.blob), putBlob(ph.edit.blob), putBlob(ph.thumb.blob)]);
      if (photo && !existing) await deleteBlobs([photo.original, photo.edit, photo.thumb]);
      const w = ph.edit.width;
      const h = ph.edit.height;
      setPhoto({ original, edit, thumb, w, h });
      const first = defaultLine(w, h, 0);
      setLines([first]);
      setActive(first.id);
      setBounds({ left: 0, top: 0, right: w, bottom: h });
      setStep('measure');
    } catch {
      setError('That photo could not be read. Try a JPEG or PNG.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (photo && !existing) await deleteBlobs([photo.original, photo.edit, photo.thumb]);
    navigate(existing ? `walls/${existing.id}` : 'walls');
  }

  async function save() {
    if (!photo || !fit || !bounds) return;
    const { sx, sy } = fit.anisotropy ?? { sx: fit.pxPerMm, sy: fit.pxPerMm };
    const calibration: CalibrationRecord = {
      method: fit.anisotropy ? 'measure2axis' : 'measure',
      measurements: lines.filter((l) => l.lengthMm).map((l) => ({ p: l.p, q: l.q, lengthMm: l.lengthMm! })),
      pxPerMm: fit.pxPerMm,
      anisotropy: fit.anisotropy,
      spreadPct: fit.spreadPct,
      quality: fit.quality,
    };
    const now = Date.now();
    const wall: Wall = {
      id: existing?.id ?? newId(),
      name: name.trim() || 'My wall',
      photo: existing?.photo ?? { original: photo.original, rectified: photo.edit, widthPx: photo.w, heightPx: photo.h },
      thumb: existing?.thumb ?? photo.thumb,
      capture: existing?.capture ?? 'import',
      calibration,
      bounds: { left: bounds.left / sx, top: bounds.top / sy, right: bounds.right / sx, bottom: bounds.bottom / sy },
      datums: {
        floorY: bounds.floorY !== undefined ? bounds.floorY / sy : undefined,
        ceilingY: bounds.ceilingY !== undefined ? bounds.ceilingY / sy : undefined,
      },
      foreground: existing?.foreground ?? [],
      layouts: existing?.layouts ?? [newLayout('Layout 1')],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await saveWall(wall);
    navigate(`walls/${wall.id}`, { replace: true });
  }

  const title = existing ? 'Edit calibration' : 'Add a wall';
  const back = existing ? `#/walls/${existing.id}` : '#/walls';

  // ── Step: photo ──
  if (step === 'photo') {
    return (
      <section>
        <TopBar title={title} backHref={back} />
        <div className="card">
          <h2>1. Photograph the wall</h2>
          <ul className="tips">
            <li>Stand back and face the wall straight on.</li>
            <li>Hold the phone upright and level. Use the normal 1× camera, not ultra-wide.</li>
            <li>Include something you can measure: the wall’s width, a door frame, or a sheet of paper taped up.</li>
          </ul>
          <div className="actions">
            <label className="button primary">
              Take photo
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
            <label className="button">
              Choose from library
              <input type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
          </div>
          {busy && <p className="muted">Processing photo…</p>}
          {error && <p className="error">{error}</p>}
        </div>
      </section>
    );
  }

  if (!photo || !image || !bounds) return <p className="muted center">Loading photo…</p>;

  // ── Step: measure ──
  if (step === 'measure') {
    const act = lines.find((l) => l.id === active) ?? lines[0];
    const handles: Handle[] = lines.flatMap((l, i) => [
      { id: `${l.id}:p`, at: l.p, color: COLORS[i % COLORS.length], label: `Measurement ${i + 1} start` },
      { id: `${l.id}:q`, at: l.q, color: COLORS[i % COLORS.length], label: `Measurement ${i + 1} end` },
    ]);
    const update = (id: string, patch: Partial<MLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const actIndex = act ? lines.indexOf(act) : 0;

    return (
      <section className="wizard">
        <TopBar title={title} backHref={back} />
        <p className="step-hint">
          <strong>2. Measure.</strong> Drag the dots to the ends of something you know the length of, then type that length.
        </p>
        <PhotoMarkup
          image={image}
          handles={handles}
          onActivate={(hid) => setActive(hid.split(':')[0])}
          onMove={(hid, at) => {
            const [id, end] = hid.split(':');
            update(id!, end === 'p' ? { p: at } : { q: at });
          }}
        >
          {(u) =>
            lines.map((l, i) => {
              const c = COLORS[i % COLORS.length];
              const mid: Pt = [(l.p[0] + l.q[0]) / 2, (l.p[1] + l.q[1]) / 2];
              return (
                <g key={l.id} onPointerDown={() => setActive(l.id)}>
                  <line x1={l.p[0]} y1={l.p[1]} x2={l.q[0]} y2={l.q[1]} stroke="#000" strokeOpacity={0.5} strokeWidth={5 * u} />
                  <line
                    x1={l.p[0]} y1={l.p[1]} x2={l.q[0]} y2={l.q[1]}
                    stroke={c} strokeWidth={(l.id === act?.id ? 3 : 2) * u}
                    strokeDasharray={l.lengthMm ? undefined : `${8 * u} ${6 * u}`}
                  />
                  <text x={mid[0]} y={mid[1] - 10 * u} fontSize={14 * u} className="svg-label" textAnchor="middle">
                    {l.lengthMm ? formatLength(l.lengthMm, units) : `#${i + 1}`}
                  </text>
                </g>
              );
            })
          }
        </PhotoMarkup>

        <div className="panel">
          {lines.length > 1 && (
            <div className="seg" role="tablist" aria-label="Measurements">
              {lines.map((l, i) => (
                <button key={l.id} role="tab" aria-selected={l.id === act?.id} onClick={() => setActive(l.id)} style={{ borderColor: COLORS[i % COLORS.length] }}>
                  #{i + 1}
                </button>
              ))}
            </div>
          )}
          {act && (
            <>
              <LengthInput
                key={act.id}
                label={`Real length of line #${actIndex + 1}`}
                unit={units}
                valueMm={act.lengthMm}
                onChange={(lengthMm) => update(act.id, { lengthMm })}
              />
              <div className="chips" aria-label="Common lengths">
                {LENGTH_PRESETS.map((pr) => (
                  <button key={pr.label} type="button" className="chip-btn" onClick={() => update(act.id, { lengthMm: pr.mm })}>
                    {pr.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {fit && (
            <div className="quality">
              <QualityBadge quality={fit.quality} pct={accuracyPct(fit)} />
              <span className="muted">
                Photo is {formatLength(photo.w / (fit.anisotropy?.sx ?? fit.pxPerMm), units)} ×{' '}
                {formatLength(photo.h / (fit.anisotropy?.sy ?? fit.pxPerMm), units)}
              </span>
              {fit.advice && <p className="hint">{fit.advice}</p>}
            </div>
          )}

          <div className="actions">
            <button
              type="button"
              onClick={() => {
                const l = defaultLine(photo.w, photo.h, lines.length);
                setLines([...lines, l]);
                setActive(l.id);
              }}
            >
              Add measurement
            </button>
            {lines.length > 1 && act && (
              <button
                type="button"
                onClick={() => {
                  const rest = lines.filter((l) => l.id !== act.id);
                  setLines(rest);
                  setActive(rest[0]?.id);
                }}
              >
                Remove #{actIndex + 1}
              </button>
            )}
          </div>
          {existing && existing.layouts.some((l) => l.placements.length) && (
            <p className="hint">Pieces keep their real positions; the photo rescales underneath them.</p>
          )}
          <div className="actions">
            <button className="primary" disabled={!fit} onClick={() => setStep('bounds')}>
              Next
            </button>
            <button type="button" onClick={() => void cancel()}>
              Cancel
            </button>
          </div>
          {act && act.lengthMm && dist(act.p, act.q) < 20 && <p className="error">That line is very short; drag the dots further apart.</p>}
        </div>
      </section>
    );
  }

  // ── Step: bounds and datums ──
  if (step === 'bounds') {
    const midX = (bounds.left + bounds.right) / 2;
    const midY = (bounds.top + bounds.bottom) / 2;
    const handles: Handle[] = [
      { id: 'left', at: [bounds.left, midY], axis: 'x', label: 'Left edge of wall', color: '#0a84ff' },
      { id: 'right', at: [bounds.right, midY], axis: 'x', label: 'Right edge of wall', color: '#0a84ff' },
      { id: 'top', at: [midX, bounds.top], axis: 'y', label: 'Top edge of wall area', color: '#0a84ff' },
      { id: 'bottom', at: [midX, bounds.bottom], axis: 'y', label: 'Bottom edge of wall area', color: '#0a84ff' },
    ];
    if (bounds.floorY !== undefined) handles.push({ id: 'floorY', at: [bounds.left + (bounds.right - bounds.left) * 0.3, bounds.floorY], axis: 'y', label: 'Floor line', color: '#30d158' });
    if (bounds.ceilingY !== undefined) handles.push({ id: 'ceilingY', at: [bounds.left + (bounds.right - bounds.left) * 0.3, bounds.ceilingY], axis: 'y', label: 'Ceiling line', color: '#ff9f0a' });
    const sx = fit!.anisotropy?.sx ?? fit!.pxPerMm;
    const sy = fit!.anisotropy?.sy ?? fit!.pxPerMm;

    return (
      <section className="wizard">
        <TopBar title={title} backHref={back} />
        <p className="step-hint">
          <strong>3. Wall edges.</strong> Drag the blue dots to the edges of the usable wall. Marking the floor lets you measure nail heights from it.
        </p>
        <PhotoMarkup
          image={image}
          handles={handles}
          onMove={(id, at) => {
            setBounds((b) => {
              if (!b) return b;
              const v = id === 'left' || id === 'right' ? at[0] : at[1];
              const n = { ...b, [id]: v };
              // Keep edges ordered.
              if (n.left > n.right - 10) return b;
              if (n.top > n.bottom - 10) return b;
              return n;
            });
          }}
        >
          {(u) => (
            <>
              <path
                d={`M0 0H${photo.w}V${photo.h}H0Z M${bounds.left} ${bounds.top}V${bounds.bottom}H${bounds.right}V${bounds.top}Z`}
                fill="#000" fillOpacity={0.45} fillRule="evenodd"
              />
              <rect x={bounds.left} y={bounds.top} width={bounds.right - bounds.left} height={bounds.bottom - bounds.top} fill="none" stroke="#0a84ff" strokeWidth={2 * u} />
              {bounds.floorY !== undefined && (
                <>
                  <line x1={0} x2={photo.w} y1={bounds.floorY} y2={bounds.floorY} stroke="#30d158" strokeWidth={2.5 * u} />
                  <text x={bounds.left + 30 * u} y={bounds.floorY - 8 * u} fontSize={14 * u} className="svg-label">Floor</text>
                </>
              )}
              {bounds.ceilingY !== undefined && (
                <>
                  <line x1={0} x2={photo.w} y1={bounds.ceilingY} y2={bounds.ceilingY} stroke="#ff9f0a" strokeWidth={2.5 * u} />
                  <text x={bounds.left + 30 * u} y={bounds.ceilingY + 18 * u} fontSize={14 * u} className="svg-label">Ceiling</text>
                </>
              )}
            </>
          )}
        </PhotoMarkup>
        <div className="panel">
          <p className="muted">
            Wall area: {formatLength((bounds.right - bounds.left) / sx, units)} × {formatLength((bounds.bottom - bounds.top) / sy, units)}
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={bounds.floorY !== undefined}
              onChange={(e) => setBounds({ ...bounds, floorY: e.target.checked ? bounds.bottom : undefined })}
            />
            Mark the floor line
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={bounds.ceilingY !== undefined}
              onChange={(e) => setBounds({ ...bounds, ceilingY: e.target.checked ? bounds.top : undefined })}
            />
            Mark the ceiling line
          </label>
          <div className="actions">
            <button className="primary" onClick={() => setStep('name')}>
              Next
            </button>
            <button onClick={() => setStep('measure')}>Back</button>
          </div>
        </div>
      </section>
    );
  }

  // ── Step: name ──
  return (
    <section>
      <TopBar title={title} backHref={back} />
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="wall-name">4. Name this wall</label>
          <input id="wall-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Living room, above sofa" autoFocus />
        </div>
        {fit && (
          <p>
            <QualityBadge quality={fit.quality} pct={accuracyPct(fit)} />
          </p>
        )}
        <div className="actions">
          <button type="submit" className="primary">
            {existing ? 'Save calibration' : 'Save and start arranging'}
          </button>
          <button type="button" onClick={() => setStep('bounds')}>
            Back
          </button>
        </div>
      </form>
    </section>
  );
}

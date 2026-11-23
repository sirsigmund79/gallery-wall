import { useEffect, useState } from 'react';
import { navigate } from '../../app/router.ts';
import { newId } from '../../db/ids.ts';
import { deleteBlobs, deletePiece, getBlob, getPiece, layoutsUsingPiece, putBlob, savePiece } from '../../db/repo.ts';
import type { ArtPiece, HangType, Mm, PieceStatus } from '../../domain/types.ts';
import { defaultHangParams, hangParamsOf, makeHangSpec, type HangParams } from '../../geometry/layout/hang.ts';
import { useSettings } from '../../state/settings.ts';
import { LengthInput } from '../../ui/LengthInput.tsx';
import { Thumb } from '../../ui/Thumb.tsx';
import { TopBar } from '../../ui/TopBar.tsx';
import { importPhoto } from '../../media/image.ts';
import { HANG_LABEL, HANG_TYPES, STATUSES, STATUS_LABEL } from './constants.ts';

interface Draft {
  name: string;
  widthMm: Mm | null;
  heightMm: Mm | null;
  hangType: HangType;
  hang: HangParams;
  status: PieceStatus;
  tags: string;
  notes: string;
  image?: string;
  thumb?: string;
}

const emptyDraft = (): Draft => ({
  name: '',
  widthMm: null,
  heightMm: null,
  hangType: 'wire',
  hang: defaultHangParams('wire'),
  status: 'owned',
  tags: '',
  notes: '',
});

const toDraft = (p: ArtPiece): Draft => ({
  name: p.name,
  widthMm: p.widthMm,
  heightMm: p.heightMm,
  hangType: p.hang.type,
  hang: hangParamsOf(p.hang),
  status: p.status,
  tags: p.tags.join(', '),
  notes: p.notes,
  image: p.image,
  thumb: p.thumb,
});

export function PieceEditor({ id }: { id: string | 'new' }) {
  const units = useSettings((s) => s.units);
  const [existing, setExisting] = useState<ArtPiece | null>(null);
  const [d, setD] = useState<Draft | null>(id === 'new' ? emptyDraft() : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [newBlobs, setNewBlobs] = useState<string[]>([]);

  useEffect(() => {
    if (id === 'new') return;
    void getPiece(id).then((p) => {
      if (!p) return navigate('art', { replace: true });
      setExisting(p);
      setD(toDraft(p));
    });
  }, [id]);

  if (!d) return null;
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });

  const valid = d.name.trim() && d.widthMm && d.widthMm > 0 && d.heightMm && d.heightMm > 0;

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const ph = await importPhoto(file);
      const image = await putBlob(ph.edit.blob);
      const thumb = await putBlob(ph.thumb.blob);
      setNewBlobs((b) => [...b, image, thumb]);
      setD((cur) => cur && { ...cur, image, thumb });
    } catch {
      setError('That photo could not be read. Try a JPEG or PNG.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!valid || !d) return;
    const now = Date.now();
    const widthMm = d.widthMm!;
    const piece: ArtPiece = {
      id: existing?.id ?? newId(),
      name: d.name.trim(),
      widthMm,
      heightMm: d.heightMm!,
      shape: 'rect',
      image: d.image,
      thumb: d.thumb,
      hang: makeHangSpec(d.hangType, widthMm, d.hang),
      status: d.status,
      tags: d.tags.split(',').map((t) => t.trim()).filter(Boolean),
      notes: d.notes,
      measurement: existing?.measurement ?? { method: 'manual', confidence: 'high' },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    // Typed sizes are "typed by you" even if the piece once came from a photo.
    if (existing && (existing.widthMm !== widthMm || existing.heightMm !== piece.heightMm)) {
      piece.measurement = { method: 'manual', confidence: 'high' };
    }
    await savePiece(piece);
    // Drop images replaced during this edit.
    const keep = new Set([piece.image, piece.thumb]);
    await deleteBlobs([...newBlobs, existing?.image, existing?.thumb].filter((b) => b && !keep.has(b)));
    navigate('art');
  }

  async function cancel() {
    await deleteBlobs(newBlobs);
    navigate('art');
  }

  async function remove() {
    if (!existing) return;
    const uses = await layoutsUsingPiece(existing.id);
    const where = uses.length
      ? `\n\nIt will also be removed from ${uses.length} layout${uses.length > 1 ? 's' : ''}: ${uses
          .map((u) => `${u.wall.name} / ${u.layout.name}`)
          .join(', ')}.`
      : '';
    if (!confirm(`Delete “${existing.name}”?${where}`)) return;
    await deletePiece(existing.id);
    await deleteBlobs(newBlobs);
    navigate('art');
  }

  async function duplicate() {
    if (!existing) return;
    const now = Date.now();
    // Copy image blobs so deleting one piece never breaks the other.
    const copyBlob = async (ref?: string) => {
      if (!ref) return undefined;
      const b = await getBlob(ref);
      return b ? putBlob(b) : undefined;
    };
    const copy: ArtPiece = {
      ...existing,
      id: newId(),
      name: `${existing.name} (copy)`,
      image: await copyBlob(existing.image),
      thumb: await copyBlob(existing.thumb),
      createdAt: now,
      updatedAt: now,
    };
    await savePiece(copy);
    navigate(`art/${copy.id}`);
  }

  const aspect = d.widthMm && d.heightMm ? d.widthMm / d.heightMm : 0.8;

  return (
    <section>
      <TopBar title={existing ? 'Edit art' : 'Add art'} backHref="#/art" />
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label htmlFor="piece-name">Name</label>
          <input id="piece-name" value={d.name} onChange={(e) => set({ name: e.target.value })} required autoFocus={!existing} placeholder="e.g. Beach print" />
        </div>

        <div className="row2">
          <LengthInput label="Width" unit={units} valueMm={d.widthMm} onChange={(widthMm) => set({ widthMm })} required />
          <LengthInput label="Height" unit={units} valueMm={d.heightMm} onChange={(heightMm) => set({ heightMm })} required />
        </div>
        <p className="hint">Outer size including the frame: the space it takes on the wall.</p>

        <div className="field">
          <span className="label">Photo (optional)</span>
          <div className="photo-row">
            <div className="photo-preview">
              <Thumb blob={d.thumb} alt="Piece photo" aspect={aspect} label={d.name || 'No photo'} />
            </div>
            <div className="photo-actions">
              <label className="button">
                {d.image ? 'Replace photo' : 'Add photo'}
                <input type="file" accept="image/*" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
              </label>
              {d.image && (
                <button type="button" onClick={() => set({ image: undefined, thumb: undefined })}>
                  Remove photo
                </button>
              )}
              {busy && <span className="muted">Processing…</span>}
            </div>
          </div>
          <p className="hint">Crop the photo to the frame’s edges first; it’s stretched to the size you type.</p>
          {error && <p className="error">{error}</p>}
        </div>

        <fieldset className="card">
          <legend>How it hangs</legend>
          <div className="field">
            <label htmlFor="hang-type">Hanger</label>
            <select
              id="hang-type"
              value={d.hangType}
              onChange={(e) => {
                const hangType = e.target.value as HangType;
                set({ hangType, hang: defaultHangParams(hangType) });
              }}
            >
              {HANG_TYPES.map((t) => (
                <option key={t} value={t}>
                  {HANG_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <LengthInput
            label={d.hangType === 'wire' ? 'Top edge to top of wire, pulled taut' : d.hangType === 'dring2' ? 'Top edge to D-rings' : 'Top edge to hanger'}
            unit={units}
            valueMm={d.hang.dropMm}
            onChange={(dropMm) => dropMm !== null && set({ hang: { ...d.hang, dropMm } })}
            hint={d.hangType === 'wire' ? 'Pull the wire up towards the top edge as if it were on a nail, then measure down to the wire.' : undefined}
          />
          {d.hangType === 'dring2' && (
            <LengthInput
              label="Side edge to each D-ring"
              unit={units}
              valueMm={d.hang.insetMm}
              onChange={(insetMm) => insetMm !== null && set({ hang: { ...d.hang, insetMm } })}
            />
          )}
        </fieldset>

        <div className="row2">
          <div className="field">
            <label htmlFor="status">Status</label>
            <select id="status" value={d.status} onChange={(e) => set({ status: e.target.value as PieceStatus })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tags">Tags</label>
            <input id="tags" value={d.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="comma, separated" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" rows={3} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>

        {existing && (
          <p className="hint">
            Size source: {existing.measurement.method === 'manual' ? 'typed by you' : `measured from photo (${existing.measurement.confidence})`}
          </p>
        )}

        <div className="actions">
          <button type="submit" className="primary" disabled={!valid || busy}>
            Save
          </button>
          <button type="button" onClick={() => void cancel()}>
            Cancel
          </button>
          {existing && (
            <>
              <button type="button" onClick={() => void duplicate()}>
                Duplicate
              </button>
              <button type="button" className="danger" onClick={() => void remove()}>
                Delete
              </button>
            </>
          )}
        </div>
      </form>
    </section>
  );
}

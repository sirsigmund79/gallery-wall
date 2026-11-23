// "I know this one's size": width/height fields plus one-tap presets.
// Shared by Scan art and Add a wall so both work the same way.
import type { ReactNode } from 'react';
import type { LengthUnit, Mm } from '../domain/types.ts';
import { LengthInput } from './LengthInput.tsx';

export interface Preset {
  label: string;
  a: Mm;
  b: Mm;
}

interface Props<P extends Preset> {
  title: ReactNode;
  units: LengthUnit;
  widthMm: Mm | null;
  heightMm: Mm | null;
  onChange: (v: { widthMm?: Mm | null; heightMm?: Mm | null }) => void;
  presets: P[];
  onPreset: (p: P) => void;
  hint?: ReactNode;
  children?: ReactNode;
}

export function ReferencePicker<P extends Preset>({ title, units, widthMm, heightMm, onChange, presets, onPreset, hint, children }: Props<P>) {
  return (
    <fieldset className="card">
      <legend>{title}</legend>
      <div className="chips" aria-label="Common sizes">
        {presets.map((p) => (
          <button key={p.label} type="button" className="chip-btn" onClick={() => onPreset(p)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="row2">
        <LengthInput label="Width (across)" unit={units} valueMm={widthMm} onChange={(v) => onChange({ widthMm: v })} />
        <LengthInput label="Height (up-down)" unit={units} valueMm={heightMm} onChange={(v) => onChange({ heightMm: v })} />
      </div>
      {children}
      {hint && <p className="hint">{hint}</p>}
    </fieldset>
  );
}

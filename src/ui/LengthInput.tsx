import { useId, useState } from 'react';
import type { LengthUnit, Mm } from '../domain/types.ts';
import { formatLength, parseLength } from '../geometry/units.ts';

interface Props {
  label: string;
  valueMm: Mm | null;
  unit: LengthUnit;
  onChange: (mm: Mm | null) => void;
  required?: boolean;
  hint?: string;
  autoFocus?: boolean;
  /** Allow negative values (positions); lengths are non-negative. */
  allowNegative?: boolean;
  /** Only report the value on blur or Enter (avoids an undo step per keystroke). */
  commitOnBlur?: boolean;
}

const display = (mm: Mm | null, unit: LengthUnit) =>
  mm === null ? '' : formatLength(mm, unit).replace(/\s*(in|cm|mm)$/, '');

/** A length field in the user's unit. Accepts "11 7/16", "29.7 cm", etc. */
export function LengthInput({ label, valueMm, unit, onChange, required, hint, autoFocus, allowNegative, commitOnBlur }: Props) {
  const id = useId();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);
  // While editing, show what's typed; otherwise show the formatted value.
  const shown = focused || invalid ? text : display(valueMm, unit);

  const parse = (t: string): Mm | null => {
    const neg = allowNegative && t.trim().startsWith('-');
    const v = parseLength(neg ? t.trim().slice(1) : t, unit);
    return v === null ? null : neg ? -v : v;
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`with-unit${invalid ? ' invalid' : ''}`}>
        <input
          id={id}
          inputMode="text"
          autoComplete="off"
          enterKeyHint="done"
          value={shown}
          required={required}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          placeholder={unit === 'in' ? 'e.g. 11 7/16' : unit === 'cm' ? 'e.g. 29.7' : 'e.g. 297'}
          onFocus={() => {
            if (!invalid) setText(display(valueMm, unit));
            setFocused(true);
          }}
          onChange={(e) => {
            setText(e.target.value);
            const v = e.target.value.trim() ? parse(e.target.value) : null;
            setInvalid(!!e.target.value.trim() && v === null);
            if (!commitOnBlur) onChange(v);
          }}
          onKeyDown={(e) => {
            if (commitOnBlur && e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          onBlur={() => {
            setFocused(false);
            if (commitOnBlur) {
              const v = text.trim() ? parse(text) : null;
              if (v !== null) onChange(v);
              setInvalid(false);
            }
          }}
        />
        <span className="unit">{unit}</span>
      </div>
      {invalid ? <p className="error">Not a length I understand. Try “11 7/16” or “29.7 cm”.</p> : hint && <p className="hint">{hint}</p>}
    </div>
  );
}

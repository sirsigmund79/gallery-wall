import type { LengthUnit } from '../../domain/types.ts';
import { formatLength } from '../../geometry/units.ts';
import { useSettings } from '../../state/settings.ts';

const UNIT_LABELS: Record<LengthUnit, string> = {
  in: 'Inches (fractions to 1/16)',
  cm: 'Centimetres',
  mm: 'Millimetres',
};

export function SettingsScreen() {
  const units = useSettings((s) => s.units);
  const setUnits = useSettings((s) => s.setUnits);

  return (
    <section aria-labelledby="settings-h">
      <h1 id="settings-h">Settings</h1>
      <fieldset className="card">
        <legend>Units</legend>
        {(Object.keys(UNIT_LABELS) as LengthUnit[]).map((u) => (
          <label key={u} className="radio-row">
            <input
              type="radio"
              name="units"
              value={u}
              checked={units === u}
              onChange={() => void setUnits(u)}
            />
            <span>{UNIT_LABELS[u]}</span>
          </label>
        ))}
        <p className="hint">
          Example: a sheet of A4 is {formatLength(297, units)} tall.
        </p>
      </fieldset>
      <div className="card">
        <h2>About</h2>
        <p className="hint">
          HangPlan is local-first: your photos and measurements stay on this device. No account, no
          uploads.
        </p>
      </div>
    </section>
  );
}

import type { CalibrationQuality } from '../domain/types.ts';

const TEXT: Record<CalibrationQuality, string> = { good: 'Good', check: 'Check', poor: 'Poor' };
const ICON: Record<CalibrationQuality, string> = { good: '✓', check: '!', poor: '✕' };

export function QualityBadge({ quality, pct }: { quality: CalibrationQuality; pct?: number }) {
  return (
    <span className={`badge q-${quality}`}>
      <span aria-hidden="true">{ICON[quality]}</span> {TEXT[quality]}
      {pct !== undefined && quality === 'good' && <> · ±{pct}%</>}
    </span>
  );
}

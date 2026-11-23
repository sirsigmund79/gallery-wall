// Progress panel for slow work: shows the current step and elapsed time, and
// after a while the recent diagnostics log and a Cancel button, so a stuck
// phone never just shows a spinner forever.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getEntries, subscribe } from '../diag/log.ts';

/** Show the log tail after this long. */
const SHOW_DETAILS_AFTER_S = 12;

export function WorkingPanel({ status, onCancel }: { status: string; onCancel?: () => void }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const entries = useSyncExternalStore(subscribe, getEntries);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.round((now - start) / 1000);
  const recent = entries.filter((e) => e.t >= start - 1000).slice(-6);
  return (
    <div className="card center" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p>{status}</p>
      <p className="muted">{secs} s</p>
      {secs >= SHOW_DETAILS_AFTER_S && (
        <>
          {recent.length > 0 && (
            <pre className="log-tail">{recent.map((e) => `${e.level === 'info' ? '' : e.level.toUpperCase() + ' '}${e.msg}`).join('\n')}</pre>
          )}
          {onCancel && (
            <button onClick={onCancel} className="danger">
              Cancel
            </button>
          )}
        </>
      )}
    </div>
  );
}

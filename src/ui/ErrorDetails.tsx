import { useState } from 'react';
import { reportText } from '../diag/log.ts';

/** An error message with a way to copy the diagnostics report (for phones). */
export function ErrorDetails({ message }: { message: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="error-box" role="alert">
      <p className="error">{message}</p>
      <div className="actions">
        <button
          onClick={() =>
            void navigator.clipboard
              ?.writeText(reportText())
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? 'Copied' : 'Copy details'}
        </button>
        <a className="button" href="#/settings/diagnostics">
          Diagnostics
        </a>
      </div>
    </div>
  );
}

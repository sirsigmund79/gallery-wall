// Settings → Diagnostics: what happened on this device, for bug reports from
// phones (which have no visible console). Nothing here leaves the device
// unless the user copies it.
import { useState, useSyncExternalStore } from 'react';
import { cvState, releaseCv, selfTest } from '../../cv/client.ts';
import { clearLog, environmentReport, getEntries, info, error as logError, reportText, subscribe } from '../../diag/log.ts';
import { TopBar } from '../../ui/TopBar.tsx';

export function Diagnostics() {
  const entries = useSyncExternalStore(subscribe, getEntries);
  const [test, setTest] = useState<string>();
  const [copied, setCopied] = useState(false);

  async function runTest() {
    setTest('Loading the image tools and running a test…');
    info('Diagnostics: image tools self-test started');
    try {
      // Start from a fresh worker so the test includes loading.
      releaseCv();
      const r = await selfTest();
      info('Diagnostics:', r);
      setTest(r);
    } catch (e) {
      logError('Diagnostics: self-test failed:', e);
      setTest(`Failed: ${(e as Error).message}`);
    }
  }

  return (
    <section>
      <TopBar title="Diagnostics" backHref="#/settings" />
      <p className="hint">
        If something goes wrong, tap <strong>Copy report</strong> and paste it into a message. It includes your browser and device type and what the app did,
        but no photos or measurements.
      </p>
      <div className="actions">
        <button className="primary" onClick={() => void runTest()}>
          Test image tools
        </button>
        <button
          onClick={() =>
            void navigator.clipboard
              ?.writeText(reportText())
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? 'Copied' : 'Copy report'}
        </button>
        <button onClick={clearLog}>Clear log</button>
      </div>
      {test && <p className={test.startsWith('Failed') ? 'error' : 'hint'}>{test}</p>}
      <h2>Device</h2>
      <pre className="log">{environmentReport()}{`\nImage tools: ${cvState()}`}</pre>
      <h2>Log</h2>
      <pre className="log">
        {entries.length
          ? entries.map((e) => `${new Date(e.t).toLocaleTimeString()} ${e.level === 'info' ? '' : e.level.toUpperCase() + ' '}${e.msg}`).join('\n')
          : 'Nothing logged yet.'}
      </pre>
    </section>
  );
}

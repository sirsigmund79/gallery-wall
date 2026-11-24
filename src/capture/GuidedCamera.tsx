// Live camera with a level overlay (spec §6.1). Records gravity at the instant
// of capture. Works as a plain camera when motion sensors are unavailable.
import { useEffect, useRef, useState } from 'react';
import { autoMode, floorLevelOk, floorTilt, wallLevelOk, wallTilt, FLOOR_MAX_TILT_DEG, WALL_MAX_PITCH_DEG, WALL_MAX_ROLL_DEG, type RectifyMode } from '../geometry/gravity.ts';
import { useGravity, type GravityReading, type MotionPermission } from './sensors.ts';

export interface GuidedShot {
  blob: Blob;
  width: number;
  height: number;
  /** Gravity at capture, or null if sensors were unavailable. */
  gravity: GravityReading | null;
  /** How the phone was pointing: decides how the photo is straightened. */
  mode: RectifyMode;
}

interface Props {
  /** 'auto' picks wall or floor from how the phone is held (pointing down vs. out). */
  mode: RectifyMode | 'auto';
  motion: MotionPermission;
  onCapture: (shot: GuidedShot) => void;
  onCancel: () => void;
  /** Offered when the camera can't be opened. */
  onUseFile: () => void;
}

const TIPS: Record<RectifyMode | 'any', string> = {
  wall: 'Stand square to the wall and keep the phone upright. Use the 1× camera.',
  floor: 'Hold the phone flat above the art. Fit every piece in the frame with some floor around each.',
  any: 'Art on the floor: shoot from straight above. Art on a wall: stand square to it. The level adjusts to how you hold the phone.',
};

export function GuidedCamera({ mode: requested, motion, onCapture, onCancel, onUseFile }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  /** The shutter only works once the video is delivering frames. */
  const [live, setLive] = useState(false);
  const { reading, status, latest } = useGravity(motion === 'granted');

  // Auto mode: follow the phone's attitude, with hysteresis (see autoMode).
  // Derived state, updated during render (React's documented pattern).
  const [autoState, setAutoState] = useState<RectifyMode | null>(null);
  if (requested === 'auto' && reading) {
    const next = autoMode(reading.g, autoState);
    if (next !== autoState) setAutoState(next);
  }
  const known: RectifyMode | null = requested === 'auto' ? autoState : requested;
  // Without sensors there's no way to tell; floor is the art-scanning default.
  const mode: RectifyMode = known ?? 'floor';

  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } },
        });
        if (!alive) return stream.getTracks().forEach((t) => t.stop());
        const v = video.current!;
        v.srcObject = stream;
        await v.play().catch(() => {});
      } catch (e) {
        const name = (e as DOMException)?.name;
        setError(
          name === 'NotAllowedError'
            ? 'Camera access was blocked. You can allow it in your browser settings, or choose a photo instead.'
            : !window.isSecureContext
              ? 'The camera needs a secure (https) connection.'
              : 'The camera could not be opened.',
        );
      }
    })();
    return () => {
      alive = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const sensors = motion === 'granted' && status !== 'none';
  let ok = true;
  let readout: string;
  let bubble: [number, number] = [0, 0];
  let roll = 0;
  let pitch = 0;
  if (sensors && reading) {
    if (mode === 'floor') {
      const t = floorTilt(reading.g);
      ok = floorLevelOk(t);
      readout = ok ? 'Level · looking down' : `Tilted ${t.tiltDeg.toFixed(0)}°, flatten the phone`;
      // A real bubble floats to the high side: opposite to gravity's lean.
      const k = 1 / Math.sin((20 * Math.PI) / 180); // full deflection at 20°
      bubble = [Math.max(-1, Math.min(1, -t.lean[0] * k)), Math.max(-1, Math.min(1, -t.lean[1] * k))];
    } else {
      const t = wallTilt(reading.g);
      ok = wallLevelOk(t);
      roll = t.rollDeg;
      pitch = t.pitchDeg;
      readout = ok
        ? 'Level · facing the wall'
        : Math.abs(t.rollDeg) > WALL_MAX_ROLL_DEG
          ? `Rotate ${t.rollDeg > 0 ? 'left' : 'right'} ${Math.abs(t.rollDeg).toFixed(0)}°`
          : `Tilt ${t.pitchDeg > 0 ? 'up' : 'down'} ${Math.abs(t.pitchDeg).toFixed(0)}°`;
    }
  } else if (motion === 'granted' && status === 'waiting') {
    readout = 'Waiting for motion sensor…';
  } else {
    readout = 'Level guide unavailable: hold the phone as straight as you can.';
  }

  async function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    setBusy(true);
    const gravity = sensors ? latest() : null;
    // Decide the mode from the reading actually captured.
    const shotMode = requested === 'auto' && gravity ? autoMode(gravity.g, autoState) : mode;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92));
    const { width, height } = c;
    c.width = c.height = 0;
    setBusy(false);
    if (blob) onCapture({ blob, width, height, gravity, mode: shotMode });
  }

  return (
    <div className="camera" role="dialog" aria-label="Camera">
      <video ref={video} playsInline muted autoPlay onPlaying={() => setLive(true)} onLoadedData={() => setLive(true)} />
      {!error && (
        <div className={`level level-${mode}${ok ? ' ok' : ''}`} aria-hidden="true">
          {mode === 'floor' ? (
            <>
              <div className="level-ring" />
              <div className="level-ring inner" />
              {sensors && reading && <div className="level-bubble" style={{ transform: `translate(${bubble[0] * 70}px, ${bubble[1] * 70}px)` }} />}
            </>
          ) : (
            <>
              <div className="level-ref" />
              {sensors && reading && (
                <div className="level-horizon" style={{ transform: `translateY(${Math.max(-1, Math.min(1, -pitch / (WALL_MAX_PITCH_DEG * 2))) * 120}px) rotate(${-roll}deg)` }} />
              )}
            </>
          )}
        </div>
      )}
      <div className="camera-top">
        <button className="camera-btn" onClick={onCancel}>
          Cancel
        </button>
        <p className="camera-tip">{TIPS[known ?? 'any']}</p>
      </div>
      <div className="camera-bottom">
        {error ? (
          <div className="camera-error">
            <p>{error}</p>
            <button className="primary" onClick={onUseFile}>
              Choose a photo instead
            </button>
          </div>
        ) : (
          <>
            <p className={`camera-readout${ok ? ' ok' : ''}`} role="status">
              {readout}
              {sensors && reading && mode === 'floor' && !ok && <> (within {FLOOR_MAX_TILT_DEG}°)</>}
            </p>
            {!live && <p className="camera-readout">Starting camera…</p>}
            <button className={`shutter${ok ? ' ok' : ''}`} onClick={() => void capture()} disabled={busy || !live} aria-label={ok ? 'Take photo' : 'Take photo (not level)'} />
          </>
        )}
      </div>
    </div>
  );
}

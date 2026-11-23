// Device orientation → smoothed gravity in the camera frame (spec §5.2, §6.1).
import { useEffect, useRef, useState } from 'react';
import { gravityCamera, meanGravity } from '../geometry/gravity.ts';
import type { Vec3 } from '../geometry/mat3.ts';

export type MotionPermission = 'granted' | 'denied' | 'unavailable';

type IOSOrientationEvent = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

export const motionApiPresent = () => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;

/**
 * Ask for motion access. On iOS this MUST be called from a user gesture (a tap
 * handler), before any await. Elsewhere it resolves immediately.
 */
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (!motionApiPresent()) return 'unavailable';
  const D = DeviceOrientationEvent as IOSOrientationEvent;
  if (typeof D.requestPermission === 'function') {
    try {
      return (await D.requestPermission()) === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  }
  return 'granted';
}

export function screenAngle(): number {
  const a = screen.orientation?.angle;
  if (typeof a === 'number') return a;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

export interface GravityReading {
  /** Smoothed unit gravity in the camera frame. */
  g: Vec3;
  betaDeg: number;
  gammaDeg: number;
  screenAngle: number;
}

/** Number of recent readings averaged (≈ 0.15–0.3 s at typical sensor rates). */
const SMOOTHING = 8;
/** If no event arrives within this time, report the sensor as missing. */
const NO_DATA_MS = 1500;

/**
 * Live, smoothed gravity. `status` is 'waiting' until the first event,
 * 'none' if events never come (desktop, or permission silently refused).
 */
export function useGravity(enabled: boolean): { reading: GravityReading | null; status: 'waiting' | 'live' | 'none'; latest: () => GravityReading | null } {
  const [reading, setReading] = useState<GravityReading | null>(null);
  const [status, setStatus] = useState<'waiting' | 'live' | 'none'>('waiting');
  const buf = useRef<Vec3[]>([]);
  const last = useRef<GravityReading | null>(null);

  useEffect(() => {
    if (!enabled || !motionApiPresent()) return;
    let raf = 0;
    let got = false;
    const onEvent = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      got = true;
      const angle = screenAngle();
      buf.current.push(gravityCamera(e.beta, e.gamma, angle));
      if (buf.current.length > SMOOTHING) buf.current.shift();
      last.current = { g: meanGravity(buf.current)!, betaDeg: e.beta, gammaDeg: e.gamma, screenAngle: angle };
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          setReading(last.current);
          setStatus('live');
        });
    };
    // Rotating the screen changes the frame: start the average afresh.
    const onRotate = () => (buf.current = []);
    window.addEventListener('deviceorientation', onEvent);
    screen.orientation?.addEventListener?.('change', onRotate);
    const t = setTimeout(() => !got && setStatus('none'), NO_DATA_MS);
    return () => {
      window.removeEventListener('deviceorientation', onEvent);
      screen.orientation?.removeEventListener?.('change', onRotate);
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [enabled]);

  return { reading: enabled ? reading : null, status: enabled ? status : 'none', latest: () => last.current };
}

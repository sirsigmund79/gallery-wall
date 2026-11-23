// Debug screen for motion-sensor sign conventions (spec §5.2): verify on a real
// iPhone and Android phone that flat ≈ (0,0,1) and upright ≈ (0,1,0).
import { useState } from 'react';
import { requestMotionPermission, useGravity, type MotionPermission } from '../../capture/sensors.ts';
import { floorTilt, wallTilt } from '../../geometry/gravity.ts';
import { TopBar } from '../../ui/TopBar.tsx';

const f = (n: number, d = 3) => (n >= 0 ? ' ' : '') + n.toFixed(d);

export function SensorCheck() {
  const [perm, setPerm] = useState<MotionPermission | null>(null);
  const { reading, status } = useGravity(perm === 'granted');
  return (
    <section>
      <TopBar title="Sensor check" backHref="#/settings" />
      <p>Checks that the level guide reads your phone’s motion sensor correctly.</p>
      {perm !== 'granted' && (
        <button className="primary" onClick={() => void requestMotionPermission().then(setPerm)}>
          Start
        </button>
      )}
      {perm && perm !== 'granted' && <p className="error">Motion sensor: {perm}. The level guide will be unavailable.</p>}
      {perm === 'granted' && (
        <div className="card mono">
          {status === 'none' && <p className="error">No sensor data received (desktop browser, or access refused).</p>}
          {reading && (
            <>
              <p>β {f(reading.betaDeg, 1)}° · γ {f(reading.gammaDeg, 1)}° · screen {reading.screenAngle}°</p>
              <p>
                g (camera) = ({f(reading.g[0])}, {f(reading.g[1])}, {f(reading.g[2])})
              </p>
              <p>
                Wall: roll {f(wallTilt(reading.g).rollDeg, 1)}°, pitch {f(wallTilt(reading.g).pitchDeg, 1)}°
              </p>
              <p>Floor: tilt {f(floorTilt(reading.g).tiltDeg, 1)}°</p>
            </>
          )}
        </div>
      )}
      <div className="card">
        <h2>What you should see</h2>
        <ul className="tips">
          <li>Phone flat on a table, screen up: g ≈ (0, 0, 1), floor tilt ≈ 0°.</li>
          <li>Phone upright (portrait), facing a wall: g ≈ (0, 1, 0), roll ≈ 0°, pitch ≈ 0°.</li>
          <li>Upright, top tipped away from you: pitch goes positive.</li>
          <li>Upright, turned clockwise like a steering wheel: roll goes positive.</li>
          <li>Repeat holding the phone sideways (landscape): the same values.</li>
        </ul>
      </div>
    </section>
  );
}

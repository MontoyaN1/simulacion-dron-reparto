import { useEffect, useRef, useState } from "react";
import type { DronePhase, Telemetry } from "@dron/shared";
import { fmt, fmtClock, PHASE_LABELS } from "../format";

const MAX_ROWS = 30;
const SAMPLE_INTERVAL = 1;

interface Sample {
  t: number;
  position: readonly [number, number, number];
  speed: number;
  battery: number;
  phase: DronePhase;
}

export function DataTable({ telemetry }: { telemetry: Telemetry | null }) {
  const [rows, setRows] = useState<Sample[]>([]);
  const lastT = useRef<number | null>(null);

  useEffect(() => {
    if (!telemetry) return;
    const reset = lastT.current !== null && telemetry.t < lastT.current;
    if (!reset && lastT.current !== null && telemetry.t - lastT.current < SAMPLE_INTERVAL) return;
    lastT.current = telemetry.t;
    const sample: Sample = {
      t: telemetry.t,
      position: telemetry.position,
      speed: telemetry.speed,
      battery: telemetry.batteryPercent,
      phase: telemetry.phase,
    };
    setRows((current) => (reset ? [sample] : [sample, ...current].slice(0, MAX_ROWS)));
  }, [telemetry]);

  return (
    <article className="card card-wide">
      <div className="card-head">
        <h2>Tabla de datos</h2>
        <span className="chip">{rows.length ? `${rows.length} muestras · 1 Hz` : "en espera"}</span>
      </div>
      <div className="table-wrap">
        <table className="data-table mono">
          <thead>
            <tr>
              <th>t</th>
              <th>fase</th>
              <th>x (m)</th>
              <th>y (m)</th>
              <th>z (m)</th>
              <th>v (m/s)</th>
              <th>batería</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="table-empty">
                  Esperando telemetría del motor…
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.t.toFixed(3)}>
                  <td>{fmtClock(row.t)}</td>
                  <td>{PHASE_LABELS[row.phase]}</td>
                  <td>{fmt(row.position[0], 1)}</td>
                  <td>{fmt(row.position[1], 1)}</td>
                  <td>{fmt(row.position[2], 1)}</td>
                  <td>{fmt(row.speed, 1)}</td>
                  <td>{fmt(row.battery, 1)} %</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

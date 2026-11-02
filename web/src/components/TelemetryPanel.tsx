import type { SimulationStatus, Telemetry } from "@dron/shared";
import { PHASE_LABELS, fmt, fmtClock, fmtVector } from "../format";

interface Props {
  telemetry: Telemetry | null;
  status: SimulationStatus;
}

interface RowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function Row({ label, value, mono = false }: RowProps) {
  return (
    <div className="telemetry-row">
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{value}</dd>
    </div>
  );
}

export function TelemetryPanel({ telemetry, status }: Props) {
  const t = telemetry;
  const battery = t?.batteryPercent ?? 100;
  const batteryTone = battery < 20 ? "low" : battery < 45 ? "mid" : "high";

  return (
    <article className="card panel">
      <div className="card-head">
        <h2>Telemetría</h2>
        <span className="chip">{status.running ? "15 Hz" : "en pausa"}</span>
      </div>

      <dl className="telemetry-list">
        <Row label="Tiempo de vuelo" value={fmtClock(t?.t ?? 0)} mono />
        <Row label="Posición ENU" value={t ? fmtVector(t.position, 1) : "—"} mono />
        <Row
          label="Velocidad"
          value={t ? `${fmt(t.speed, 1)} m/s · ${fmt(t.headingDeg, 0)}°` : "—"}
          mono
        />
        <Row
          label="Velocidad vertical"
          value={
            t
              ? Math.abs(t.verticalSpeed) < 0.02
                ? "0,00 m/s"
                : `${t.verticalSpeed > 0 ? "↑" : "↓"} ${fmt(Math.abs(t.verticalSpeed), 2)} m/s`
              : "—"
          }
          mono
        />
        <Row label="Altitud AGL" value={t ? `${fmt(t.altitudeAgl, 0)} m` : "—"} mono />
        <Row
          label="Distancia restante"
          value={t ? `${fmt(t.distanceRemaining, 0)} m` : "—"}
          mono
        />
        <Row label="Potencia" value={t ? `${fmt(t.powerWatts, 0)} W` : "—"} mono />
        <Row label="Fase" value={t ? PHASE_LABELS[t.phase] : "—"} />
      </dl>

      <div className="battery-block">
        <div className="battery-head">
          <span>Batería</span>
          <span className={`mono battery-${batteryTone}`}>{fmt(battery, 1)} %</span>
        </div>
        <div className="battery-track">
          <span
            className={`battery-fill battery-${batteryTone}`}
            style={{ width: `${Math.max(0, Math.min(100, battery))}%` }}
          />
        </div>
      </div>
    </article>
  );
}

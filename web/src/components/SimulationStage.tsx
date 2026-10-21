import { useEffect, useRef, useState } from "react";
import type { ClientCommand, SimulationStatus, Telemetry, Vec3 } from "@dron/shared";
import { CAMERA_MODES, type CameraMode } from "../cesium/constants";
import { DroneScene } from "../cesium/scene";
import type { TelemetryBuffer } from "../sim/buffer";
import { PHASE_LABELS, fmt, fmtClock, fmtInt } from "../format";

interface Props {
  buffer: TelemetryBuffer;
  route: readonly Vec3[];
  telemetry: Telemetry | null;
  status: SimulationStatus;
  connected: boolean;
  send: (command: ClientCommand) => void;
}

const SPEEDS = [1, 2, 4] as const;

export function SimulationStage({ buffer, route, telemetry, status, connected, send }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<DroneScene | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>("chase");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new DroneScene(host);
    scene.attachBuffer(buffer);
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, [buffer]);

  useEffect(() => {
    sceneRef.current?.setRoute(route);
  }, [route]);

  useEffect(() => {
    sceneRef.current?.setCameraMode(cameraMode);
  }, [cameraMode]);

  const running = status.running;
  const primaryLabel = status.delivered
    ? "Entregado"
    : running
      ? "Pausar"
      : status.started
        ? "Reanudar"
        : "Iniciar vuelo";

  const handlePrimary = (): void => {
    if (status.delivered) return;
    send({ type: running ? "pause" : "start" });
  };

  const battery = telemetry?.batteryPercent ?? 100;
  const batteryTone = battery < 20 ? "low" : battery < 45 ? "mid" : "high";

  return (
    <section className="stage" aria-label="Escena 3D de la simulación">
      <div className="stage-host" ref={hostRef} />

      <div className="stage-top">
        <div className="stage-heading">
          <p className="eyebrow">UTS → UIS · Bucaramanga</p>
          <h1>Simulación en vivo</h1>
        </div>
        <div className="segmented" role="group" aria-label="Modo de cámara">
          {CAMERA_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={cameraMode === mode.id ? "segmented-item is-active" : "segmented-item"}
              onClick={() => setCameraMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div className="stage-hud">
        <div className="hud-cell">
          <span className="hud-label">Tiempo</span>
          <strong className="hud-value mono">{fmtClock(telemetry?.t ?? 0)}</strong>
        </div>
        <div className="hud-cell">
          <span className="hud-label">Velocidad</span>
          <strong className="hud-value mono">
            {fmt(telemetry?.speed ?? 0, 1)}
            <small> m/s</small>
          </strong>
        </div>
        <div className="hud-cell">
          <span className="hud-label">Altitud AGL</span>
          <strong className="hud-value mono">
            {fmt(telemetry?.altitudeAgl ?? 0, 0)}
            <small> m</small>
          </strong>
        </div>
        <div className="hud-cell">
          <span className="hud-label">Batería</span>
          <strong className={`hud-value mono battery-${batteryTone}`}>
            {fmtInt(battery)}
            <small> %</small>
          </strong>
          <span className="hud-bar">
            <span className={`hud-bar-fill battery-${batteryTone}`} style={{ width: `${battery}%` }} />
          </span>
        </div>
      </div>

      <div className="stage-bottom">
        <div className="stage-controls">
          <button
            type="button"
            className="button button-primary"
            onClick={handlePrimary}
            disabled={status.delivered}
          >
            {primaryLabel}
          </button>
          <button type="button" className="button" onClick={() => send({ type: "reset" })}>
            Reiniciar
          </button>
          <div className="segmented" role="group" aria-label="Velocidad de simulación">
            {SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                className={
                  Math.abs(status.speed - speed) < 0.01
                    ? "segmented-item is-active"
                    : "segmented-item"
                }
                onClick={() => send({ type: "speed", value: speed })}
              >
                {speed}×
              </button>
            ))}
          </div>
          <span className={`chip chip-live ${running ? "is-live" : ""}`}>
            {telemetry ? PHASE_LABELS[telemetry.phase] : "Sin datos"}
          </span>
        </div>

        <div className="progress">
          <span className="progress-fill" style={{ width: `${(telemetry?.progress ?? 0) * 100}%` }} />
        </div>
      </div>

      {!connected ? (
        <div className="stage-overlay">
          <div className="overlay-card">
            <span className="spinner" />
            <p>Conectando con el motor de simulación…</p>
            <span className="overlay-hint">Reintentando cada 2,5 s</span>
          </div>
        </div>
      ) : null}

      {status.delivered ? (
        <div className="stage-banner">Entrega completada · {fmtClock(telemetry?.t ?? 0)}</div>
      ) : null}
    </section>
  );
}

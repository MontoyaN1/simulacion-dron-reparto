import { useEffect, useState } from "react";
import { DetailsSection } from "./components/DetailsSection";
import { EventsPanel } from "./components/EventsPanel";
import { SimulationStage } from "./components/SimulationStage";
import { TelemetryPanel } from "./components/TelemetryPanel";
import { useSimulation } from "./sim/useSimulation";

interface HealthResponse {
  ok: boolean;
  version: string;
  phase: number;
}

export function App() {
  const { buffer, telemetry, status, events, route, connected, send } = useSimulation();
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/health")
      .then((response) => (response.ok ? (response.json() as Promise<HealthResponse>) : null))
      .then((data) => {
        if (active) setHealth(data);
      })
      .catch(() => {
        if (active) setHealth(null);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">D</span>
          <div>
            <p className="brand-name">Dron UTS · UIS</p>
            <p className="brand-sub">Simulación de reparto en Bucaramanga</p>
          </div>
        </div>
        <div className="topbar-right">
          <span className={`status ${connected ? "status-ok" : "status-error"}`}>
            <span className="status-dot" />
            {connected ? "Motor conectado" : "Reconectando"}
          </span>
          <span className="badge">Fase {health?.phase ?? 3}</span>
        </div>
      </header>

      <main>
        <div className="workspace">
          <SimulationStage
            buffer={buffer}
            route={route}
            telemetry={telemetry}
            status={status}
            connected={connected}
            send={send}
          />
          <aside className="sidebar">
            <TelemetryPanel telemetry={telemetry} status={status} />
            <EventsPanel events={events} />
          </aside>
        </div>

        <DetailsSection telemetry={telemetry} />
      </main>

      <footer className="footer">
        <span>Node 22 · TypeScript · React · CesiumJS</span>
        <span>Geodatos: OpenStreetMap contributors, ODbL</span>
      </footer>
    </div>
  );
}

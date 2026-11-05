import { DetailsSection } from "./components/DetailsSection";
import { EventsPanel } from "./components/EventsPanel";
import { SimulationStage } from "./components/SimulationStage";
import { TelemetryPanel } from "./components/TelemetryPanel";
import { useSimulation } from "./sim/useSimulation";

export function App() {
  const { buffer, telemetry, status, events, route, connected, send } = useSimulation();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="5" cy="5" r="2.6" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="19" cy="5" r="2.6" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="5" cy="19" r="2.6" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="19" cy="19" r="2.6" stroke="currentColor" strokeWidth="1.6" />
              <path d="M7 7L17 17M17 7L7 17" stroke="currentColor" strokeWidth="1.6" />
              <rect x="10.4" y="10.4" width="3.2" height="3.2" rx="0.8" fill="currentColor" />
            </svg>
          </span>
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
        <span>Geodatos: OpenStreetMap contributors, ODbL</span>
      </footer>
    </div>
  );
}

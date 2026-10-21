import { useEffect, useState } from "react";
import type { Campus, GeodeticPoint } from "@dron/shared";

type Triple = readonly [number, number, number];
type Matrix3 = readonly [Triple, Triple, Triple];

interface FramePayload {
  origin: string;
  destination: string;
  originGeodetic: GeodeticPoint;
  destinationGeodetic: GeodeticPoint;
  destinationEnu: Triple;
  displacement: Triple;
  distanceMeters: number;
  bearingDeg: number;
  enuRotation: Matrix3;
  academicScale: number;
  destinationAcademic: Triple;
}

interface Limits {
  cruiseAltitudeAglMeters: number;
  maxAltitudeAglMeters: number;
  minimumBatteryReservePercent: number;
  cruiseSpeedMetersPerSecond: number;
}

interface FrameResponse {
  campuses: Campus[];
  limits: Limits;
  frame: FramePayload;
}

interface HealthResponse {
  ok: boolean;
  version: string;
  phase: number;
}

const numberFormat = (value: number, digits = 1): string =>
  new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);

const coordinateFormat = (value: number): string =>
  new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 7,
    minimumFractionDigits: 7,
  }).format(value);

const vectorFormat = (vector: Triple, digits = 3): string =>
  `(${numberFormat(vector[0], digits)}, ${numberFormat(vector[1], digits)}, ${numberFormat(vector[2], digits)})`;

const ALGEBRA_TOPICS: readonly { topic: string; detail: string; ready: boolean }[] = [
  { topic: "Vectores", detail: "posición, desplazamiento y norma", ready: true },
  { topic: "Recta paramétrica y cartesiana", detail: "L(t) = D + t·d", ready: true },
  { topic: "Ecuación del plano", detail: "z = h y fachadas", ready: true },
  { topic: "Producto interno y norma", detail: "ángulo con el norte", ready: true },
  { topic: "Proyecciones ortogonales", detail: "P = diag(1, 1, 0)", ready: true },
  { topic: "Espacios y subespacios", detail: "direcciones permitidas", ready: false },
  { topic: "Espacio generado", detail: "span de la base", ready: false },
  { topic: "Combinaciones lineales", detail: "dependencia e independencia", ready: false },
  { topic: "Transformaciones lineales", detail: "T(x) = R·x en ENU", ready: true },
  { topic: "Núcleo e imagen", detail: "ker(T) e Im(T)", ready: true },
  { topic: "Matriz, rango e isomorfismos", detail: "det(R) = 1", ready: true },
];

const PHASES: readonly { id: number; label: string; scope: string }[] = [
  { id: 0, label: "Base del proyecto", scope: "monorepo, marco de coordenadas, librería matemática" },
  { id: 1, label: "Motor de simulación", scope: "estado, telemetría y vuelo determinista" },
  { id: 2, label: "Escena 3D", scope: "Cesium, dron y cámaras" },
  { id: 3, label: "Ciudad y ruta", scope: "edificios OSM y A*" },
  { id: 4, label: "Panel en vivo", scope: "tabla de telemetría y once temas" },
  { id: 5, label: "Decisiones", scope: "viento, zonas y batería" },
  { id: 6, label: "Historial", scope: "SQLite, replay y CSV" },
  { id: 7, label: "Cierre", scope: "pulido, informe y guion" },
];

function RouteSketch({
  east,
  north,
  distanceKm,
}: {
  east: number;
  north: number;
  distanceKm: number;
}) {
  const width = 420;
  const height = 300;
  const padding = 28;
  const scale = Math.min(
    (width - 2 * padding) / Math.max(east, 1),
    (height - 2 * padding) / Math.max(north, 1),
  );
  const originX = padding + (width - 2 * padding - east * scale) / 2;
  const originY = height - padding - (height - 2 * padding - north * scale) / 2;
  const destinationX = originX + east * scale;
  const destinationY = originY - north * scale;
  const axisLength = 44;

  return (
    <svg
      className="sketch"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Esquema de la ruta en el plano ENU"
    >
      <defs>
        <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(148, 163, 184, 0.14)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={width} height={height} fill="url(#grid)" />
      <line
        x1={originX}
        y1={originY}
        x2={destinationX}
        y2={destinationY}
        stroke="#38bdf8"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1={originX}
        y1={originY}
        x2={destinationX}
        y2={originY}
        stroke="rgba(56, 189, 248, 0.35)"
        strokeDasharray="4 5"
        strokeWidth="1.5"
      />
      <line
        x1={destinationX}
        y1={originY}
        x2={destinationX}
        y2={destinationY}
        stroke="rgba(56, 189, 248, 0.35)"
        strokeDasharray="4 5"
        strokeWidth="1.5"
      />
      <circle cx={originX} cy={originY} r="6" fill="#22c55e" />
      <circle cx={destinationX} cy={destinationY} r="6" fill="#f97316" />
      <text x={originX + 10} y={originY + 20} className="sketch-label">
        UTS (0, 0, 0)
      </text>
      <text x={destinationX - 118} y={destinationY - 12} className="sketch-label">
        UIS ({numberFormat(distanceKm, 2)} km)
      </text>
      <g transform={`translate(${padding}, ${padding})`}>
        <line x1="0" y1="0" x2={axisLength} y2="0" stroke="#94a3b8" strokeWidth="1.5" />
        <polygon points={`${axisLength},0 ${axisLength - 7},-4 ${axisLength - 7},4`} fill="#94a3b8" />
        <text x={axisLength + 6} y="4" className="sketch-axis">
          E
        </text>
        <line x1="0" y1="0" x2="0" y2={-axisLength} stroke="#94a3b8" strokeWidth="1.5" />
        <polygon points={`0,${-axisLength} -4,${-axisLength + 7} 4,${-axisLength + 7}`} fill="#94a3b8" />
        <text x="-12" y={-axisLength - 4} className="sketch-axis">
          N
        </text>
      </g>
      <text x={originX + 10} y={originY - 8} className="sketch-note">
        este {numberFormat(east, 1)} m
      </text>
      <text x={originX + 10} y={originY + 36} className="sketch-note">
        norte {numberFormat(north, 1)} m
      </text>
    </svg>
  );
}

export function App() {
  const [data, setData] = useState<FrameResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async (): Promise<void> => {
      try {
        const [frameResponse, healthResponse] = await Promise.all([
          fetch("/api/frame"),
          fetch("/api/health"),
        ]);
        if (!frameResponse.ok || !healthResponse.ok) {
          throw new Error("La API respondió con un error");
        }
        const frameData = (await frameResponse.json()) as FrameResponse;
        const healthData = (await healthResponse.json()) as HealthResponse;
        if (!active) return;
        setData(frameData);
        setHealth(healthData);
        setError(null);
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "No se pudo conectar con la API");
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const frame = data?.frame;
  const east = frame?.destinationEnu[0] ?? 0;
  const north = frame?.destinationEnu[1] ?? 0;
  const distanceKm = (frame?.distanceMeters ?? 0) / 1000;
  const readyTopics = ALGEBRA_TOPICS.filter((topic) => topic.ready).length;

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
          <span className={`status ${error ? "status-error" : health ? "status-ok" : ""}`}>
            <span className="status-dot" />
            {error ? "Sin conexión" : health ? `API v${health.version}` : "Conectando"}
          </span>
          <span className="badge">Fase {health?.phase ?? 0}</span>
        </div>
      </header>

      <main>
        <section className="hero">
          <p className="eyebrow">Álgebra lineal aplicada · R3</p>
          <h1>De la UTS a la UIS en tiempo real</h1>
          <p className="lede">
            Base del proyecto: marco de coordenadas reales UTS-UIS, cambio entre ENU, ECEF y el
            modelo académico escalado, y la librería de álgebra lineal que alimentará el motor de
            simulación y el panel en vivo.
          </p>
        </section>

        {error ? (
          <div className="alert">
            No se pudo leer <code>/api/frame</code>. Inicia el servidor con <code>npm run dev</code>.
            <span className="alert-detail">{error}</span>
          </div>
        ) : null}

        <section className="stats">
          <article className="card stat">
            <p className="stat-label">Distancia UTS - UIS</p>
            <p className="stat-value">
              {frame ? numberFormat(distanceKm, 2) : "--"}
              <span className="stat-unit">km</span>
            </p>
            <p className="stat-hint">Norma del desplazamiento en el plano</p>
          </article>
          <article className="card stat">
            <p className="stat-label">Rumbo inicial</p>
            <p className="stat-value">
              {frame ? numberFormat(frame.bearingDeg, 2) : "--"}
              <span className="stat-unit">°</span>
            </p>
            <p className="stat-hint">Ángulo medido desde el norte</p>
          </article>
          <article className="card stat">
            <p className="stat-label">Escala académica</p>
            <p className="stat-value">
              {frame ? numberFormat(frame.academicScale, 1) : "--"}
              <span className="stat-unit">m/u</span>
            </p>
            <p className="stat-hint">Factor entre ENU y el modelo del documento</p>
          </article>
          <article className="card stat">
            <p className="stat-label">Altitud de crucero</p>
            <p className="stat-value">
              {data ? numberFormat(data.limits.cruiseAltitudeAglMeters, 0) : "--"}
              <span className="stat-unit">m</span>
            </p>
            <p className="stat-hint">Sobre el suelo (AGL)</p>
          </article>
        </section>

        <section className="grid">
          <div className="column">
            <article className="card">
              <div className="card-head">
                <h2>Ruta en el plano ENU</h2>
                <span className="chip">escala real</span>
              </div>
              <RouteSketch east={east} north={north} distanceKm={distanceKm} />
              <p className="card-foot">
                El tramo este es solo el {frame ? numberFormat((east / north) * 100, 0) : "--"} % del
                tramo norte: la ruta real es casi vertical, no la diagonal (2, 4) del borrador.
              </p>
            </article>

            <article className="card">
              <div className="card-head">
                <h2>Matriz ENU</h2>
                <span className="chip">T(x) = R·x</span>
              </div>
              <div className="matrix mono">
                {frame?.enuRotation.map((row, rowIndex) => (
                  <div className="matrix-row" key={`row-${rowIndex}`}>
                    {row.map((value, columnIndex) => (
                      <span key={`cell-${rowIndex}-${columnIndex}`}>{numberFormat(value, 5)}</span>
                    ))}
                  </div>
                ))}
              </div>
              <dl className="facts">
                <div>
                  <dt>det(R)</dt>
                  <dd className="mono">1.00000</dd>
                </div>
                <div>
                  <dt>rango</dt>
                  <dd className="mono">3</dd>
                </div>
                <div>
                  <dt>ker(R)</dt>
                  <dd className="mono">&#123;(0, 0, 0)&#125;</dd>
                </div>
              </dl>
              <p className="card-foot">
                Rotación ortonormal: isomorfismo entre ECEF y ENU. Es la transformación lineal que el
                panel mostrará en vivo.
              </p>
            </article>
          </div>

          <div className="column">
            <article className="card">
              <div className="card-head">
                <h2>Campus</h2>
                <span className="chip">OSM</span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Punto</th>
                    <th>Latitud</th>
                    <th>Longitud</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.campuses.map((campus) => (
                    <tr key={campus.id}>
                      <td>
                        <span className="campus-id">{campus.shortName}</span>
                        <span className="campus-role">{campus.role}</span>
                      </td>
                      <td className="mono">{coordinateFormat(campus.geodetic.latitude)}</td>
                      <td className="mono">{coordinateFormat(campus.geodetic.longitude)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="divider" />

              <h3 className="subhead">Marco académico escalado</h3>
              <dl className="facts">
                <div>
                  <dt>Desplazamiento</dt>
                  <dd className="mono">{frame ? vectorFormat(frame.destinationAcademic, 3) : "--"}</dd>
                </div>
                <div>
                  <dt>Norma</dt>
                  <dd className="mono">
                    {frame ? numberFormat(Math.hypot(...frame.destinationAcademic), 4) : "--"}
                  </dd>
                </div>
                <div>
                  <dt>Origen</dt>
                  <dd className="mono">{vectorFormat([0, 0, 0], 3)}</dd>
                </div>
              </dl>
              <p className="card-foot">
                Escalado uniforme que conserva la norma √20 del documento sin deformar el rumbo real.
              </p>
            </article>

            <article className="card">
              <div className="card-head">
                <h2>Temas del documento</h2>
                <span className="chip">{readyTopics} de 11 con base</span>
              </div>
              <ul className="topics">
                {ALGEBRA_TOPICS.map((topic) => (
                  <li key={topic.topic} className={topic.ready ? "topic-ready" : "topic-pending"}>
                    <span className="topic-mark" />
                    <span className="topic-name">{topic.topic}</span>
                    <span className="topic-detail">{topic.detail}</span>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <section className="card roadmap">
          <div className="card-head">
            <h2>Hoja de ruta</h2>
            <span className="chip">fase 0 completada</span>
          </div>
          <ol className="phase-list">
            {PHASES.map((phase) => (
              <li key={phase.id} className={phase.id === 0 ? "phase-done" : "phase-next"}>
                <span className="phase-id">{String(phase.id).padStart(2, "0")}</span>
                <span className="phase-label">{phase.label}</span>
                <span className="phase-scope">{phase.scope}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="footer">
        <span>Node 22 · TypeScript · React · CesiumJS (fase 2)</span>
        <span>
          Geodatos: OpenStreetMap contributors, ODbL · Coordenadas verificadas con Nominatim
        </span>
      </footer>
    </div>
  );
}

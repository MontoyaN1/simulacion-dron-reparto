import { useEffect, useState } from "react";
import type { GeodeticPoint } from "@dron/shared";
import { fmt, fmtVector } from "../format";

type Triple = readonly [number, number, number];
type Matrix3 = readonly [Triple, Triple, Triple];

interface FramePayload {
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

interface FrameResponse {
  frame: FramePayload;
}

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

function RouteSketch({ east, north }: { east: number; north: number }) {
  const width = 380;
  const height = 210;
  const padding = 24;
  const scale = Math.min(
    (width - 2 * padding) / Math.max(Math.abs(east), 1),
    (height - 2 * padding) / Math.max(Math.abs(north), 1),
  );
  const originX = padding + (width - 2 * padding - Math.abs(east) * scale) / 2;
  const originY = height - padding;
  const destinationX = originX + east * scale;
  const destinationY = originY - north * scale;

  return (
    <svg
      className="sketch"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Esquema de la ruta en el plano ENU"
    >
      <defs>
        <pattern id="grid-detail" width="22" height="22" patternUnits="userSpaceOnUse">
          <path
            d="M 22 0 L 0 0 0 22"
            fill="none"
            stroke="rgba(148, 163, 184, 0.13)"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect x="0" y="0" width={width} height={height} fill="url(#grid-detail)" />
      <line
        x1={originX}
        y1={originY}
        x2={destinationX}
        y2={originY}
        stroke="rgba(56, 189, 248, 0.3)"
        strokeDasharray="4 5"
        strokeWidth="1.4"
      />
      <line
        x1={destinationX}
        y1={originY}
        x2={destinationX}
        y2={destinationY}
        stroke="rgba(56, 189, 248, 0.3)"
        strokeDasharray="4 5"
        strokeWidth="1.4"
      />
      <line
        x1={originX}
        y1={originY}
        x2={destinationX}
        y2={destinationY}
        stroke="#38bdf8"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx={originX} cy={originY} r="5.5" fill="#22c55e" />
      <circle cx={destinationX} cy={destinationY} r="5.5" fill="#f97316" />
      <text x={originX + 9} y={originY - 9} className="sketch-label">
        UTS
      </text>
      <text x={destinationX + 9} y={destinationY + 4} className="sketch-label">
        UIS
      </text>
      <text x={padding} y={padding - 3} className="sketch-note">
        norte {fmt(north, 0)} m · este {fmt(east, 0)} m
      </text>
    </svg>
  );
}

export function DetailsSection() {
  const [frame, setFrame] = useState<FramePayload | null>(null);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch("/api/frame");
        if (!response.ok) return;
        const data = (await response.json()) as FrameResponse;
        if (active) setFrame(data.frame);
      } catch {
        if (active) setFrame(null);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const readyTopics = ALGEBRA_TOPICS.filter((topic) => topic.ready).length;

  return (
    <section className="details" aria-label="Modelo matemático">
      <article className="card">
        <div className="card-head">
          <h2>Ruta real</h2>
          <span className="chip">ENU · escala real</span>
        </div>
        <RouteSketch east={frame?.destinationEnu[0] ?? 0} north={frame?.destinationEnu[1] ?? 0} />
        <dl className="facts">
          <div>
            <dt>Distancia</dt>
            <dd className="mono">{frame ? `${fmt(frame.distanceMeters / 1000, 2)} km` : "—"}</dd>
          </div>
          <div>
            <dt>Rumbo</dt>
            <dd className="mono">{frame ? `${fmt(frame.bearingDeg, 2)}°` : "—"}</dd>
          </div>
          <div>
            <dt>Escala académica</dt>
            <dd className="mono">{frame ? `${fmt(frame.academicScale, 1)} m/u` : "—"}</dd>
          </div>
          <div>
            <dt>Destino académico</dt>
            <dd className="mono">{frame ? fmtVector(frame.destinationAcademic, 3) : "—"}</dd>
          </div>
        </dl>
      </article>

      <article className="card">
        <div className="card-head">
          <h2>Matriz ENU</h2>
          <span className="chip">T(x) = R·x</span>
        </div>
        <div className="matrix mono">
          {(frame?.enuRotation ?? [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ]).map((row, rowIndex) => (
            <div className="matrix-row" key={`row-${rowIndex}`}>
              {row.map((value, columnIndex) => (
                <span key={`cell-${rowIndex}-${columnIndex}`}>{fmt(value, 5)}</span>
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
            <dt>Rango</dt>
            <dd className="mono">3</dd>
          </div>
          <div>
            <dt>ker(R)</dt>
            <dd className="mono">&#123;(0, 0, 0)&#125;</dd>
          </div>
        </dl>
        <p className="card-foot">
          Rotación ortonormal: isomorfismo entre ECEF y ENU. Es la transformación lineal que el panel
          usa en vivo.
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
    </section>
  );
}

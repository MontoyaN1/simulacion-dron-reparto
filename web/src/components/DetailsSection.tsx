import { useEffect, useMemo, useState } from "react";
import type { GeodeticPoint, LiveAlgebra, Mat3, Telemetry } from "@dron/shared";
import { liveAlgebra, norm } from "@dron/shared";
import { fmt, fmtInt, fmtVector } from "../format";
import { DataTable } from "./DataTable";

type Triple = readonly [number, number, number];

interface PlanningSummary {
  buildings: number;
  waypoints: number;
  obstacleBuildings: number;
  detourRatio: number;
  cellSize: number;
}

interface FramePayload {
  originGeodetic: GeodeticPoint;
  destinationGeodetic: GeodeticPoint;
  destinationEnu: Triple;
  displacement: Triple;
  distanceMeters: number;
  bearingDeg: number;
  enuRotation: Mat3;
  academicScale: number;
  destinationAcademic: Triple;
}

interface FrameResponse {
  frame: FramePayload;
}

interface RouteResponse {
  buildings: number;
  planning: {
    waypoints: number;
    obstacleBuildings: number;
    detourRatio: number;
    cellSize: number;
  };
}

const IDENTITY: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const NORTH: Triple = [0, 1, 0];

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
        <pattern
          id="grid-detail"
          width="22"
          height="22"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 22 0 L 0 0 0 22"
            fill="none"
            stroke="rgba(148, 163, 184, 0.13)"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect
        x="0"
        y="0"
        width={width}
        height={height}
        fill="url(#grid-detail)"
      />
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

interface Topic {
  topic: string;
  detail: string;
  value: string;
}

function buildTopics(live: LiveAlgebra | null): Topic[] {
  if (!live) {
    return [
      { topic: "Vectores", detail: "posición y norma", value: "—" },
      {
        topic: "Recta paramétrica y cartesiana",
        detail: "L(t) = p + t·ĥ",
        value: "—",
      },
      { topic: "Ecuación del plano", detail: "z = h del crucero", value: "—" },
      { topic: "Producto interno y norma", detail: "v · n̂", value: "—" },
      {
        topic: "Proyecciones ortogonales",
        detail: "P·p sobre z = 0",
        value: "—",
      },
      {
        topic: "Espacios y subespacios",
        detail: "H = {v : v_z = 0}",
        value: "—",
      },
      { topic: "Espacio generado", detail: "span{ĥ, r̂, k̂}", value: "—" },
      {
        topic: "Combinaciones lineales",
        detail: "p = a·ĥ + b·r̂ + c·k̂",
        value: "—",
      },
      { topic: "Transformaciones lineales", detail: "T(x) = R·x", value: "—" },
      { topic: "Núcleo e imagen", detail: "ker P e Im P", value: "—" },
      {
        topic: "Matriz, rango e isomorfismo",
        detail: "det(R) y base del crucero",
        value: "—",
      },
    ];
  }

  return [
    {
      topic: "Vectores",
      detail: "p = (x, y, z) y su norma",
      value: `‖p‖ = ${fmt(live.distanceFromOrigin, 1)} m`,
    },
    {
      topic: "Recta paramétrica y cartesiana",
      detail: "L(t) = p + t·ĥ",
      value: `ĥ = ${fmtVector(live.heading, 3)}`,
    },
    {
      topic: "Ecuación del plano",
      detail: "z = h del crucero",
      value: `z = ${fmt(live.altitude, 1)} m`,
    },
    {
      topic: "Producto interno y norma",
      detail: "v · n̂ con n̂ = (0, 1, 0)",
      value: `${fmt(live.northDot, 2)} m/s · rumbo ${fmt(live.bearingDeg, 1)}°`,
    },
    {
      topic: "Proyecciones ortogonales",
      detail: "P·p sobre z = 0",
      value: fmtVector(live.ground, 1),
    },
    {
      topic: "Espacios y subespacios",
      detail: "H = {v : v_z = 0}",
      value: "dim H = 2 · plano xy",
    },
    {
      topic: "Espacio generado",
      detail: "span{ĥ, r̂, k̂}",
      value: `dim = ${live.directionsRank} · det = ${fmt(live.directionsDet, 3)}`,
    },
    {
      topic: "Combinaciones lineales",
      detail: "p = a·ĥ + b·r̂ + c·k̂",
      value: `a = ${fmt(live.along, 1)} · b = ${fmt(live.lateral, 1)} · c = ${fmt(live.altitude, 1)}`,
    },
    {
      topic: "Transformaciones lineales",
      detail: "T(v) = R·v en ENU",
      value: `‖R·v‖ = ${fmt(live.rotatedSpeed, 2)} m/s = ‖v‖`,
    },
    {
      topic: "Núcleo e imagen",
      detail: "ker P = ⟨k̂⟩ · Im P = plano xy",
      value: "nulidad 1 · rango 2",
    },
    {
      topic: "Matriz, rango e isomorfismo",
      detail: "R ortonormal",
      value: `rango ${live.rotationRank} · det ${fmt(live.rotationDet, 3)}`,
    },
  ];
}

export function DetailsSection({ telemetry }: { telemetry: Telemetry | null }) {
  const [frame, setFrame] = useState<FramePayload | null>(null);
  const [planning, setPlanning] = useState<PlanningSummary | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/route")
      .then((response) =>
        response.ok ? (response.json() as Promise<RouteResponse>) : null,
      )
      .then((data) => {
        if (!active || !data) return;
        setPlanning({
          buildings: data.buildings,
          waypoints: data.planning.waypoints,
          obstacleBuildings: data.planning.obstacleBuildings,
          detourRatio: data.planning.detourRatio,
          cellSize: data.planning.cellSize,
        });
      })
      .catch(() => {
        if (active) setPlanning(null);
      });
    return () => {
      active = false;
    };
  }, []);

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

  const live = useMemo(() => {
    if (!telemetry) return null;
    const fallback: Triple =
      frame && norm([frame.displacement[0], frame.displacement[1], 0]) > 0
        ? [frame.displacement[0], frame.displacement[1], 0]
        : NORTH;
    return liveAlgebra(
      telemetry.position,
      telemetry.velocity,
      frame?.enuRotation ?? IDENTITY,
      fallback,
    );
  }, [telemetry, frame]);

  const topics = buildTopics(live);

  return (
    <>
      <section className="details" aria-label="Modelo matemático">
        <article className="card">
          <div className="card-head">
            <h2>Ruta real</h2>
            <span className="chip">
              A* · {planning ? `${planning.cellSize} m` : "ENU"}
            </span>
          </div>
          <RouteSketch
            east={frame?.destinationEnu[0] ?? 0}
            north={frame?.destinationEnu[1] ?? 0}
          />
          <dl className="facts">
            <div>
              <dt>Distancia</dt>
              <dd className="mono">
                {frame ? `${fmt(frame.distanceMeters / 1000, 2)} km` : "—"}
              </dd>
            </div>
            <div>
              <dt>Rumbo</dt>
              <dd className="mono">
                {frame ? `${fmt(frame.bearingDeg, 2)}°` : "—"}
              </dd>
            </div>
            <div>
              <dt>Escala académica</dt>
              <dd className="mono">
                {frame ? `${fmt(frame.academicScale, 1)} m/u` : "—"}
              </dd>
            </div>
            <div>
              <dt>Destino académico</dt>
              <dd className="mono">
                {frame ? fmtVector(frame.destinationAcademic, 3) : "—"}
              </dd>
            </div>
            <div>
              <dt>Edificios OSM</dt>
              <dd className="mono">
                {planning ? fmtInt(planning.buildings) : "—"}
              </dd>
            </div>
            <div>
              <dt>Bloquean el crucero</dt>
              <dd className="mono">
                {planning ? fmtInt(planning.obstacleBuildings) : "—"}
              </dd>
            </div>
            <div>
              <dt>Waypoints A*</dt>
              <dd className="mono">
                {planning
                  ? `${fmtInt(planning.waypoints)} · desvío ${fmt((planning.detourRatio - 1) * 100, 2)} %`
                  : "—"}
              </dd>
            </div>
          </dl>
        </article>

        <article className="card">
          <div className="card-head">
            <h2>Matriz ENU</h2>
            <span className="chip">T(x) = R·x</span>
          </div>
          <div className="matrix mono">
            {(frame?.enuRotation ?? IDENTITY).map((row, rowIndex) => (
              <div className="matrix-row" key={`row-${rowIndex}`}>
                {row.map((value, columnIndex) => (
                  <span key={`cell-${rowIndex}-${columnIndex}`}>
                    {fmt(value, 5)}
                  </span>
                ))}
              </div>
            ))}
          </div>
          <dl className="facts">
            <div>
              <dt>det(R)</dt>
              <dd className="mono">{fmt(live?.rotationDet ?? 1, 5)}</dd>
            </div>
            <div>
              <dt>Rango</dt>
              <dd className="mono">{live?.rotationRank ?? 3}</dd>
            </div>
            <div>
              <dt>ker(R)</dt>
              <dd className="mono">&#123;(0, 0, 0)&#125;</dd>
            </div>
          </dl>
          <p className="card-foot">
            Rotación ortonormal: isomorfismo entre ECEF y ENU. Es la
            transformación lineal que el panel usa en vivo.
          </p>
        </article>

        <article className="card">
          <div className="card-head">
            <h2>Temas del documento</h2>
            <span className="chip">11 de 11 en vivo</span>
          </div>
          <ul className="topics">
            {topics.map((topic) => (
              <li key={topic.topic} className="topic-ready">
                <span className="topic-mark" />
                <span className="topic-name">{topic.topic}</span>
                <span className="topic-detail">{topic.detail}</span>
                <span className="topic-live mono">{topic.value}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>
      <div className="data-section">
        <DataTable telemetry={telemetry} />
      </div>
    </>
  );
}

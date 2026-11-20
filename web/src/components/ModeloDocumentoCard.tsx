import type { Vec3 } from "@dron/shared";
interface Props {
  /** Rumbo real UTS → UIS en grados (5.8263° en la ruta actual). */
  rumboReal: number;
  /** Destino real expresado en unidades del modelo académico. */
  destinoReal: Vec3;
}

/**
 * Valores fijos del documento PIERA (verificados contra el PDF). No se
 * recalculan: si el documento cambia, hay que re-verificar y actualizarlos.
 * Van con punto decimal, igual que el PDF, aunque el resto del HUD use es-CO.
 */
const DOC: { label: string; doc: string }[] = [
  { label: "Destino", doc: "A = (2, 4, 0) u" },
  { label: "Rumbo", doc: "N 26.57° E" },
  { label: "Corredor de altura", doc: "z ∈ [0.8, 1.2] u · holgura 0.2 u" },
  { label: "Plano de la ruta", doc: "2x − y = 0" },
  { label: "Zona sensible Z", doc: "(3, 2, 0) u · radio 1 u · paso 1.79 u" },
  { label: "Viento", doc: "(−1, −1, 0) m/s · 1.34 m/s en contra" },
  { label: "Plan de vuelo", doc: "1 + 2√5 + 1 ≈ 6.47 u" },
];

/** Unidad del modelo con punto decimal y sin ceros de relleno. */
const u = (value: number): string => String(Number(value.toFixed(3)));

/** Columna real: solo destino y rumbo son datos; el resto no aplica. */
const real = (label: string, rumboReal: number, destinoReal: Vec3): string => {
  if (label === "Destino") return `(${destinoReal.map(u).join(", ")}) u`;
  if (label === "Rumbo") return `${rumboReal.toFixed(2)}°`;
  return "—";
};

export function ModeloDocumentoCard({ rumboReal, destinoReal }: Props) {
  return (
    <article className="card modelo-doc">
      <div className="card-head">
        <h2>Modelo del documento</h2>
        <span className="chip">PDF ↔ ruta real</span>
      </div>
      <p className="modelo-doc-legend">
        <span className="modelo-doc-label">Parámetro</span>
        <span>Documento · modelo académico</span>
        <span>Ruta real · lo que vuela la app</span>
      </p>
      <ul className="modelo-doc-rows">
        {DOC.map(({ label, doc }) => (
          <li key={label}>
            <span className="modelo-doc-label">{label}</span>
            <span className="mono modelo-doc-doc">{doc}</span>
            <span className="mono modelo-doc-real">
              {real(label, rumboReal, destinoReal)}
            </span>
          </li>
        ))}
      </ul>
      <p className="card-foot">
        Las coordenadas del documento son simplificadas y no están a escala; esta
        simulación vuela la ruta real UTS → UIS y la reexpresa en unidades del
        modelo (1 u ≈ 890.3 m). Por eso el rumbo real de la columna derecha no
        coincide con el rumbo académico del documento.
      </p>
    </article>
  );
}

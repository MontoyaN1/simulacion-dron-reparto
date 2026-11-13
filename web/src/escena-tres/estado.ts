/**
 * Estado de carga de assets de la escena 3D. "degradado" significa que algún
 * asset crítico (GLB del dron, ortofoto o edificios) no cargó y se usó un
 * placeholder; la escena sigue funcionando pero sin ese detalle.
 */
export type EstadoEscena = "ok" | "degradado";

let estado: EstadoEscena = "ok";

export const estadoEscena = (): EstadoEscena => estado;

export const marcarDegradado = (motivo: string, detalle?: unknown): void => {
  if (estado === "ok") {
    estado = "degradado";
  }
  console.warn(`[escena] ${motivo}; usando placeholder`, detalle ?? "");
};

export const resetearEstadoEscena = (): void => {
  estado = "ok";
};

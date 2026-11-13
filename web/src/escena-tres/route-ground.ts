import { routeFrame, type Vec3 } from "@dron/shared";
import corridorDataset from "./corridor-ground.json";

/**
 * Tabla de alturas del corredor (a lo largo de la ruta × lateral), muestreada
 * UNA VEZ contra el terreno real y cacheada en `corridor-ground.json`.
 *
 * Sustituye el coste que teníamos por frame: pedir el tile más detallado bajo
 * la posición del dron en *cada fotograma* ahogaba el hilo principal.
 *
 * shortcut: no hay muestreo en vivo si el archivo pierde cobertura (hoy cubre
 * el 100 %); si eso cambia, re-hornear `corridor-ground.json`.
 */
const PASO_ALONG = 50;
const LATERAL: readonly number[] = [-150, -75, 0, 75, 150];

const ROUTE_LENGTH = routeFrame.distanceMeters;
const DIRECCION: Vec3 = [
  routeFrame.displacement[0] / ROUTE_LENGTH,
  routeFrame.displacement[1] / ROUTE_LENGTH,
  0,
];
const LADO: Vec3 = [-DIRECCION[1], DIRECCION[0], 0];

const clave = (alongIndex: number, lateralIndex: number): number =>
  alongIndex * LATERAL.length + lateralIndex;

export class RouteGroundTable {
  private readonly grid = new Map<number, number>();
  private readonly filasAlong = Math.floor(ROUTE_LENGTH / PASO_ALONG);

  constructor() {
    const datos =
      (corridorDataset as unknown as { datos: [number, number, number][] }).datos ?? [];
    for (const [alongIndex, lateralIndex, altura] of datos) {
      if (alongIndex > this.filasAlong || lateralIndex < 0 || lateralIndex >= LATERAL.length) {
        continue;
      }
      this.grid.set(clave(alongIndex, lateralIndex), altura);
    }
  }

  get disponible(): boolean {
    return this.grid.size > 0;
  }

  private alturaEn(alongIndex: number, lateralIndex: number): number | null {
    if (lateralIndex < 0 || lateralIndex >= LATERAL.length) return null;
    const clamped = Math.max(0, Math.min(this.filasAlong, alongIndex));
    const crisp = this.grid.get(clave(clamped, lateralIndex));
    if (crisp !== undefined) return crisp;
    // La fila más cercana con dato (bordes del corredor y extremos de la ruta).
    for (let delta = 1; delta <= this.filasAlong; delta += 1) {
      const arriba = this.grid.get(clave(clamped - delta, lateralIndex));
      if (arriba !== undefined) return arriba;
      const abajo = this.grid.get(clave(clamped + delta, lateralIndex));
      if (abajo !== undefined) return abajo;
    }
    return null;
  }

  /**
   * Altura AGL (relativa al ancla) del terreno real bajo un punto ENU,
   * interpolando bilinealmente la tabla del corredor.
   */
  agl(enu: Vec3): number | null {
    if (!this.disponible) return null;
    const along = enu[0] * DIRECCION[0] + enu[1] * DIRECCION[1];
    const lateral = enu[0] * LADO[0] + enu[1] * LADO[1];

    const alongExacto = Math.max(0, Math.min(this.filasAlong, along / PASO_ALONG));
    const a0 = Math.floor(alongExacto);
    const a1 = Math.min(a0 + 1, this.filasAlong);
    const pesoAlong = alongExacto - a0;

    // Las columnas laterales están a 75 m uniformes entre sí.
    const pasoLateral = LATERAL[1] - LATERAL[0];
    const lateralExacto = Math.max(
      0,
      Math.min(LATERAL.length - 1, (lateral - LATERAL[0]) / pasoLateral),
    );
    const l0 = Math.floor(lateralExacto);
    const l1 = Math.min(l0 + 1, LATERAL.length - 1);
    const pesoLateral = lateralExacto - l0;

    const altura = (ai: number, li: number): number | null => this.alturaEn(ai, li);
    const h00 = altura(a0, l0);
    const h01 = altura(a0, l1);
    const h10 = altura(a1, l0);
    const h11 = altura(a1, l1);

    if (h00 === null || h01 === null || h10 === null || h11 === null) {
      // Falta una esquina (bordes del corredor): usa la fila disponible.
      const cerca = h00 ?? h01;
      const lejos = h10 ?? h11;
      if (cerca === null || lejos === null) return null;
      return cerca + (lejos - cerca) * pesoAlong;
    }
    const abajo = h00 + (h01 - h00) * pesoLateral;
    const arriba = h10 + (h11 - h10) * pesoLateral;
    return abajo + (arriba - abajo) * pesoAlong;
  }
}

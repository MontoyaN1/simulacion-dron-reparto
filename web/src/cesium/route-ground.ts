import * as Cesium from "cesium";
import { routeFrame, type Vec3 } from "@dron/shared";
import type { WorldFrame } from "./world";

/**
 * Tabla de alturas del corredor (a lo largo de la ruta × lateral), muestreada
 * UNA VEZ contra el terreno real de Cesium ion y cacheada en `localStorage`.
 *
 * Sustituye el coste que teníamos por frame: `TerrainSampling.request` pedía
 * el tile más detallado bajo la posición del dron en *cada fotograma*, lo que
 * ahogaba el hilo principal y frenaba la carga del mapa.
 */
const CLAVE_CACHE = "dron:alturas-corredor:v2";
const PASO_ALONG = 50;
const LATERAL: readonly number[] = [-150, -75, 0, 75, 150];

const ROUTE_LENGTH = routeFrame.distanceMeters;
const DIRECCION: Vec3 = [
  routeFrame.displacement[0] / ROUTE_LENGTH,
  routeFrame.displacement[1] / ROUTE_LENGTH,
  0,
];
const LADO: Vec3 = [-DIRECCION[1], DIRECCION[0], 0];

const enuDeCorredor = (along: number, lateral: number): Vec3 => [
  DIRECCION[0] * along + LADO[0] * lateral,
  DIRECCION[1] * along + LADO[1] * lateral,
  0,
];

const clave = (alongIndex: number, lateralIndex: number): number =>
  alongIndex * LATERAL.length + lateralIndex;

export interface RouteGroundOptions {
  readonly world: WorldFrame;
  readonly terrain: Cesium.TerrainProvider;
}

const CACHE_VERSION = 2;

export class RouteGroundTable {
  private ready = false;
  /** Altura absoluta (msnm) por índice `clave(along, lateral)`. */
  private readonly grid = new Map<number, number>();
  private readonly filasAlong = Math.floor(ROUTE_LENGTH / PASO_ALONG);

  get disponible(): boolean {
    return this.ready;
  }

  /** Muestrea el corredor o restaura la copia guardada en `localStorage`. */
  async cargar({ world, terrain }: RouteGroundOptions): Promise<void> {
    if (this.ready) return;
    const guardada = RouteGroundTable.leerCache();
    if (guardada) {
      for (const [alongIndex, lateralIndex, altura] of guardada) {
        this.grid.set(clave(alongIndex, lateralIndex), altura);
      }
      this.ready = true;
      return;
    }

    const cartos: Cesium.Cartographic[] = [];
    const alongIdx: number[] = [];
    const latIdx: number[] = [];
    for (let along = 0; along <= ROUTE_LENGTH; along += PASO_ALONG) {
      const alongIndex = Math.round(along / PASO_ALONG);
      LATERAL.forEach((lateral: number) => {
        const lateralIndex = LATERAL.indexOf(lateral);
        const punto = enuDeCorredor(along, lateral);
        const fixed = Cesium.Matrix4.multiplyByPoint(
          world.matrix,
          new Cesium.Cartesian3(punto[0], punto[1], 0),
          new Cesium.Cartesian3(),
        );
        const carto = Cesium.Cartographic.fromCartesian(fixed);
        if (!carto) return;
        cartos.push(carto.clone() as Cesium.Cartographic);
        alongIdx.push(alongIndex);
        latIdx.push(lateralIndex);
      });
    }
    if (cartos.length < 50) throw new Error("Corredor insuficiente para muestrear");

    const samples = await Cesium.sampleTerrainMostDetailed(terrain, cartos);
    samples.forEach((sample, index) => {
      if (!sample || !Number.isFinite(sample.height)) return;
      this.grid.set(clave(alongIdx[index], latIdx[index]), sample.height);
    });
    if (this.grid.size < cartos.length * 0.6) {
      throw new Error("Muestreo del corredor incompleto");
    }

    const datos: [number, number, number][] = [];
    this.grid.forEach((altura, key) => {
      datos.push([Math.floor(key / LATERAL.length), key % LATERAL.length, altura]);
    });
    try {
      localStorage.setItem(CLAVE_CACHE, JSON.stringify({ v: CACHE_VERSION, datos }));
    } catch {
      // Sin espacio en `localStorage`: la tabla vive en memoria y se re-muestrea al recargar.
    }
    this.ready = true;
  }

  private static leerCache(): [number, number, number][] | null {
    try {
      const raw = localStorage.getItem(CLAVE_CACHE);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { v?: number; datos?: unknown };
      if (parsed.v !== CACHE_VERSION || !Array.isArray(parsed.datos)) return null;
      return (parsed.datos as unknown[]).filter(
        (item): item is [number, number, number] =>
          Array.isArray(item) &&
          typeof item[0] === "number" &&
          typeof item[1] === "number" &&
          typeof item[2] === "number",
      );
    } catch {
      return null;
    }
  }

  private alturaEn(alongIndex: number, lateralIndex: number): number | null {
    if (lateralIndex < 0 || lateralIndex >= LATERAL.length) return null;
    const clamped = Math.max(0, Math.min(this.filasAlong, alongIndex));
    const crisp = this.grid.get(clave(clamped, lateralIndex));
    if (crisp !== undefined) return crisp;
    // Lafila más cercana con dato (bordes del corredor y extremos de la ruta).
    for (let delta = 1; delta <= this.filasAlong; delta += 1) {
      const arriba = this.grid.get(clave(clamped - delta, lateralIndex));
      if (arriba !== undefined) return arriba;
      const abajo = this.grid.get(clave(clamped + delta, lateralIndex));
      if (abajo !== undefined) return abajo;
    }
    return null;
  }

  /** Altura AGL (relativa al ancla) del terreno real bajo un punto ENU. */
  /**
   * Altura AGL (relativa al ancla) del terreno real bajo un punto ENU,
   * interpolando bilinealmente la tabla del corredor.
   */
  agl(enu: Vec3): number | null {
    if (!this.ready) return null;
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

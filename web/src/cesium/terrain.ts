import * as Cesium from "cesium";
import { routeGroundHeight, type WorldFrame } from "./world";
import type { Vec3 } from "@dron/shared";

const CACHE_MAX = 512;

interface CachedSample {
  readonly carto: Cesium.Cartographic;
  pending: boolean;
  height: number | null;
}

/**
 * Resuelve la altura del terreno visible en tres niveles, de más a menos fiable:
 *
 * 1. `globe.getHeight()` — la malla que el usuario está viendo en este momento.
 *    Es sincrónica y coincide exactamente con la superficie renderizada, así que
 *    el dron nunca queda enterrado aunque el ancla esté desplazada.
 * 2. Muestreo asíncrono (`sampleTerrainMostDetailed`) cacheado por celda.
 * 3. Rejilla offline `terrain-grid` como último recurso (sin red).
 */
export class TerrainSampling {
  private readonly cache = new Map<number, CachedSample>();
  private readonly lastGood = new Map<number, number>();

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly world: WorldFrame,
  ) {}

  private key(enu: Vec3): number {
    return Math.round(enu[0] * 4) * 100003 + Math.round(enu[1] * 4);
  }

  /**
   * Latitud/longitud de un punto ENU sin consultar la altura: usa la matriz del
   * marco directamente. Si usara `world.enu()` y el mundo a su vez pidiera la
   * altura a este muestreador, se produciría una recursión infinita.
   */
  private cartoAt(enu: Vec3): Cesium.Cartographic | null {
    const local = new Cesium.Cartesian3(enu[0], enu[1], 0);
    const fixed = Cesium.Matrix4.multiplyByPoint(
      this.world.matrix,
      local,
      new Cesium.Cartesian3(),
    );
    return Cesium.Cartographic.fromCartesian(fixed);
  }

  /** Lanza (o reutiliza) el muestreo asíncrono de una celda. */
  request(enu: Vec3): void {
    const key = this.key(enu);
    if (this.cache.has(key)) return;
    const carto = this.cartoAt(enu);
    if (!carto) return;
    const entry: CachedSample = { carto, pending: true, height: null };
    this.cache.set(key, entry);
    if (this.cache.size > CACHE_MAX) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    const terrain = this.viewer.scene.terrainProvider;
    const promise = Cesium.sampleTerrainMostDetailed(terrain, [carto.clone() as Cesium.Cartographic]);
    Promise.resolve(promise)
      .then((samples) => {
        const sample = samples[0];
        if (sample && Number.isFinite(sample.height)) {
          entry.height = sample.height;
          this.lastGood.set(key, sample.height);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        entry.pending = false;
      });
  }

  /** Precalienta una lista de puntos (se usa para las dos zonas de la misión). */
  async prewarm(points: readonly Vec3[]): Promise<void> {
    const entries = points
      .map((point) => ({ point, carto: this.cartoAt(point) }))
      .filter((entry): entry is { point: Vec3; carto: Cesium.Cartographic } => entry.carto !== null);
    if (entries.length === 0) return;
    try {
      const terrain = this.viewer.scene.terrainProvider;
      const samples = await Cesium.sampleTerrainMostDetailed(
        terrain,
        entries.map((entry) => entry.carto.clone() as Cesium.Cartographic),
      );
      entries.forEach((entry, index) => {
        const sample = samples[index];
        if (!sample || !Number.isFinite(sample.height)) return;
        this.lastGood.set(this.key(entry.point), sample.height);
      });
    } catch {
      // sin red: se queda la rejilla offline
    }
  }

  /** Altura AGL real del terreno bajo un punto ENU (en metros sobre el ancla). */
  agl(enu: Vec3): number {
    const globe = this.viewer.scene.globe;
    const carto = this.cartoAt(enu);
    if (carto) {
      const rendered = globe.getHeight(carto);
      if (typeof rendered === "number" && Number.isFinite(rendered)) {
        return rendered - this.world.baseHeight;
      }
    }

    const key = this.key(enu);
    const cached = this.cache.get(key);
    if (cached && !cached.pending && cached.height !== null) {
      return cached.height - this.world.baseHeight;
    }
    const known = this.lastGood.get(key);
    if (known !== undefined) return known - this.world.baseHeight;

    return routeGroundHeight(enu);
  }
}

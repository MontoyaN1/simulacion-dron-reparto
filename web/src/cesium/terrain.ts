import * as Cesium from "cesium";
import { routeGroundHeight, type WorldFrame } from "./world";
import type { RouteGroundTable } from "./route-ground";
import type { Vec3 } from "@dron/shared";

/**
 * Resuelve la altura del terreno en tres niveles, de más a menos fiable:
 *
 * 1. `globe.getHeight()` — la malla que el usuario está viendo en este momento.
 *    Es sincrónica y coincide exactamente con la superficie renderizada, así que
 *    el dron nunca queda enterrado aunque el ancla esté desplazada.
 * 2. Tabla del corredor precalculada (sin red en tiempo de vuelo).
 * 3. Rejilla offline `terrain-grid` como último recurso.
 *
 * Importante: ahora mismo NO se hace ninguna petición de terreno por frame.
 * Antes `request()` pedía el tile más detallado bajo el dron en cada
 * fotograma y eso ahogaba el hilo principal (5 fps) y la carga del mapa.
 */
export class TerrainSampling {
  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly world: WorldFrame,
    private readonly corredor: RouteGroundTable | null = null,
  ) {}

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

  /** Altura AGL real del terreno bajo un punto ENU (metros sobre el ancla). */
  agl(enu: Vec3): number {
    const globe = this.viewer.scene.globe;
    const carto = this.cartoAt(enu);
    if (carto) {
      const rendered = globe.getHeight(carto);
      if (typeof rendered === "number" && Number.isFinite(rendered)) {
        return rendered - this.world.baseHeight;
      }
    }
    const deTabla = this.corredor?.agl(enu);
    if (deTabla !== null && deTabla !== undefined && Number.isFinite(deTabla)) {
      return deTabla - this.world.baseHeight;
    }
    return routeGroundHeight(enu);
  }
}

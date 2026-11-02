import * as Cesium from "cesium";
import { geodeticToEnu, routeFrame, type Vec3 } from "@dron/shared";
import rangeFootprintGrounds from "./ground-footprints.json";
import type { WorldFrame } from "./world";

/** Clave de la muestra de altura: longitud/latitud del primer punto del anillo. */
const groundKey = (lon: number, lat: number): string => `${lon.toFixed(7)}:${lat.toFixed(7)}`;

const DATASET = rangeFootprintGrounds as Record<string, number>;

const datasetGround = (lon: number, lat: number): number | null => {
  const value = DATASET[groundKey(lon, lat)];
  return typeof value === "number" ? value : null;
};

interface BuildingFeature {
  readonly properties?: {
    readonly height?: number | null;
    readonly levels?: number | null;
    readonly building?: string | null;
  };
  readonly geometry?: {
    readonly type?: string;
    readonly coordinates?: readonly (readonly (readonly [number, number])[])[];
  };
}

const PALETTE = ["#b8b0a3", "#a89583", "#b6bfc3", "#c0b39b", "#9fa9ad", "#b99a86"];

const pointInside = (point: readonly number[], ring: readonly Vec3[]): boolean => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const a = ring[index];
    const b = ring[previous];
    const crosses =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
};

const buildingHeight = (feature: BuildingFeature): number => {
  const height = feature.properties?.height;
  if (typeof height === "number" && Number.isFinite(height) && height > 1) return height;
  const levels = feature.properties?.levels;
  if (typeof levels === "number" && levels > 0) return levels * 3.2 + 1.5;
  return 9;
};

/**
 * Edificios localmente extruidos (718 huellas OSM del corredor).
 *
 * Devuelve una colección de primitivas troceadas cada 500 m del corredor:
 * 718 edificios en una sola primitiva tenían un bounding sphere del corredor
 * completo y Cesium dibujaba TODA la ciudad en cada frame, sin culling.
 */
export const loadBuildingPrimitive = async (
  viewer: Cesium.Viewer,
  world: WorldFrame,
  terrain?: Cesium.TerrainProvider,
): Promise<Cesium.PrimitiveCollection | null> => {
  try {
    const response = await fetch("/api/buildings");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const collection = (await response.json()) as { features?: BuildingFeature[] };

    // Alturas exactas: primero el archivo versionado (instantáneo, sin red).
    // Las huellas que falten se muestrean en vivo: eran el minuto de espera
    // del arranque.
    const pendientes = (collection.features ?? [])
      .filter((feature) => feature.geometry?.type === "Polygon" && feature.geometry.coordinates?.[0])
      .filter((feature) => {
        const [lon, lat] = feature.geometry!.coordinates![0][0];
        return datasetGround(lon, lat) === null;
      })
      .map((feature) =>
        Cesium.Cartographic.fromDegrees(
          feature.geometry!.coordinates![0][0][0],
          feature.geometry!.coordinates![0][0][1],
        ),
      );
    const sampled: (number | null)[] = [];
    if (pendientes.length > 0 && terrain) {
      try {
        const obtenidas = await Cesium.sampleTerrainMostDetailed(
          terrain,
          pendientes.map((carto) => carto.clone() as Cesium.Cartographic),
        );
        for (const sample of obtenidas) {
          sampled.push(sample && Number.isFinite(sample.height) ? sample.height : null);
        }
      } catch {
        sampled.length = 0;
      }
    }
    const byAnchor = new Map<string, number>();
    let cursor = 0;
    for (const anchor of pendientes) {
      const value = sampled[cursor] ?? null;
      cursor += 1;
      if (value !== null) byAnchor.set(groundKey(Cesium.Math.toDegrees(anchor.longitude), Cesium.Math.toDegrees(anchor.latitude)), value);
    }

    // Troceado espacial del corredor.
    const TRAMO = 500;
    const DIRECCION: Vec3 = [
      routeFrame.displacement[0] / routeFrame.distanceMeters,
      routeFrame.displacement[1] / routeFrame.distanceMeters,
      0,
    ];
    const chunks = new Map<number, Cesium.GeometryInstance[]>();
    let edificios = 0;

    for (const [index, feature] of (collection.features ?? []).entries()) {
      const ring = feature.geometry?.coordinates?.[0];
      if (feature.geometry?.type !== "Polygon" || !ring || ring.length < 4) continue;

      const localRing = ring.map(([longitude, latitude]) =>
        geodeticToEnu({ latitude, longitude, altitude: 0 }, routeFrame.originGeodetic),
      );
      if (pointInside([0, 0], localRing) || pointInside(routeFrame.displacement, localRing)) {
        continue;
      }

      let east = 0;
      let north = 0;
      for (const point of localRing) {
        east += point[0];
        north += point[1];
      }
      const center: Vec3 = [east / localRing.length, north / localRing.length, 0];
      if (Math.hypot(center[0], center[1]) < 20) continue;
      if (Math.hypot(center[0] - routeFrame.displacement[0], center[1] - routeFrame.displacement[1]) < 20) {
        continue;
      }

      const anchor = ring[0];
      const ground =
        datasetGround(anchor[0], anchor[1]) ??
        byAnchor.get(groundKey(anchor[0], anchor[1])) ??
        world.heightAt(center);
      const height = buildingHeight(feature);
      const positions = ring.map(([longitude, latitude]) =>
        Cesium.Cartesian3.fromDegrees(longitude, latitude),
      );
      const color = Cesium.Color.fromCssColorString(PALETTE[index % PALETTE.length]);
      const along = center[0] * DIRECCION[0] + center[1] * DIRECCION[1];
      const tramo = Math.max(0, Math.floor(along / TRAMO));
      const batch = chunks.get(tramo) ?? [];
      batch.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: new Cesium.PolygonHierarchy(positions),
            height: ground + 0.12,
            extrudedHeight: ground + height,
            closeTop: true,
            closeBottom: false,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
          },
        }),
      );
      chunks.set(tramo, batch);
      edificios += 1;
    }

    if (edificios === 0) return null;

    const salida = new Cesium.PrimitiveCollection();
    for (const [, sublist] of chunks) {
      salida.add(
        new Cesium.Primitive({
          geometryInstances: sublist,
          appearance: new Cesium.PerInstanceColorAppearance({
            flat: false,
            faceForward: true,
            translucent: false,
            closed: true,
          }),
          asynchronous: !import.meta.env.DEV,
          releaseGeometryInstances: true,
          allowPicking: false,
          // Sin proyección de sombra: 718 edificios como casters era el golpe
          // principal de rendimiento. Siguen recibiendo la sombra del dron.
          shadows: Cesium.ShadowMode.RECEIVE_ONLY,
        }),
      );
    }
    viewer.scene.primitives.add(salida);
    return salida;
  } catch (error) {
    console.warn("No se pudieron construir los edificios locales", error);
    return null;
  }
};

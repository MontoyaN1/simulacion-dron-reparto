import * as Cesium from "cesium";
import { geodeticToEnu, routeFrame, type Vec3 } from "@dron/shared";
import type { WorldFrame } from "./world";

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

export const loadBuildingPrimitive = async (
  viewer: Cesium.Viewer,
  world: WorldFrame,
  terrain?: Cesium.TerrainProvider,
): Promise<Cesium.Primitive | null> => {
  try {
    const response = await fetch("/api/buildings");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const collection = (await response.json()) as { features?: BuildingFeature[] };

    // Orden de impresora: primero se muestrea el terreno exacto de cada
    // centroide. Si se usa `globe.getHeight` en el momento de construir, el
    // tile cargado puede estar a baja resolución y el edificio nace decenas
    // de metros bajo el terreno (con depthTest contra terreno, invisible).
    let exactHeights: Cesium.Cartographic[] | null = null;
    if (terrain) {
      const lookups = (collection.features ?? [])
        .filter((feature) => feature.geometry?.type === "Polygon" && feature.geometry.coordinates?.[0])
        .map((feature) => Cesium.Cartographic.fromDegrees(
          feature.geometry!.coordinates![0][0][0],
          feature.geometry!.coordinates![0][0][1],
        ));
      if (lookups.length > 0) {
        try {
          exactHeights = await Cesium.sampleTerrainMostDetailed(
            terrain,
            lookups.map((carto) => carto.clone() as Cesium.Cartographic),
          );
        } catch {
          exactHeights = null;
        }
      }
    }
    const byAnchor = new Map<string, number>();
    if (exactHeights) {
      const anchors = (collection.features ?? [])
        .filter((feature) => feature.geometry?.type === "Polygon" && feature.geometry.coordinates?.[0])
        .map((feature) => feature.geometry!.coordinates![0][0]);
      anchors.forEach(([longitude, latitude], index) => {
        const sample = exactHeights![index];
        if (sample && Number.isFinite(sample.height)) {
          byAnchor.set(`${longitude.toFixed(7)}:${latitude.toFixed(7)}`, sample.height);
        }
      });
    }

    const instances: Cesium.GeometryInstance[] = [];

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
        byAnchor.get(`${anchor[0].toFixed(7)}:${anchor[1].toFixed(7)}`) ??
        world.heightAt(center);
      const height = buildingHeight(feature);
      const positions = ring.map(([longitude, latitude]) =>
        Cesium.Cartesian3.fromDegrees(longitude, latitude),
      );
      const color = Cesium.Color.fromCssColorString(PALETTE[index % PALETTE.length]);
      instances.push(
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
    }

    if (instances.length === 0) return null;
    const primitive = new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({
        flat: false,
        faceForward: true,
        translucent: false,
        closed: true,
      }),
      asynchronous: true,
      releaseGeometryInstances: true,
      allowPicking: false,
      shadows: Cesium.ShadowMode.ENABLED,
    });
    viewer.scene.primitives.add(primitive);
    return primitive;
  } catch (error) {
    console.warn("No se pudieron construir los edificios locales", error);
    return null;
  }
};

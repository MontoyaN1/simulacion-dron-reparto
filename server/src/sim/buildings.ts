import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FootprintBuilding } from "@dron/shared";
import { geodeticToEnu, UTS } from "@dron/shared";

interface GeoJsonGeometry {
  readonly type: "Polygon";
  readonly coordinates: readonly (readonly (readonly [number, number])[])[];
}

interface GeoJsonFeature {
  readonly type: "Feature";
  readonly id?: number | string;
  readonly properties: {
    readonly height?: number | null;
    readonly levels?: number | null;
    readonly building?: string | null;
    readonly name?: string | null;
  };
  readonly geometry: GeoJsonGeometry;
}

export interface GeoJsonCollection {
  readonly type: "FeatureCollection";
  readonly metadata?: {
    readonly source?: string;
    readonly generatedAt?: string;
    readonly buildings?: number;
    readonly corridorRadiusMeters?: number;
  };
  readonly features: readonly GeoJsonFeature[];
}

export interface BuildingDataset {
  readonly geojson: GeoJsonCollection | null;
  readonly footprints: readonly FootprintBuilding[];
  readonly count: number;
}

const datasetUrl = new URL("../../../data/buildings.geojson", import.meta.url);

const fallbackHeight = (feature: GeoJsonFeature): number => {
  const height = feature.properties.height;
  if (typeof height === "number" && Number.isFinite(height) && height > 1) return height;
  const levels = feature.properties.levels;
  if (typeof levels === "number" && levels > 0) return levels * 3.2 + 1.5;
  return 9;
};

export const loadBuildings = (): BuildingDataset => {
  try {
    const raw = readFileSync(fileURLToPath(datasetUrl), "utf8");
    const geojson = JSON.parse(raw) as GeoJsonCollection;
    const footprints: FootprintBuilding[] = [];

    for (const feature of geojson.features) {
      const ring = feature.geometry?.coordinates?.[0];
      if (!ring || ring.length < 4) continue;
      const footprint = ring.map(([longitude, latitude]) => {
        const [east, north] = geodeticToEnu({ latitude, longitude, altitude: 0 }, UTS.geodetic);
        return [east, north] as const;
      });
      footprints.push({ footprint, height: fallbackHeight(feature) });
    }

    return { geojson, footprints, count: footprints.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[buildings] Sin datos locales (${message}); se usara la ruta recta.`);
    return { geojson: null, footprints: [], count: 0 };
  }
};

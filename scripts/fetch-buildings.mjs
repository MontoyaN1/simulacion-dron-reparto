import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UTS = { lat: 7.1051164, lon: -73.123524 };
const UIS = { lat: 7.1409311, lon: -73.1198652 };
const CORRIDOR_RADIUS_METERS = 450;
const BBOX_MARGIN_DEGREES = 0.0045;
const METERS_PER_DEGREE_LAT = 110574;
const METERS_PER_DEGREE_LON = 111320 * Math.cos((UTS.lat * Math.PI) / 180);

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(here, "../data/buildings.geojson");

const toLocal = (lat, lon) => [
  (lon - UTS.lon) * METERS_PER_DEGREE_LON,
  (lat - UTS.lat) * METERS_PER_DEGREE_LAT,
];

const segmentDistance = (point, start, end) => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared),
  );
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
};

const parseNumber = (value) => {
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const DEFAULT_HEIGHTS = {
  house: 6,
  detached: 6,
  residential: 12,
  apartments: 18,
  commercial: 12,
  retail: 8,
  industrial: 8,
  school: 12,
  university: 14,
  hospital: 22,
  hotel: 26,
  church: 16,
  garage: 4,
  garages: 4,
  hut: 3,
  shed: 3,
  yes: 8,
};

const buildingHeight = (tags) => {
  const explicit = parseNumber(tags.height);
  if (explicit && explicit > 1) return Math.min(140, explicit);
  const levels = parseNumber(tags["building:levels"]);
  if (levels && levels > 0) return Math.min(140, levels * 3.2 + 1.5);
  const fallback = DEFAULT_HEIGHTS[tags.building] ?? 9;
  return fallback;
};

const buildQuery = () => {
  const south = Math.min(UTS.lat, UIS.lat) - BBOX_MARGIN_DEGREES;
  const north = Math.max(UTS.lat, UIS.lat) + BBOX_MARGIN_DEGREES;
  const west = Math.min(UTS.lon, UIS.lon) - BBOX_MARGIN_DEGREES;
  const east = Math.max(UTS.lon, UIS.lon) + BBOX_MARGIN_DEGREES;
  return `[out:json][timeout:120];
way["building"](${south.toFixed(6)},${west.toFixed(6)},${north.toFixed(6)},${east.toFixed(6)});
out geom tags;`;
};

const requestOverpass = async (query) => {
  let lastError;
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "simulacion-dron-reparto/0.2 (proyecto academico UTS)",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) throw new Error(`${endpoint} respondio ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      console.warn(`Overpass fallo en ${endpoint}: ${error.message}`);
    }
  }
  throw lastError ?? new Error("No fue posible consultar Overpass");
};

const query = buildQuery();
console.log(`Consultando Overpass (${CORRIDOR_RADIUS_METERS} m de corredor)...`);
const data = await requestOverpass(query);

const start = toLocal(UTS.lat, UTS.lon);
const end = toLocal(UIS.lat, UIS.lon);
const features = [];
let discarded = 0;

for (const element of data.elements ?? []) {
  if (element.type !== "way" || !Array.isArray(element.geometry)) continue;
  const ring = [];
  let centroidEast = 0;
  let centroidNorth = 0;
  for (const node of element.geometry) {
    const local = toLocal(node.lat, node.lon);
    ring.push(local);
    centroidEast += local[0];
    centroidNorth += local[1];
  }
  if (ring.length < 4) continue;
  centroidEast /= ring.length;
  centroidNorth /= ring.length;

  if (segmentDistance([centroidEast, centroidNorth], start, end) > CORRIDOR_RADIUS_METERS) {
    discarded += 1;
    continue;
  }

  const tags = element.tags ?? {};
  const height = buildingHeight(tags);
  const coordinates = ring.map(([east, north]) => [
    Number((UTS.lon + east / METERS_PER_DEGREE_LON).toFixed(6)),
    Number((UTS.lat + north / METERS_PER_DEGREE_LAT).toFixed(6)),
  ]);
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([...first]);

  features.push({
    type: "Feature",
    id: element.id,
    properties: {
      height: Number(height.toFixed(1)),
      levels: parseNumber(tags["building:levels"]) ?? null,
      building: tags.building ?? "yes",
      name: tags.name ?? null,
    },
    geometry: { type: "Polygon", coordinates: [coordinates] },
  });
}

features.sort((a, b) => a.id - b.id);
const collection = {
  type: "FeatureCollection",
  metadata: {
    source: "OpenStreetMap / Overpass API",
    generatedAt: new Date().toISOString(),
    corridorRadiusMeters: CORRIDOR_RADIUS_METERS,
    buildings: features.length,
    toleranceMeters: 0.12,
  },
  features,
};

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(collection));

const total = (data.elements ?? []).length;
console.log(
  `Listo: ${features.length} edificios dentro del corredor (${discarded} descartados de ${total}).`,
);
console.log(`Archivo: ${path.relative(process.cwd(), output)}`);

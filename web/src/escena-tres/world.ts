import { routeFrame, type Vec3 } from "@dron/shared";
import { TERRAIN_ALONG, TERRAIN_HEIGHTS, TERRAIN_LATERAL } from "./terrain-grid";

const ROUTE_LENGTH = routeFrame.distanceMeters;
const ROUTE_DIRECTION: Vec3 = [
  routeFrame.displacement[0] / ROUTE_LENGTH,
  routeFrame.displacement[1] / ROUTE_LENGTH,
  0,
];
const LATERAL_DIRECTION: Vec3 = [-ROUTE_DIRECTION[1], ROUTE_DIRECTION[0], 0];

const bracket = (values: readonly number[], value: number): [number, number, number] => {
  const clamped = Math.max(values[0], Math.min(values[values.length - 1], value));
  let low = 0;
  let high = values.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (values[middle] <= clamped) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const span = values[high] - values[low];
  const fraction = span > 0 ? (clamped - values[low]) / span : 0;
  return [low, high, fraction];
};

/** Altura del terreno (m sobre el ancla) interpolada de la rejilla offline. */
export const routeGroundHeight = (vector: Vec3): number => {
  const along = vector[0] * ROUTE_DIRECTION[0] + vector[1] * ROUTE_DIRECTION[1];
  const lateral = vector[0] * LATERAL_DIRECTION[0] + vector[1] * LATERAL_DIRECTION[1];
  const [rowA, rowB, rowFraction] = bracket(TERRAIN_ALONG, along);
  const [columnA, columnB, columnFraction] = bracket(TERRAIN_LATERAL, lateral);

  const h00 = TERRAIN_HEIGHTS[rowA][columnA];
  const h10 = TERRAIN_HEIGHTS[rowB][columnA];
  const h01 = TERRAIN_HEIGHTS[rowA][columnB];
  const h11 = TERRAIN_HEIGHTS[rowB][columnB];

  const bottom = h00 + (h10 - h00) * rowFraction;
  const top = h01 + (h11 - h01) * rowFraction;
  return bottom + (top - bottom) * columnFraction;
};

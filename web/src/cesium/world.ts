import * as Cesium from "cesium";
import { routeFrame, type Vec3 } from "@dron/shared";
import { BASE_ALTITUDE_METERS } from "./constants";
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

export interface WorldFrame {
  readonly origin: Cesium.Cartesian3;
  readonly destination: Cesium.Cartesian3;
  readonly matrix: Cesium.Matrix4;
  readonly enu: (vector: Vec3) => Cesium.Cartesian3;
  readonly ground: (vector: Vec3) => Cesium.Cartesian3;
  readonly offset: (vector: Vec3, dz: number) => Cesium.Cartesian3;
  readonly setGround: (baseMeters: number, terrain: boolean) => void;
  readonly heightAt: (vector: Vec3) => number;
  readonly baseHeight: number;
}

export const createWorldFrame = (): WorldFrame => {
  const origin = Cesium.Cartesian3.fromDegrees(
    routeFrame.originGeodetic.longitude,
    routeFrame.originGeodetic.latitude,
    BASE_ALTITUDE_METERS,
  );
  const matrix = Cesium.Transforms.eastNorthUpToFixedFrame(origin);

  let baseHeight = BASE_ALTITUDE_METERS;
  let useTerrain = false;

  const height = (vector: Vec3): number =>
    baseHeight + (useTerrain ? routeGroundHeight(vector) : 0);

  const project = (vector: Vec3, dz = 0): Cesium.Cartesian3 =>
    Cesium.Matrix4.multiplyByPoint(
      matrix,
      new Cesium.Cartesian3(
        vector[0],
        vector[1],
        vector[2] + height(vector) + dz,
      ),
      new Cesium.Cartesian3(),
    );

  const frame: WorldFrame = {
    origin,
    get destination() {
      return project(routeFrame.displacement);
    },
    matrix,
    enu: (vector) => project(vector),
    ground: (vector) => project([vector[0], vector[1], 0]),
    offset: (vector, dz) => project(vector, dz),
    setGround: (baseMeters, terrain) => {
      baseHeight = baseMeters;
      useTerrain = terrain;
    },
    heightAt: (vector) => height(vector),
    get baseHeight() {
      return baseHeight;
    },
  };

  return frame;
};

export const enuHeadingToQuaternion = (
  position: Cesium.Cartesian3,
  headingDeg: number,
): Cesium.Quaternion =>
  Cesium.Transforms.headingPitchRollQuaternion(
    position,
    new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(headingDeg), 0, 0),
  );

export const polylinePositions = (
  points: readonly Vec3[],
  world: WorldFrame,
): Cesium.Cartesian3[] => points.map((point) => world.enu(point));

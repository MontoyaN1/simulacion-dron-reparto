import * as Cesium from "cesium";
import { routeFrame, type Vec3 } from "@dron/shared";
import { BASE_ALTITUDE_METERS } from "./constants";

export interface WorldFrame {
  readonly origin: Cesium.Cartesian3;
  readonly destination: Cesium.Cartesian3;
  readonly matrix: Cesium.Matrix4;
  readonly enu: (vector: Vec3) => Cesium.Cartesian3;
  readonly ground: (vector: Vec3) => Cesium.Cartesian3;
  readonly offset: (vector: Vec3, dz: number) => Cesium.Cartesian3;
}

export const createWorldFrame = (): WorldFrame => {
  const origin = Cesium.Cartesian3.fromDegrees(
    routeFrame.originGeodetic.longitude,
    routeFrame.originGeodetic.latitude,
    BASE_ALTITUDE_METERS,
  );
  const matrix = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  const project = (vector: Vec3, dz = 0): Cesium.Cartesian3 =>
    Cesium.Matrix4.multiplyByPoint(
      matrix,
      new Cesium.Cartesian3(vector[0], vector[1], vector[2] + dz),
      new Cesium.Cartesian3(),
    );

  return {
    origin,
    destination: project(routeFrame.displacement),
    matrix,
    enu: (vector) => project(vector),
    ground: (vector) => project([vector[0], vector[1], 0]),
    offset: (vector, dz) => project(vector, dz),
  };
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

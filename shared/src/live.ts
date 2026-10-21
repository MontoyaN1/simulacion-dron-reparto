import type { Mat3 } from "./math/matrix";
import { determinant, fromColumns, rank } from "./math/matrix";
import { add, cross, dot, norm, normalize, scale, sub } from "./math/vec3";
import type { Vec3 } from "./math/vec3";

const UP: Vec3 = [0, 0, 1];
const NORTH: Vec3 = [0, 1, 0];
const MIN_HEADING_SPEED = 0.25;

export interface LiveAlgebra {
  readonly position: Vec3;
  readonly ground: Vec3;
  readonly altitude: number;
  readonly distanceFromOrigin: number;
  readonly heading: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly along: number;
  readonly lateral: number;
  readonly northDot: number;
  readonly bearingDeg: number;
  readonly speed: number;
  readonly rotatedSpeed: number;
  readonly reconstructionError: number;
  readonly directionsRank: number;
  readonly directionsDet: number;
  readonly rotationDet: number;
  readonly rotationRank: number;
}

const horizontalUnit = (vector: Vec3): Vec3 | null => {
  const flat: Vec3 = [vector[0], vector[1], 0];
  return norm(flat) >= MIN_HEADING_SPEED ? normalize(flat) : null;
};

export const liveAlgebra = (
  position: Vec3,
  velocity: Vec3,
  rotation: Mat3,
  fallbackDirection: Vec3,
): LiveAlgebra => {
  const heading =
    horizontalUnit(velocity) ?? horizontalUnit(fallbackDirection) ?? NORTH;
  const right = cross(UP, heading);
  const along = dot(position, heading);
  const lateral = dot(position, right);
  const altitude = position[2];
  const reconstructed = add(
    add(scale(along, heading), scale(lateral, right)),
    scale(altitude, UP),
  );
  const rotated = [dot(rotation[0], velocity), dot(rotation[1], velocity), dot(rotation[2], velocity)] as const;
  const directions = fromColumns(heading, right, UP);
  const bearingRad = Math.atan2(heading[0], heading[1]);

  return {
    position,
    ground: [position[0], position[1], 0],
    altitude,
    distanceFromOrigin: norm(position),
    heading,
    right,
    up: UP,
    along,
    lateral,
    northDot: dot(velocity, NORTH),
    bearingDeg: ((bearingRad * 180) / Math.PI + 360) % 360,
    speed: norm(velocity),
    rotatedSpeed: norm(rotated),
    reconstructionError: norm(sub(position, reconstructed)),
    directionsRank: rank(directions),
    directionsDet: determinant(directions),
    rotationDet: determinant(rotation),
    rotationRank: rank(rotation),
  };
};

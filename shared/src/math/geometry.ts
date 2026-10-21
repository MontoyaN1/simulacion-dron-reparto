import type { Mat3 } from "./matrix";
import { diag, multiplyVec } from "./matrix";
import type { Vec3 } from "./vec3";
import { add, cross, dot, isZero, norm, scale, sub } from "./vec3";

export interface Line3 {
  readonly point: Vec3;
  readonly direction: Vec3;
}

export const line3 = (point: Vec3, direction: Vec3): Line3 => ({ point, direction });

export const pointAt = (line: Line3, parameter: number): Vec3 =>
  add(line.point, scale(parameter, line.direction));

export const containsPoint = (line: Line3, point: Vec3, epsilon = 1e-7): boolean => {
  const offset = sub(point, line.point);
  return isZero(cross(offset, line.direction), epsilon * Math.max(1, norm(line.direction)));
};

export const parameterOf = (line: Line3, point: Vec3): number => {
  const directionSquared = dot(line.direction, line.direction);
  if (directionSquared < 1e-12) {
    throw new Error("La recta no tiene direccion");
  }
  return dot(sub(point, line.point), line.direction) / directionSquared;
};

export const transformLine = (line: Line3, matrix: Mat3, offset: Vec3 = [0, 0, 0]): Line3 => ({
  point: add(multiplyVec(matrix, line.point), offset),
  direction: multiplyVec(matrix, line.direction),
});

export interface Plane {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

export const planeFromPointNormal = (point: Vec3, normal: Vec3): Plane => ({
  a: normal[0],
  b: normal[1],
  c: normal[2],
  d: dot(normal, point),
});

export const planeNormal = (plane: Plane): Vec3 => [plane.a, plane.b, plane.c];

export const planeFromThreePoints = (p0: Vec3, p1: Vec3, p2: Vec3): Plane => {
  const normal = cross(sub(p1, p0), sub(p2, p0));
  if (isZero(normal)) {
    throw new Error("Los tres puntos son colineales");
  }
  return planeFromPointNormal(p0, normal);
};

export const planeValue = (plane: Plane, point: Vec3): number =>
  plane.a * point[0] + plane.b * point[1] + plane.c * point[2] - plane.d;

export const distanceToPlane = (plane: Plane, point: Vec3): number => {
  const normal = planeNormal(plane);
  return Math.abs(planeValue(plane, point)) / norm(normal);
};

export const projectOntoPlane = (plane: Plane, point: Vec3): Vec3 => {
  const normal = planeNormal(plane);
  const normalSquared = dot(normal, normal);
  if (normalSquared < 1e-12) {
    throw new Error("El plano no tiene normal definida");
  }
  return sub(point, scale(planeValue(plane, point) / normalSquared, normal));
};

export const containsInPlane = (plane: Plane, point: Vec3, epsilon = 1e-7): boolean =>
  Math.abs(planeValue(plane, point)) <= epsilon * Math.max(1, norm(planeNormal(plane)));

export const groundProjectionMatrix = (): Mat3 => diag(1, 1, 0);

export const projectToGround = (point: Vec3): Vec3 => [point[0], point[1], 0];

export const groundDistance = (a: Vec3, b: Vec3): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

export const horizontalPlane = (height: number): Plane => planeFromPointNormal([0, 0, height], [0, 0, 1]);

export interface Segment3 {
  readonly start: Vec3;
  readonly end: Vec3;
}

export const segmentLength = (segment: Segment3): number => norm(sub(segment.end, segment.start));

export const polylineLength = (points: readonly Vec3[]): number => {
  if (points.length < 2) return 0;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += norm(sub(points[index], points[index - 1]));
  }
  return total;
};

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(t, sub(b, a)));

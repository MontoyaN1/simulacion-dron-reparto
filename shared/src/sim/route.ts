import type { Vec3 } from "../math/vec3";
import type { RouteFrame } from "../config/frames";
import { norm } from "../math/vec3";

export interface RouteMetrics {
  readonly totalLength: number;
  readonly cumulative: readonly number[];
}

export const routeMetrics = (route: readonly Vec3[]): RouteMetrics => {
  const cumulative: number[] = [0];
  let total = 0;
  for (let index = 1; index < route.length; index += 1) {
    total += norm([
      route[index][0] - route[index - 1][0],
      route[index][1] - route[index - 1][1],
      route[index][2] - route[index - 1][2],
    ]);
    cumulative.push(total);
  }
  return { totalLength: total, cumulative };
};

export const remainingAlongRoute = (
  route: readonly Vec3[],
  cumulative: readonly number[],
  waypointIndex: number,
  position: Vec3,
): number => {
  if (waypointIndex >= route.length) return 0;
  const target = route[waypointIndex];
  const toTarget = norm([
    target[0] - position[0],
    target[1] - position[1],
    target[2] - position[2],
  ]);
  const total = cumulative[cumulative.length - 1];
  const completedToTarget = cumulative[Math.min(waypointIndex, cumulative.length - 1)] ?? total;
  return toTarget + (total - completedToTarget);
};

export const resampleRoute = (route: readonly Vec3[], maxStep: number): Vec3[] => {
  if (route.length < 2 || maxStep <= 0) return [...route];
  const result: Vec3[] = [route[0]];
  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];
    const segmentLength = norm([
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    ]);
    const steps = Math.max(1, Math.ceil(segmentLength / maxStep));
    for (let step = 1; step <= steps; step += 1) {
      if (step === steps) {
        result.push(end);
        continue;
      }
      const ratio = step / steps;
      result.push([
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio,
        start[2] + (end[2] - start[2]) * ratio,
      ]);
    }
  }
  return result;
};

export const verticalRoute = (
  horizontal: Vec3,
  cruiseAltitude: number,
  start: Vec3 = [0, 0, 0],
): Vec3[] => {
  const destination: Vec3 = [horizontal[0], horizontal[1], 0];
  return [
    start,
    [start[0], start[1], cruiseAltitude],
    [horizontal[0], horizontal[1], cruiseAltitude],
    destination,
  ];
};

export const straightRoute = (frame: RouteFrame, cruiseAltitude: number): Vec3[] =>
  verticalRoute(frame.displacement, cruiseAltitude);

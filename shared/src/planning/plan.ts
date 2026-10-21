import type { Vec3 } from "../math/vec3";
import {
  buildPlanGrid,
  cellCenter,
  pointToCell,
  type FootprintBuilding,
  type PlanGrid,
  type Point2,
} from "./grid";
import { findGridPath, smoothGridPath } from "./astar";

export interface RoutePlanRequest {
  readonly start: Point2;
  readonly goal: Point2;
  readonly buildings: readonly FootprintBuilding[];
  readonly cruiseAltitude: number;
  readonly clearance?: number;
  readonly cellSize?: number;
  readonly padding?: number;
  readonly inflate?: number;
}

export interface RoutePlanStats {
  readonly found: boolean;
  readonly waypoints: number;
  readonly visitedCells: number;
  readonly obstacleBuildings: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly cellSize: number;
  readonly straightLength: number;
  readonly pathLength: number;
  readonly detourRatio: number;
}

export interface RoutePlan {
  readonly route: Vec3[];
  readonly stats: RoutePlanStats;
}

const distance2 = (a: Point2, b: Point2): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

const polylineLength = (points: readonly Point2[]): number => {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance2(points[index - 1], points[index]);
  }
  return total;
};

const buildRoute = (
  start: Point2,
  goal: Point2,
  waypoints: readonly Point2[],
  altitude: number,
): Vec3[] => [
  [start[0], start[1], 0],
  [start[0], start[1], altitude],
  ...waypoints.map(([x, y]): Vec3 => [x, y, altitude]),
  [goal[0], goal[1], altitude],
  [goal[0], goal[1], 0],
];

const summarize = (
  grid: PlanGrid,
  start: Point2,
  goal: Point2,
  waypoints: readonly Point2[],
  visitedCells: number,
  found: boolean,
): RoutePlanStats => {
  const straightLength = distance2(start, goal);
  const pathLength = polylineLength([start, ...waypoints, goal]);
  return {
    found,
    waypoints: waypoints.length,
    visitedCells,
    obstacleBuildings: grid.obstacleBuildings,
    gridWidth: grid.width,
    gridHeight: grid.height,
    cellSize: grid.cellSize,
    straightLength,
    pathLength,
    detourRatio: straightLength > 0 ? pathLength / straightLength : 1,
  };
};

export const planRoute = (request: RoutePlanRequest): RoutePlan => {
  const { start, goal, buildings, cruiseAltitude } = request;
  const grid = buildPlanGrid(buildings, start, goal, {
    cruiseAltitude,
    clearance: request.clearance,
    cellSize: request.cellSize,
    padding: request.padding,
    inflate: request.inflate,
  });

  const startIndex = pointToCell(grid, start);
  const goalIndex = pointToCell(grid, goal);
  grid.blocked[startIndex] = 0;
  grid.blocked[goalIndex] = 0;

  const result = findGridPath(grid, startIndex, goalIndex);
  if (!result.found) {
    return {
      route: buildRoute(start, goal, [], cruiseAltitude),
      stats: summarize(grid, start, goal, [], result.visited, false),
    };
  }

  const smoothed = smoothGridPath(grid, result.indices);
  const waypoints = smoothed
    .slice(1, -1)
    .map((index) => cellCenter(grid, index))
    .filter((point) => distance2(point, start) > 2 && distance2(point, goal) > 2);

  return {
    route: buildRoute(start, goal, waypoints, cruiseAltitude),
    stats: summarize(grid, start, goal, waypoints, result.visited, true),
  };
};

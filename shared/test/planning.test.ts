import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanGrid, planRoute, type FootprintBuilding } from "../src/index";

const square = (cx: number, cy: number, half: number, height: number): FootprintBuilding => ({
  height,
  footprint: [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
  ],
});

const inside = (point: readonly [number, number], building: FootprintBuilding): boolean => {
  let result = false;
  const ring = building.footprint;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
      result = !result;
    }
  }
  return result;
};

test("sin edificios la ruta es directa y con perfil vertical", () => {
  const plan = planRoute({
    start: [0, 0],
    goal: [400, 0],
    buildings: [],
    cruiseAltitude: 50,
  });

  assert.equal(plan.stats.found, true);
  assert.equal(plan.route[0][2], 0);
  assert.equal(plan.route[1][2], 50);
  assert.equal(plan.route[plan.route.length - 1][2], 0);
  assert.ok(Math.abs(plan.stats.detourRatio - 1) < 0.02);
  assert.deepEqual(plan.route[plan.route.length - 1].slice(0, 2), [400, 0]);
});

test("un edificio alto en la linea obliga a rodearlo", () => {
  const building = square(200, 0, 45, 60);
  const plan = planRoute({
    start: [0, 0],
    goal: [400, 0],
    buildings: [building],
    cruiseAltitude: 50,
    cellSize: 5,
  });

  assert.equal(plan.stats.found, true);
  assert.ok(plan.stats.detourRatio > 1.05, `detour ${plan.stats.detourRatio}`);
  for (const waypoint of plan.route.slice(2, -2)) {
    assert.equal(inside([waypoint[0], waypoint[1]], building), false);
  }
});

test("los edificios bajos no bloquean el vuelo de crucero", () => {
  const plan = planRoute({
    start: [0, 0],
    goal: [300, 0],
    buildings: [square(150, 0, 30, 20)],
    cruiseAltitude: 50,
    clearance: 12,
  });

  assert.equal(plan.stats.found, true);
  assert.equal(plan.stats.obstacleBuildings, 0);
  assert.ok(plan.stats.detourRatio < 1.02);
});

test("un muro completo sin paso devuelve la ruta directa como respaldo", () => {
  const wall: FootprintBuilding = {
    height: 70,
    footprint: [
      [195, -2000],
      [205, -2000],
      [205, 2000],
      [195, 2000],
    ],
  };
  const plan = planRoute({
    start: [0, 0],
    goal: [400, 0],
    buildings: [wall],
    cruiseAltitude: 50,
    cellSize: 10,
  });

  assert.equal(plan.stats.found, false);
  assert.equal(plan.route.length, 4);
});

test("la rejilla ubica celdas y respeta el margen", () => {
  const grid = buildPlanGrid([square(100, 0, 20, 80)], [0, 0], [200, 0], {
    cellSize: 5,
    inflate: 6,
    padding: 100,
    cruiseAltitude: 50,
    clearance: 10,
  });

  assert.ok(grid.width > 0);
  assert.ok(grid.height > 0);
  assert.equal(grid.blocked.length, grid.width * grid.height);
  assert.ok(grid.blocked.some((value) => value === 1));
});

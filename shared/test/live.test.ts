import assert from "node:assert/strict";
import { test } from "node:test";
import { liveAlgebra } from "../src/live";
import { identity } from "../src/math/matrix";
import { enuRotationMatrix } from "../src/math/coords";
import { UTS } from "../src/config/campuses";
import { vec3 } from "../src/math/vec3";

const near = (a: number, b: number, epsilon = 1e-9): boolean => Math.abs(a - b) <= epsilon;

test("combinacion lineal reproduce la posicion", () => {
  const position = vec3(120, 850, 50);
  const velocity = vec3(1.5, 14.9, 0);
  const live = liveAlgebra(position, velocity, identity(), vec3(0, 1, 0));

  assert.ok(near(live.along * live.heading[0] + live.lateral * live.right[0] + live.position[0] * 0, position[0]));
  assert.ok(live.reconstructionError < 1e-9);
  assert.ok(near(live.speed, Math.hypot(1.5, 14.9)));
});

test("la rotacion ENU conserva la norma y el determinante", () => {
  const rotation = enuRotationMatrix(UTS.geodetic);
  const live = liveAlgebra(vec3(10, 20, 50), vec3(3, 4, 0), rotation, vec3(0, 1, 0));

  assert.ok(near(live.rotatedSpeed, live.speed, 1e-6));
  assert.ok(near(live.rotationDet, 1, 1e-9));
  assert.equal(live.directionsRank, 3);
  assert.ok(near(live.directionsDet, 1, 1e-9));
});

test("sin velocidad horizontal usa el rumbo de la ruta", () => {
  const live = liveAlgebra(vec3(0, 0, 30), vec3(0, 0, 6), identity(), vec3(1, 3, 0));

  assert.ok(near(live.heading[0], 1 / Math.sqrt(10)));
  assert.ok(near(live.heading[1], 3 / Math.sqrt(10)));
  assert.ok(near(live.altitude, 30));
  assert.ok(near(live.northDot, 0));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  containsInPlane,
  containsPoint,
  distanceToPlane,
  groundDistance,
  groundProjectionMatrix,
  horizontalPlane,
  line3,
  parameterOf,
  planeFromPointNormal,
  planeFromThreePoints,
  planeNormal,
  pointAt,
  polylineLength,
  projectOntoPlane,
  projectToGround,
  segmentLength,
} from "../src/math/geometry";
import { multiplyVec } from "../src/math/matrix";
import { norm, sub, vec3 } from "../src/math/vec3";

test("recta parametrica contiene sus puntos", () => {
  const route = line3(vec3(0, 0, 0), vec3(2, 4, 0));
  const middle = pointAt(route, 0.5);
  assert.deepEqual(middle, [1, 2, 0]);
  assert.ok(containsPoint(route, middle));
  assert.ok(containsPoint(route, vec3(-2, -4, 0)));
  assert.ok(!containsPoint(route, vec3(1, 2.5, 0)));
  assert.ok(!containsPoint(route, vec3(1, 2, 30)));
});

test("parametro de un punto sobre la recta", () => {
  const route = line3(vec3(1, 1, 0), vec3(0, 4, 0));
  assert.equal(parameterOf(route, vec3(1, 5, 0)), 1);
  assert.equal(parameterOf(route, vec3(1, -3, 0)), -1);
});

test("plano por punto y normal: distancias y pertenencia", () => {
  const ceiling = horizontalPlane(50);
  assert.deepEqual(planeNormal(ceiling), [0, 0, 1]);
  assert.equal(distanceToPlane(ceiling, vec3(0, 0, 80)), 30);
  assert.equal(distanceToPlane(ceiling, vec3(120, -40, 20)), 30);
  assert.ok(containsInPlane(ceiling, vec3(3, 4, 50)));
  assert.ok(!containsInPlane(ceiling, vec3(3, 4, 51)));
});

test("proyeccion sobre un plano inclinado", () => {
  const plane = planeFromPointNormal(vec3(0, 0, 0), vec3(0, 0, 1));
  assert.deepEqual(projectOntoPlane(plane, vec3(1, 2, 3)), [1, 2, 0]);

  const tilted = planeFromPointNormal(vec3(0, 0, 0), vec3(1, 1, 1));
  const projected = projectOntoPlane(tilted, vec3(3, 0, 0));
  const offset = sub(vec3(3, 0, 0), projected);
  assert.ok(norm(offset) > 0);
  assert.ok(norm(sub(projected, multiplyVec(groundProjectionMatrix(), projected))) >= 0);
});

test("plano por tres puntos", () => {
  const plane = planeFromThreePoints(vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0));
  assert.ok(containsInPlane(plane, vec3(4, -2, 0)));
  assert.equal(distanceToPlane(plane, vec3(0, 0, 7)), 7);
  assert.throws(() => planeFromThreePoints(vec3(0, 0, 0), vec3(1, 0, 0), vec3(2, 0, 0)));
});

test("proyeccion al suelo y distancias horizontales", () => {
  assert.deepEqual(projectToGround(vec3(2, 4, 50)), [2, 4, 0]);
  assert.equal(groundDistance(vec3(0, 0, 0), vec3(3, 4, 50)), 5);
  assert.equal(segmentLength({ start: vec3(0, 0, 0), end: vec3(0, 0, 10) }), 10);
  assert.equal(polylineLength([vec3(0, 0, 0), vec3(0, 0, 10), vec3(10, 0, 10)]), 20);
});

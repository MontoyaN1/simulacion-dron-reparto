import assert from "node:assert/strict";
import { test } from "node:test";
import {
  add,
  angleDeg,
  cross,
  dot,
  isParallel,
  norm,
  normalize,
  projectOnto,
  rejectFrom,
  scale,
  sub,
  vec3,
} from "../src/math/vec3";

test("suma, resta y escala de vectores", () => {
  const a = vec3(1, 2, 3);
  const b = vec3(4, 5, 6);
  assert.deepEqual(add(a, b), [5, 7, 9]);
  assert.deepEqual(sub(b, a), [3, 3, 3]);
  assert.deepEqual(scale(2, a), [2, 4, 6]);
});

test("producto interno y norma", () => {
  assert.equal(dot(vec3(1, 2, 3), vec3(4, -5, 6)), 12);
  assert.equal(norm(vec3(3, 4, 0)), 5);
  assert.equal(norm(vec3(0, 0, 0)), 0);
});

test("normalizacion y vector nulo", () => {
  assert.ok(norm(sub(normalize(vec3(0, 5, 0)), vec3(0, 1, 0))) < 1e-12);
  assert.throws(() => normalize(vec3(0, 0, 0)));
});

test("producto cruz devuelve un vector ortogonal", () => {
  const a = vec3(1, 2, 3);
  const b = vec3(4, 5, 6);
  const c = cross(a, b);
  assert.ok(Math.abs(dot(c, a)) < 1e-12);
  assert.ok(Math.abs(dot(c, b)) < 1e-12);
  assert.deepEqual(c, [-3, 6, -3]);
});

test("angulo entre ejes canonicos", () => {
  assert.ok(Math.abs(angleDeg(vec3(1, 0, 0), vec3(0, 1, 0)) - 90) < 1e-9);
  assert.ok(angleDeg(vec3(2, 0, 0), vec3(3, 0, 0)) < 1e-9);
});

test("proyeccion ortogonal y componente rechazada", () => {
  const v = vec3(1, 2, 3);
  assert.deepEqual(projectOnto(v, vec3(1, 0, 0)), [1, 0, 0]);

  const u = vec3(1, 1, 0);
  const projection = projectOnto(v, u);
  const rejection = rejectFrom(v, u);
  assert.ok(Math.abs(dot(projection, rejection)) < 1e-12);
  assert.deepEqual(add(projection, rejection), v);
});

test("paralelismo", () => {
  assert.ok(isParallel(vec3(1, 2, 3), vec3(-2, -4, -6)));
  assert.ok(!isParallel(vec3(1, 0, 0), vec3(0, 1, 0)));
});

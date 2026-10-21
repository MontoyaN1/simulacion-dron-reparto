import assert from "node:assert/strict";
import { test } from "node:test";
import type { Mat3 } from "../src/math/matrix";
import {
  coordinatesInBasis,
  determinant,
  diag,
  fromColumns,
  identity,
  imageBasis,
  inverse,
  isInvertible,
  isOrthogonal,
  kernelBasis,
  mat3,
  multiply,
  multiplyVec,
  nullity,
  rank,
  rref,
  transpose,
} from "../src/math/matrix";
import { norm, vec3 } from "../src/math/vec3";

const matricesEqual = (a: readonly (readonly number[])[], b: Mat3): boolean =>
  a.every((row, r) => row.every((value, c) => Math.abs(value - b[r][c]) < 1e-9));

test("identidad y multiplicacion", () => {
  const a = mat3([1, 2, 3], [0, 1, 4], [5, 6, 0]);
  assert.ok(matricesEqual(multiply(a, identity()), a));
  assert.ok(matricesEqual(multiply(identity(), a), a));
  assert.deepEqual(multiplyVec(identity(), vec3(7, 8, 9)), [7, 8, 9]);
});

test("determinante e invertibilidad", () => {
  assert.equal(determinant(diag(2, 3, 4)), 24);
  const a = mat3([1, 0, 0], [0, 2, 0], [0, 0, 3]);
  assert.ok(isInvertible(a));

  const inverseMatrix = inverse(a);
  assert.deepEqual(inverseMatrix, [
    [1, 0, 0],
    [0, 0.5, 0],
    [0, 0, 1 / 3],
  ]);
  assert.ok(matricesEqual(multiply(a, inverseMatrix), identity()));

  const singular = mat3([1, 2, 3], [2, 4, 6], [0, 0, 0]);
  assert.ok(!isInvertible(singular));
  assert.throws(() => inverse(singular));
});

test("rango, nucleo e imagen", () => {
  const singular = mat3([1, 2, 3], [2, 4, 6], [0, 0, 0]);
  assert.equal(rank(singular), 1);
  assert.equal(nullity(singular), 2);
  assert.equal(imageBasis(singular).length, 1);

  const kernel = kernelBasis(singular);
  assert.equal(kernel.length, 2);
  for (const vector of kernel) {
    assert.ok(norm(multiplyVec(singular, vector)) < 1e-9);
  }
  assert.equal(rank(singular) + nullity(singular), 3);
});

test("la proyeccion al suelo es idempotente y de rango 2", () => {
  const p = diag(1, 1, 0);
  assert.ok(matricesEqual(multiply(p, p), p));
  assert.equal(rank(p), 2);
  assert.equal(nullity(p), 1);

  const kernel = kernelBasis(p);
  assert.equal(kernel.length, 1);
  assert.deepEqual(kernel[0], [0, 0, 1]);
  assert.deepEqual(multiplyVec(p, vec3(3, 5, 9)), [3, 5, 0]);
});

test("matriz ortogonal: columnas ortonormales y det 1", () => {
  const angle = Math.PI / 3;
  const rotation = mat3(
    [Math.cos(angle), -Math.sin(angle), 0],
    [Math.sin(angle), Math.cos(angle), 0],
    [0, 0, 1],
  );
  assert.ok(isOrthogonal(rotation));
  assert.ok(Math.abs(determinant(rotation) - 1) < 1e-12);
  assert.ok(matricesEqual(multiply(rotation, transpose(rotation)), identity()));
});

test("coordenadas en una base", () => {
  const basis = fromColumns(vec3(2, 0, 0), vec3(0, 3, 0), vec3(0, 0, 4));
  const coords = coordinatesInBasis(basis, vec3(4, 9, 8));
  assert.deepEqual(coords, [2, 3, 2]);
});

test("rref resuelve un sistema dependiente", () => {
  const system = mat3([1, 1, 1], [2, 2, 2], [1, -1, 0]);
  const result = rref(system);
  assert.equal(result.rank, 2);
  assert.deepEqual(result.pivots, [0, 1]);
});

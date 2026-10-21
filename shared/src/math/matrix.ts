import type { Vec3 } from "./vec3";
import { cross, dot, norm } from "./vec3";

export type Mat3 = readonly [Vec3, Vec3, Vec3];

export const mat3 = (row0: Vec3, row1: Vec3, row2: Vec3): Mat3 => [row0, row1, row2];

export const identity = (): Mat3 => [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export const zeroMatrix = (): Mat3 => [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];

export const diag = (a: number, b: number, c: number): Mat3 => [
  [a, 0, 0],
  [0, b, 0],
  [0, 0, c],
];

export const columns = (m: Mat3): readonly [Vec3, Vec3, Vec3] => [
  [m[0][0], m[1][0], m[2][0]],
  [m[0][1], m[1][1], m[2][1]],
  [m[0][2], m[1][2], m[2][2]],
];

export const fromColumns = (c0: Vec3, c1: Vec3, c2: Vec3): Mat3 => [
  [c0[0], c1[0], c2[0]],
  [c0[1], c1[1], c2[1]],
  [c0[2], c1[2], c2[2]],
];

export const transpose = (m: Mat3): Mat3 => fromColumns(m[0], m[1], m[2]);

export const multiplyVec = (m: Mat3, v: Vec3): Vec3 => [
  dot(m[0], v),
  dot(m[1], v),
  dot(m[2], v),
];

export const multiply = (a: Mat3, b: Mat3): Mat3 => {
  const [b0, b1, b2] = columns(b);
  return fromColumns(multiplyVec(a, b0), multiplyVec(a, b1), multiplyVec(a, b2));
};

export const determinant = (m: Mat3): number => dot(m[0], cross(m[1], m[2]));

export interface RrefResult {
  readonly rows: Mat3;
  readonly pivots: readonly number[];
  readonly rank: number;
}

const EPSILON = 1e-10;

export const rref = (m: Mat3): RrefResult => {
  const a: number[][] = m.map((row) => [...row]);
  const pivots: number[] = [];
  let currentRow = 0;

  for (let col = 0; col < 3 && currentRow < 3; col += 1) {
    let pivotRow = currentRow;
    for (let r = currentRow + 1; r < 3; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivotRow][col])) {
        pivotRow = r;
      }
    }
    if (Math.abs(a[pivotRow][col]) < EPSILON) {
      continue;
    }
    const tmp = a[currentRow];
    a[currentRow] = a[pivotRow];
    a[pivotRow] = tmp;

    const pivot = a[currentRow][col];
    for (let c = 0; c < 3; c += 1) {
      a[currentRow][c] /= pivot;
    }
    for (let r = 0; r < 3; r += 1) {
      if (r === currentRow) continue;
      const factor = a[r][col];
      if (Math.abs(factor) < EPSILON) continue;
      for (let c = 0; c < 3; c += 1) {
        a[r][c] -= factor * a[currentRow][c];
      }
    }
    pivots.push(col);
    currentRow += 1;
  }

  return {
    rows: [
      [a[0][0], a[0][1], a[0][2]],
      [a[1][0], a[1][1], a[1][2]],
      [a[2][0], a[2][1], a[2][2]],
    ],
    pivots,
    rank: pivots.length,
  };
};

export const rank = (m: Mat3): number => rref(m).rank;

export const nullity = (m: Mat3): number => 3 - rank(m);

export const kernelBasis = (m: Mat3): Vec3[] => {
  const { rows, pivots } = rref(m);
  const freeColumns = [0, 1, 2].filter((col) => !pivots.includes(col));
  return freeColumns.map((freeCol) => {
    const vector: [number, number, number] = [0, 0, 0];
    vector[freeCol] = 1;
    pivots.forEach((pivotCol, index) => {
      const entry = -rows[index][freeCol];
      vector[pivotCol] = entry === 0 ? 0 : entry;
    });
    return vector;
  });
};

export const imageBasis = (m: Mat3): Vec3[] => {
  const { pivots } = rref(m);
  const cols = columns(m);
  return pivots.map((pivotCol) => cols[pivotCol]);
};

export const isInvertible = (m: Mat3): boolean => Math.abs(determinant(m)) > 1e-12;

export const inverse = (m: Mat3): Mat3 => {
  const det = determinant(m);
  if (Math.abs(det) < 1e-12) {
    throw new Error("La matriz no es invertible");
  }
  const [c0, c1, c2] = columns(m);
  const adjugate = mat3(cross(c1, c2), cross(c2, c0), cross(c0, c1));
  const scaled: Vec3[] = adjugate.map((row) => [row[0] / det, row[1] / det, row[2] / det]);
  return [scaled[0], scaled[1], scaled[2]];
};

export const coordinatesInBasis = (basis: Mat3, v: Vec3): Vec3 => multiplyVec(inverse(basis), v);

export const isOrthogonal = (m: Mat3, epsilon = 1e-9): boolean => {
  const product = multiply(transpose(m), m);
  const expected = identity();
  return product.every((row, r) =>
    row.every((value, c) => Math.abs(value - expected[r][c]) <= epsilon),
  );
};

export const matrixNorm = (m: Mat3): number =>
  Math.sqrt(m.reduce((acc, row) => acc + dot(row, row), 0));

export const frobenius = matrixNorm;

export const trace = (m: Mat3): number => m[0][0] + m[1][1] + m[2][2];

export const normOfColumn = (m: Mat3, column: 0 | 1 | 2): number => norm(columns(m)[column]);

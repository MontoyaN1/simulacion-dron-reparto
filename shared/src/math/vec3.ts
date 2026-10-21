export type Vec3 = readonly [number, number, number];

export const vec3 = (x: number, y: number, z: number): Vec3 => [x, y, z];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const scale = (factor: number, v: Vec3): Vec3 => [
  factor * v[0],
  factor * v[1],
  factor * v[2],
];

export const negate = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const norm = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

export const distance = (a: Vec3, b: Vec3): number => norm(sub(a, b));

export const normalize = (v: Vec3, epsilon = 1e-12): Vec3 => {
  const length = norm(v);
  if (length < epsilon) {
    throw new Error("No se puede normalizar el vector nulo");
  }
  return scale(1 / length, v);
};

export const angleRad = (a: Vec3, b: Vec3): number => {
  const na = norm(a);
  const nb = norm(b);
  if (na < 1e-12 || nb < 1e-12) {
    throw new Error("El angulo no esta definido para el vector nulo");
  }
  const cosine = Math.min(1, Math.max(-1, dot(a, b) / (na * nb)));
  return Math.acos(cosine);
};

export const angleDeg = (a: Vec3, b: Vec3): number => (angleRad(a, b) * 180) / Math.PI;

export const projectOnto = (v: Vec3, u: Vec3): Vec3 => {
  const uu = dot(u, u);
  if (uu < 1e-12) {
    throw new Error("No se puede proyectar sobre el vector nulo");
  }
  return scale(dot(v, u) / uu, u);
};

export const rejectFrom = (v: Vec3, u: Vec3): Vec3 => sub(v, projectOnto(v, u));

export const isZero = (v: Vec3, epsilon = 1e-9): boolean => norm(v) <= epsilon;

export const isParallel = (a: Vec3, b: Vec3, epsilon = 1e-9): boolean =>
  isZero(cross(a, b), epsilon);

export const equalsApprox = (a: Vec3, b: Vec3, epsilon = 1e-9): boolean =>
  distance(a, b) <= epsilon;

export const toArray = (v: Vec3): [number, number, number] => [v[0], v[1], v[2]];

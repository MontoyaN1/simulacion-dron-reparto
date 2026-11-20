import { mkdirSync, writeFileSync } from "node:fs";

const TAU = Math.PI * 2;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, value) => [a[0] * value, a[1] * value, a[2] * value];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a) => {
  const length = Math.hypot(...a) || 1;
  return mul(a, 1 / length);
};

class Geometry {
  positions = [];
  normals = [];
  indices = [];
  colors = [];

  vertex(position, normal) {
    const index = this.positions.length / 3;
    this.positions.push(...position);
    this.normals.push(...normal);
    return index;
  }

  vertexColor(position, normal, color) {
    const index = this.vertex(position, normal);
    this.colors.push(...color);
    return index;
  }

  triangle(a, b, c) {
    this.indices.push(a, b, c);
  }

  quad(a, b, c, d) {
    this.triangle(a, b, c);
    this.triangle(a, c, d);
  }
}

const box = (center, size) => {
  const geometry = new Geometry();
  const half = mul(size, 0.5);
  const faces = [
    { n: [1, 0, 0], corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
    { n: [-1, 0, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], corners: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
    { n: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
    { n: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], corners: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]] },
  ];
  for (const face of faces) {
    const vertices = face.corners.map((corner) =>
      geometry.vertex(
        add(center, [corner[0] * half[0], corner[1] * half[1], corner[2] * half[2]]),
        face.n,
      ),
    );
    geometry.quad(...vertices);
  }
  return geometry;
};

const cylinder = (start, end, radius, segments = 14) => {
  const geometry = new Geometry();
  const axis = normalize(sub(end, start));
  const reference = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = normalize(cross(reference, axis));
  const v = cross(axis, u);

  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * TAU;
    const radial = add(mul(u, Math.cos(angle)), mul(v, Math.sin(angle)));
    geometry.vertex(add(start, mul(radial, radius)), radial);
    geometry.vertex(add(end, mul(radial, radius)), radial);
  }
  for (let index = 0; index < segments; index += 1) {
    const a = index * 2;
    geometry.quad(a, a + 1, a + 3, a + 2);
  }

  for (const [point, normal, reverse] of [[start, mul(axis, -1), true], [end, axis, false]]) {
    const center = geometry.vertex(point, normal);
    const ring = [];
    for (let index = 0; index <= segments; index += 1) {
      const angle = (index / segments) * TAU;
      const radial = add(mul(u, Math.cos(angle)), mul(v, Math.sin(angle)));
      ring.push(geometry.vertex(add(point, mul(radial, radius)), normal));
    }
    for (let index = 0; index < segments; index += 1) {
      if (reverse) geometry.triangle(center, ring[index + 1], ring[index]);
      else geometry.triangle(center, ring[index], ring[index + 1]);
    }
  }
  return geometry;
};

const ellipsoid = (center, radii, segments = 20, rings = 12) => {
  const geometry = new Geometry();
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (ring / rings) * Math.PI;
    for (let segment = 0; segment <= segments; segment += 1) {
      const theta = (segment / segments) * TAU;
      const unit = [
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
      ];
      geometry.vertex(
        add(center, [unit[0] * radii[0], unit[1] * radii[1], unit[2] * radii[2]]),
        normalize([unit[0] / radii[0], unit[1] / radii[1], unit[2] / radii[2]]),
      );
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = ring * (segments + 1) + segment;
      const b = a + segments + 1;
      geometry.quad(a, b, b + 1, a + 1);
    }
  }
  return geometry;
};

const signedPow = (value, exponent) => Math.sign(value) * Math.abs(value) ** exponent;

// Elipsoide supercuadrático: casco redondeado con paneles menos "globo" que
// una esfera, pero normales continuas (nada de caja low-poly).
const superellipsoid = (center, radii, exponent = 0.65, segments = 40, rings = 20) => {
  const geometry = new Geometry();
  const normalExponent = 2 / exponent - 1;
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (ring / rings) * Math.PI;
    for (let segment = 0; segment <= segments; segment += 1) {
      const theta = (segment / segments) * TAU;
      const unit = [
        signedPow(Math.sin(phi), exponent) * signedPow(Math.cos(theta), exponent),
        signedPow(Math.sin(phi), exponent) * signedPow(Math.sin(theta), exponent),
        signedPow(Math.cos(phi), exponent),
      ];
      const normal = normalize(unit.map((value, axis) => signedPow(value, normalExponent) / radii[axis]));
      geometry.vertex(
        add(center, unit.map((value, axis) => value * radii[axis])),
        normal,
      );
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = ring * (segments + 1) + segment;
      const b = a + segments + 1;
      geometry.quad(a, b, b + 1, a + 1);
    }
  }
  return geometry;
};

const taperedCylinder = (start, end, radiusStart, radiusEnd, segments = 32) => {
  const geometry = new Geometry();
  const axis = normalize(sub(end, start));
  const reference = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = normalize(cross(reference, axis));
  const v = cross(axis, u);
  const slope = (radiusStart - radiusEnd) / Math.max(1e-6, Math.hypot(...sub(end, start)));

  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * TAU;
    const radial = add(mul(u, Math.cos(angle)), mul(v, Math.sin(angle)));
    const normal = normalize(add(radial, mul(axis, slope)));
    geometry.vertex(add(start, mul(radial, radiusStart)), normal);
    geometry.vertex(add(end, mul(radial, radiusEnd)), normal);
  }
  for (let index = 0; index < segments; index += 1) {
    const a = index * 2;
    geometry.quad(a, a + 1, a + 3, a + 2);
  }
  for (const [point, normal, reverse] of [[start, mul(axis, -1), true], [end, axis, false]]) {
    const radius = point === start ? radiusStart : radiusEnd;
    const centerIndex = geometry.vertex(point, normal);
    const ring = [];
    for (let index = 0; index <= segments; index += 1) {
      const angle = (index / segments) * TAU;
      const radial = add(mul(u, Math.cos(angle)), mul(v, Math.sin(angle)));
      ring.push(geometry.vertex(add(point, mul(radial, radius)), normal));
    }
    for (let index = 0; index < segments; index += 1) {
      if (reverse) geometry.triangle(centerIndex, ring[index + 1], ring[index]);
      else geometry.triangle(centerIndex, ring[index], ring[index + 1]);
    }
  }
  return geometry;
};

const torusZ = (center, major, minor, segments = 40, sides = 10) => {
  const geometry = new Geometry();
  for (let segment = 0; segment <= segments; segment += 1) {
    const theta = (segment / segments) * TAU;
    for (let side = 0; side <= sides; side += 1) {
      const phi = (side / sides) * TAU;
      const radial = major + minor * Math.cos(phi);
      geometry.vertex(
        add(center, [radial * Math.cos(theta), radial * Math.sin(theta), minor * Math.sin(phi)]),
        [Math.cos(phi) * Math.cos(theta), Math.cos(phi) * Math.sin(theta), Math.sin(phi)],
      );
    }
  }
  for (let segment = 0; segment < segments; segment += 1) {
    for (let side = 0; side < sides; side += 1) {
      const a = segment * (sides + 1) + side;
      const b = a + sides + 1;
      geometry.quad(a, b, b + 1, a + 1);
    }
  }
  return geometry;
};

const faceQuad = (geometry, points) => {
  const normal = normalize(cross(sub(points[1], points[0]), sub(points[3], points[0])));
  const indices = points.map((point) => geometry.vertex(point, normal));
  geometry.quad(...indices);
};

// Pala con cuerda decreciente, flecha y espesor: dos caras aerodinámicas y
// bordes nítidos, en lugar de dos cubos rectangulares.
const pala = (side, tip = false) => {
  const geometry = new Geometry();
  const all = [
    [0.028, 0.034, 0.0, 0.012],
    [0.075, 0.044, 0.004, 0.010],
    [0.160, 0.036, 0.014, 0.007],
    [0.205, 0.026, 0.026, 0.005],
    [0.240, 0.012, 0.038, 0.003],
  ];
  const stations = tip ? all.slice(3) : all.slice(0, 4);
  const rings = stations.map(([radius, chord, sweep, thickness]) => {
    const x = side * radius;
    return [
      [x, sweep - chord / 2, 0],
      [x, sweep, thickness / 2],
      [x, sweep + chord / 2, 0],
      [x, sweep, -thickness / 2],
    ];
  });
  for (let station = 0; station < rings.length - 1; station += 1) {
    for (let edge = 0; edge < 4; edge += 1) {
      const next = (edge + 1) % 4;
      const points = [rings[station][edge], rings[station + 1][edge], rings[station + 1][next], rings[station][next]];
      faceQuad(geometry, side > 0 ? points : points.toReversed());
    }
  }
  for (const [ring, outward] of [[rings[0], -side], [rings.at(-1), side]]) {
    const points = [...ring];
    // El orden del anillo apunta a -x cuando side=1.
    const ordered = outward < 0 ? points : points.toReversed();
    faceQuad(geometry, side > 0 ? ordered : ordered.toReversed());
  }
  return geometry;
};

// Dos arcos opuestos con fade angular. Nacen transparentes en el material;
// COLOR_0 aporta el gradiente sin texturas ni postproceso temporal.
const estelaGeometry = () => {
  const geometry = new Geometry();
  const segments = 24;
  for (const base of [0, Math.PI]) {
    const start = geometry.positions.length / 3;
    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      const angle = base - t * 1.05;
      const alpha = (1 - t) ** 1.8;
      for (const radius of [0.052, 0.24]) {
        geometry.vertexColor(
          [Math.cos(angle) * radius, Math.sin(angle) * radius, 0.006],
          [0, 0, 1],
          [0.45, 0.85, 1, alpha],
        );
      }
    }
    for (let index = 0; index < segments; index += 1) {
      const a = start + index * 2;
      geometry.quad(a, a + 1, a + 3, a + 2);
    }
  }
  return geometry;
};

const materials = [
  // Bloques de color anime + metal estilizado. Los focos superan 1 para que
  // el Bloom HDR del desktop los trate como luces, no como superficies blancas.
  { name: "Carbono", color: [0.12, 0.15, 0.20, 1], metallic: 0.45, roughness: 0.32 },
  { name: "Carcasa", color: [0.72, 0.78, 0.86, 1], metallic: 0.35, roughness: 0.28 },
  { name: "Metal", color: [0.55, 0.62, 0.72, 1], metallic: 0.85, roughness: 0.20 },
  { name: "Acento", color: [0.03, 0.45, 0.85, 1], metallic: 0.35, roughness: 0.24 },
  { name: "Paquete", color: [0.85, 0.28, 0.04, 1], metallic: 0.10, roughness: 0.45 },
  { name: "Correas", color: [0.12, 0.065, 0.025, 1], metallic: 0, roughness: 0.9 },
  { name: "Lente", color: [0.008, 0.02, 0.04, 1], metallic: 0.60, roughness: 0.08 },
  { name: "Rojo", color: [0.85, 0.025, 0.02, 1], metallic: 0.1, roughness: 0.25, emissive: [2.2, 0.02, 0.01] },
  { name: "Verde", color: [0.02, 0.8, 0.22, 1], metallic: 0.1, roughness: 0.25, emissive: [0.02, 2.0, 0.25] },
  { name: "Blanco", color: [0.85, 0.92, 1, 1], metallic: 0.1, roughness: 0.2, emissive: [2.4, 2.8, 3.2] },
  { name: "Cian", color: [0.05, 0.75, 1, 1], metallic: 0.15, roughness: 0.2, emissive: [0.05, 1.6, 2.2] },
  { name: "Estela", color: [0.25, 0.75, 1, 0], metallic: 0, roughness: 0.5, emissive: [0.05, 0.35, 0.55], blend: true, doubleSided: true },
];
const materialIndex = Object.fromEntries(materials.map((material, index) => [material.name, index]));
const staticParts = new Map();
const rotorParts = new Map();

const append = (target, material, geometry) => {
  if (!target.has(material)) target.set(material, new Geometry());
  const destination = target.get(material);
  const offset = destination.positions.length / 3;
  destination.positions.push(...geometry.positions);
  destination.normals.push(...geometry.normals);
  destination.indices.push(...geometry.indices.map((index) => index + offset));
};
const part = (material, geometry) => append(staticParts, material, geometry);

// Casco y paneles: volúmenes supercuadráticos con normales suaves. Todos los
// detalles se fusionan por material dentro de Estructura, sin textos ni decals.
part("Carcasa", superellipsoid([0, 0, 0], [0.32, 0.235, 0.10], 0.62, 48, 24));
part("Carcasa", superellipsoid([0, -0.015, 0.072], [0.275, 0.205, 0.075], 0.78, 40, 20));
part("Carbono", superellipsoid([0, -0.01, 0.125], [0.23, 0.16, 0.035], 0.65, 40, 16));
part("Carcasa", superellipsoid([0, 0.005, 0.143], [0.18, 0.12, 0.018], 0.60, 32, 12));
part("Acento", box([0, 0.02, 0.164], [0.025, 0.19, 0.006]));
for (const y of [-0.08, 0.08]) {
  part("Carbono", box([0, y, 0.158], [0.26, 0.004, 0.005]));
}
for (const side of [-1, 1]) {
  part("Carbono", box([side * 0.17, 0, 0.103], [0.005, 0.20, 0.006]));
}

// Visor panorámico: marco metálico, cristal oscuro y dos focos cyan estrechos.
part("Metal", superellipsoid([0, 0.216, 0.025], [0.218, 0.022, 0.063], 0.65, 40, 18));
part("Lente", superellipsoid([0, 0.231, 0.027], [0.202, 0.012, 0.050], 0.65, 40, 18));
for (const side of [-1, 1]) {
  part("Cian", ellipsoid([side * 0.102, 0.242, 0.037], [0.050, 0.006, 0.009], 24, 12));
}
part("Acento", superellipsoid([0, 0.235, -0.035], [0.055, 0.015, 0.018], 0.7, 28, 12));

// Ventilaciones laterales limpias, agrupadas y alineadas con el casco.
for (const side of [-1, 1]) {
  for (let index = 0; index < 5; index += 1) {
    part("Carbono", box([side * 0.318, -0.075 + index * 0.034, 0.012], [0.007, 0.021, 0.033]));
  }
}

const motors = [];
for (const sx of [-1, 1]) {
  for (const sy of [-1, 1]) {
    const x = sx * 0.34;
    const y = sy * 0.34;
    motors.push([x, y, 0.15]);
    part("Carcasa", taperedCylinder([sx * 0.17, sy * 0.14, 0.005], [x, y, 0.03], 0.048, 0.030, 32));
    part("Metal", taperedCylinder([x, y, 0.005], [x, y, 0.095], 0.052, 0.060, 36));
    part("Carcasa", ellipsoid([x, y, 0.096], [0.061, 0.061, 0.034], 32, 16));
    part("Carcasa", cylinder([x, y, 0.105], [x, y, 0.132], 0.058, 36));
    part("Acento", torusZ([x, y, 0.122], 0.058, 0.006, 40, 10));
    part("Metal", cylinder([x, y, 0.132], [x, y, 0.145], 0.028, 32));
    for (let bolt = 0; bolt < 6; bolt += 1) {
      const angle = (bolt / 6) * TAU;
      const bx = x + Math.cos(angle) * 0.045;
      const by = y + Math.sin(angle) * 0.045;
      part("Carbono", cylinder([bx, by, 0.133], [bx, by, 0.141], 0.004, 8));
    }
    part("Carbono", taperedCylinder([sx * 0.17, sy * 0.15, -0.055], [sx * 0.27, sy * 0.25, -0.285], 0.020, 0.014, 24));
    part(sx < 0 ? "Rojo" : "Verde", ellipsoid([sx * 0.393, sy * 0.34, 0.075], [0.014, 0.018, 0.014], 20, 12));
  }
}
for (const side of [-1, 1]) {
  part("Metal", cylinder([side * 0.27, -0.31, -0.3], [side * 0.27, 0.31, -0.3], 0.023, 24));
  for (const y of [-0.31, 0.31]) {
    part("Carbono", ellipsoid([side * 0.27, y, -0.3], [0.027, 0.027, 0.026], 20, 12));
    part("Acento", ellipsoid([side * 0.27, y, -0.285], [0.024, 0.024, 0.010], 20, 10));
  }
}

// Batería trasera de reparto, con correas y testigo; el paquete real sigue
// fuera del GLB (MissionDirector lo transfiere como entidad propia).
part("Paquete", superellipsoid([0, -0.135, 0.17], [0.115, 0.075, 0.045], 0.55, 36, 18));
for (const side of [-1, 1]) {
  part("Correas", box([side * 0.055, -0.135, 0.212], [0.014, 0.13, 0.008]));
}
part("Cian", ellipsoid([0, -0.208, 0.17], [0.018, 0.006, 0.009], 20, 10));
part("Carbono", cylinder([0.1, -0.16, 0.18], [0.15, -0.31, 0.3], 0.007, 16));
part("Blanco", ellipsoid([0.15, -0.31, 0.3], [0.012, 0.012, 0.012], 16, 10));

// Cardán delantero integrado bajo el visor.
part("Carcasa", ellipsoid([0, 0.19, -0.11], [0.075, 0.075, 0.07], 28, 16));
part("Metal", cylinder([0, 0.22, -0.11], [0, 0.285, -0.11], 0.044, 32));
part("Lente", cylinder([0, 0.285, -0.11], [0, 0.3, -0.11], 0.035, 32));
part("Cian", ellipsoid([0, 0.303, -0.11], [0.016, 0.005, 0.016], 20, 10));

part("Metal", box([0, -0.02, -0.205], [0.2, 0.16, 0.03]));
part("Blanco", ellipsoid([0, -0.235, 0.035], [0.018, 0.014, 0.014], 20, 12));

// Estrobo trasero: nodo y malla propios para parpadearlo por código.
const estroboGeom = ellipsoid([0, -0.225, 0.09], [0.018, 0.018, 0.018], 24, 14);

for (const side of [-1, 1]) {
  append(rotorParts, "Carbono", pala(side));
  append(rotorParts, "Cian", pala(side, true));
}
append(rotorParts, "Metal", cylinder([0, 0, -0.012], [0, 0, 0.018], 0.026, 32));
append(rotorParts, "Acento", torusZ([0, 0, 0.018], 0.022, 0.004, 32, 8));
const estelaParts = new Map([["Estela", estelaGeometry()]]);

const gltf = {
  asset: { version: "2.0", generator: "UTS-UIS procedural delivery drone" },
  scene: 0,
  scenes: [{ nodes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }],
  nodes: [
    { name: "DronReparto", mesh: 0 },
    ...motors.map((position, index) => ({ name: `Rotor${index + 1}`, mesh: 1, translation: position })),
    { name: "Strobe", mesh: 2 },
    ...motors.map((position, index) => ({ name: `Estela${index + 1}`, mesh: 3, translation: position })),
  ],
  meshes: [],
  materials: materials.map((material) => ({
    name: material.name,
    pbrMetallicRoughness: {
      baseColorFactor: material.color,
      metallicFactor: material.metallic,
      roughnessFactor: material.roughness,
    },
    ...(material.emissive ? { emissiveFactor: material.emissive } : {}),
    ...(material.blend ? { alphaMode: "BLEND" } : {}),
    doubleSided: material.doubleSided ?? false,
  })),
  accessors: [],
  bufferViews: [],
  buffers: [],
  animations: [],
};

const chunks = [];
let binaryLength = 0;
const addBuffer = (buffer) => {
  const padding = (4 - (binaryLength % 4)) % 4;
  if (padding) {
    chunks.push(Buffer.alloc(padding));
    binaryLength += padding;
  }
  const view = gltf.bufferViews.length;
  gltf.bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: buffer.length });
  chunks.push(buffer);
  binaryLength += buffer.length;
  return view;
};
const addAccessor = (values, type, componentType, includeBounds = false) => {
  const array = componentType === 5125 ? new Uint32Array(values) : new Float32Array(values);
  const view = addBuffer(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
  const components = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
  const accessor = {
    bufferView: view,
    componentType,
    count: array.length / components,
    type,
  };
  if (includeBounds) {
    accessor.min = Array.from({ length: components }, (_, component) =>
      Math.min(...Array.from({ length: accessor.count }, (_, index) => array[index * components + component])),
    );
    accessor.max = Array.from({ length: components }, (_, component) =>
      Math.max(...Array.from({ length: accessor.count }, (_, index) => array[index * components + component])),
    );
  }
  const index = gltf.accessors.length;
  gltf.accessors.push(accessor);
  return index;
};

const addMesh = (name, parts) => {
  const primitives = [];
  for (const [material, geometry] of parts) {
    const attributes = {
      POSITION: addAccessor(geometry.positions, "VEC3", 5126, true),
      NORMAL: addAccessor(geometry.normals, "VEC3", 5126),
    };
    if (geometry.colors.length > 0) {
      if (geometry.colors.length / 4 !== geometry.positions.length / 3) {
        throw new Error(`${name}/${material}: COLOR_0 no tiene un color por vértice`);
      }
      attributes.COLOR_0 = addAccessor(geometry.colors, "VEC4", 5126);
    }
    primitives.push({
      attributes,
      indices: addAccessor(geometry.indices, "SCALAR", 5125),
      material: materialIndex[material],
      mode: 4,
    });
  }
  const index = gltf.meshes.length;
  gltf.meshes.push({ name, primitives });
  return index;
};

addMesh("Estructura", staticParts);
addMesh("Aspas", rotorParts);
addMesh("Estrobo", new Map([["Blanco", estroboGeom]]));
addMesh("Estela", estelaParts);

const times = addAccessor([0, 0.25, 0.5, 0.75, 1], "SCALAR", 5126);
const channels = [];
const samplers = [];
motors.forEach((_, index) => {
  const values = [];
  const direction = index % 2 === 0 ? 1 : -1;
  for (let key = 0; key < 5; key += 1) {
    const angle = direction * TAU * (key / 4) + index * (Math.PI / 4);
    values.push(0, 0, Math.sin(angle / 2), Math.cos(angle / 2));
  }
  const output = addAccessor(values, "VEC4", 5126);
  samplers.push({ input: times, output, interpolation: "LINEAR" });
  channels.push({ sampler: index, target: { node: index + 1, path: "rotation" } });
});
gltf.animations.push({ name: "Rotores", channels, samplers });

const binary = Buffer.concat(chunks);
gltf.buffers.push({ byteLength: binary.length });
const jsonPadding = (4 - (Buffer.byteLength(JSON.stringify(gltf)) % 4)) % 4;
const json = Buffer.from(JSON.stringify(gltf) + " ".repeat(jsonPadding));
const binaryPadding = (4 - (binary.length % 4)) % 4;
const binaryPadded = Buffer.concat([binary, Buffer.alloc(binaryPadding)]);
const totalLength = 12 + 8 + json.length + 8 + binaryPadded.length;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLength, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(json.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binaryHeader = Buffer.alloc(8);
binaryHeader.writeUInt32LE(binaryPadded.length, 0);
binaryHeader.writeUInt32LE(0x004e4942, 4);

const bytes = Buffer.concat([header, jsonHeader, json, binaryHeader, binaryPadded]);
const outputWeb = new URL("../web/public/models/dron-reparto.glb", import.meta.url);
mkdirSync(new URL("../web/public/models/", import.meta.url), { recursive: true });
writeFileSync(outputWeb, bytes);
// Copia idéntica para el escritorio (clean-room: el asset se hornea fuera de desktop/).
const outputDesktop = new URL("../desktop/assets/corredor-dron.glb", import.meta.url);
mkdirSync(new URL("../desktop/assets/", import.meta.url), { recursive: true });
writeFileSync(outputDesktop, bytes);
console.log(`Modelo GLB generado: ${totalLength} bytes, ${gltf.meshes.length} mallas, ${motors.length} rotores animados (web + desktop).`);

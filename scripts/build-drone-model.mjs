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

  vertex(position, normal) {
    const index = this.positions.length / 3;
    this.positions.push(...position);
    this.normals.push(...normal);
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

const materials = [
  // Materiales claros: un dron de reparto real es gris/blanco. Los valores
  // anteriores (0.025 de albedo, 0.65 metálico) se veían negros sin un mapa de
  // entorno IBL, que es justo lo que Cesium no trae por defecto.
  { name: "Carbono", color: [0.16, 0.18, 0.21, 1], metallic: 0.3, roughness: 0.5 },
  { name: "Carcasa", color: [0.62, 0.65, 0.68, 1], metallic: 0.12, roughness: 0.45 },
  { name: "Metal", color: [0.55, 0.58, 0.62, 1], metallic: 0.55, roughness: 0.35 },
  { name: "Acento", color: [0.04, 0.62, 0.86, 1], metallic: 0.2, roughness: 0.3 },
  { name: "Paquete", color: [0.68, 0.31, 0.075, 1], metallic: 0, roughness: 0.82 },
  { name: "Correas", color: [0.12, 0.065, 0.025, 1], metallic: 0, roughness: 0.9 },
  { name: "Lente", color: [0.008, 0.015, 0.025, 1], metallic: 0.35, roughness: 0.08 },
  { name: "Rojo", color: [0.85, 0.025, 0.02, 1], metallic: 0.1, roughness: 0.25, emissive: [0.8, 0.01, 0.01] },
  { name: "Verde", color: [0.02, 0.8, 0.22, 1], metallic: 0.1, roughness: 0.25, emissive: [0.01, 0.75, 0.12] },
  { name: "Blanco", color: [0.85, 0.92, 1, 1], metallic: 0.1, roughness: 0.2, emissive: [0.7, 0.8, 1] },
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

part("Carcasa", box([0, 0, 0], [0.62, 0.43, 0.13]));
part("Carcasa", ellipsoid([0, -0.015, 0.075], [0.28, 0.215, 0.085]));
part("Acento", box([0, 0.216, 0.045], [0.18, 0.025, 0.055]));
part("Carbono", box([0, -0.02, 0.14], [0.3, 0.21, 0.06]));
part("Carbono", box([0, -0.02, 0.174], [0.315, 0.035, 0.018]));
part("Metal", cylinder([-0.07, -0.12, 0.17], [-0.07, -0.12, 0.205], 0.035, 16));
part("Carbono", cylinder([0.1, -0.16, 0.08], [0.15, -0.31, 0.3], 0.008, 8));
part("Blanco", ellipsoid([0.15, -0.31, 0.3], [0.012, 0.012, 0.012], 10, 6));

const motors = [];
for (const sx of [-1, 1]) {
  for (const sy of [-1, 1]) {
    const x = sx * 0.34;
    const y = sy * 0.34;
    motors.push([x, y, 0.15]);
    part("Carbono", cylinder([sx * 0.18, sy * 0.14, 0], [x, y, 0.025], 0.032));
    part("Metal", cylinder([x, y, 0.015], [x, y, 0.105], 0.058, 18));
    part("Carcasa", cylinder([x, y, 0.102], [x, y, 0.13], 0.064, 18));
    part("Acento", cylinder([x, y, 0.13], [x, y, 0.137], 0.037, 16));
    part("Carbono", cylinder([sx * 0.17, sy * 0.15, -0.065], [sx * 0.27, sy * 0.25, -0.3], 0.018, 10));
    part(sx < 0 ? "Rojo" : "Verde", ellipsoid([sx * 0.325, sy * 0.325, 0.055], [0.022, 0.022, 0.018], 12, 8));
  }
}
for (const side of [-1, 1]) {
  part("Carbono", cylinder([side * 0.27, -0.31, -0.3], [side * 0.27, 0.31, -0.3], 0.023, 12));
  part("Metal", cylinder([side * 0.27, 0.27, -0.3], [side * 0.27, 0.33, -0.285], 0.024, 12));
}

part("Carcasa", ellipsoid([0, 0.19, -0.11], [0.075, 0.075, 0.07], 18, 12));
part("Metal", cylinder([0, 0.22, -0.11], [0, 0.285, -0.11], 0.044, 18));
part("Lente", cylinder([0, 0.285, -0.11], [0, 0.3, -0.11], 0.035, 18));
part("Acento", ellipsoid([0, 0.303, -0.11], [0.016, 0.005, 0.016], 12, 8));

// El paquete ya NO vive dentro del GLB: lo dibuja MissionDirector como una
// entidad propia para poder transferirlo del repartidor al dron y al receptor.
// Aquí solo queda el anclaje inferior del fuselaje.
part("Metal", box([0, -0.02, -0.205], [0.2, 0.16, 0.03]));
part("Blanco", ellipsoid([0, -0.235, 0.035], [0.018, 0.014, 0.014], 12, 8));

const rotor = new Geometry();
rotor.positions.push(...box([0.135, 0, 0], [0.21, 0.028, 0.007]).positions);
rotor.normals.push(...box([0.135, 0, 0], [0.21, 0.028, 0.007]).normals);
rotor.indices.push(...box([0.135, 0, 0], [0.21, 0.028, 0.007]).indices);
const secondBlade = box([-0.135, 0, 0], [0.21, 0.028, 0.007]);
const secondOffset = rotor.positions.length / 3;
rotor.positions.push(...secondBlade.positions);
rotor.normals.push(...secondBlade.normals);
rotor.indices.push(...secondBlade.indices.map((index) => index + secondOffset));
const hub = cylinder([0, 0, -0.012], [0, 0, 0.018], 0.025, 14);
const hubOffset = rotor.positions.length / 3;
rotor.positions.push(...hub.positions);
rotor.normals.push(...hub.normals);
rotor.indices.push(...hub.indices.map((index) => index + hubOffset));
append(rotorParts, "Carbono", rotor);

const gltf = {
  asset: { version: "2.0", generator: "UTS-UIS procedural delivery drone" },
  scene: 0,
  scenes: [{ nodes: [0, 1, 2, 3, 4] }],
  nodes: [
    { name: "DronReparto", mesh: 0 },
    ...motors.map((position, index) => ({ name: `Rotor${index + 1}`, mesh: 1, translation: position })),
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
    doubleSided: false,
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
    primitives.push({
      attributes: {
        POSITION: addAccessor(geometry.positions, "VEC3", 5126, true),
        NORMAL: addAccessor(geometry.normals, "VEC3", 5126),
      },
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

const output = new URL("../web/public/models/dron-reparto.glb", import.meta.url);
mkdirSync(new URL("../web/public/models/", import.meta.url), { recursive: true });
writeFileSync(output, Buffer.concat([header, jsonHeader, json, binaryHeader, binaryPadded]));
console.log(`Modelo GLB generado: ${totalLength} bytes, ${gltf.meshes.length} mallas, ${motors.length} rotores animados.`);

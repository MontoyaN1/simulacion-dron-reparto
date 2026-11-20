// Afirmaciones del contrato del GLB del dron (generado por build-drone-model.mjs).
// Uso: node scripts/check-drone-model.mjs [ruta.glb]
import { readFileSync } from "node:fs";

const ruta =
  process.argv[2] ??
  new URL("../web/public/models/dron-reparto.glb", import.meta.url).pathname;
const buf = readFileSync(ruta);

const assert = (cond, msg) => {
  if (!cond) {
    console.error("FALLO:", msg);
    process.exit(1);
  }
};

assert(buf.readUInt32LE(0) === 0x46546c67, "magic glTF");
assert(buf.readUInt32LE(4) === 2, "versión glTF 2");
const jsonLen = buf.readUInt32LE(12);
assert(buf.readUInt32LE(16) === 0x4e4f534a, "primer chunk es JSON");
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));

// Cuerpo + 4 rotores + estrobo + 4 estelas. Los nombres son el contrato del
// escritorio: gira/parpadea por código, sin depender de índices de animación.
assert(gltf.scenes[0].nodes.length === 10, "10 nodos en la escena");
const nombres = gltf.nodes.map((n) => n.name);
const esperados = [
  "DronReparto",
  "Rotor1", "Rotor2", "Rotor3", "Rotor4",
  "Strobe",
  "Estela1", "Estela2", "Estela3", "Estela4",
];
for (const [i, esperado] of esperados.entries()) {
  assert(nombres[i] === esperado, `nodo ${i}: esperado ${esperado}, recibido ${nombres[i]}`);
}
assert(gltf.nodes[5].mesh === 2, "Strobe -> malla Estrobo");
for (let i = 6; i < 10; i += 1) {
  assert(gltf.nodes[i].mesh === 3, `${nombres[i]} -> malla Estela`);
  const rotor = gltf.nodes[i - 5];
  assert(
    JSON.stringify(gltf.nodes[i].translation) === JSON.stringify(rotor.translation),
    `${nombres[i]} comparte posición con ${rotor.name}`,
  );
}

// Mallas: estructura, aspas, estrobo y estelas (no hay malla de contorno).
assert(gltf.meshes.length === 4, "4 mallas");
assert(gltf.meshes[2].name === "Estrobo", "malla Estrobo");
assert(gltf.meshes[3].name === "Estela", "malla Estela");
const materialPorNombre = (nombre) => gltf.materials.findIndex((m) => m.name === nombre);
const blanco = materialPorNombre("Blanco");
const cian = materialPorNombre("Cian");
const estela = materialPorNombre("Estela");
assert(blanco >= 0 && cian >= 0 && estela >= 0, "materiales Blanco, Cian y Estela");
assert(
  gltf.meshes[2].primitives[0].material === blanco,
  "estrobo usa el material Blanco (emisivo)",
);
for (const nombre of ["Blanco", "Cian", "Rojo", "Verde"]) {
  const material = gltf.materials[materialPorNombre(nombre)];
  assert(
    Math.max(...material.emissiveFactor) > 1,
    `${nombre} tiene emisión HDR (> 1)`,
  );
}
assert(
  gltf.meshes[1].primitives.some((p) => p.material === cian),
  "las aspas tienen puntas Cian",
);

// Estela: invisible en el GLB para no alterar la web. El escritorio sube alfa
// con el régimen; COLOR_0 contiene el desvanecimiento angular de los arcos.
const matEstela = gltf.materials[estela];
assert(matEstela.alphaMode === "BLEND", "Estela usa alphaMode BLEND");
assert(matEstela.pbrMetallicRoughness.baseColorFactor[3] === 0, "Estela nace con alfa 0");
for (const primitivo of gltf.meshes[3].primitives) {
  assert(primitivo.material === estela, "primitivo Estela con material Estela");
  assert(primitivo.attributes.COLOR_0 !== undefined, "Estela lleva COLOR_0");
  assert(
    gltf.accessors[primitivo.attributes.COLOR_0].count ===
      gltf.accessors[primitivo.attributes.POSITION].count,
    "un color por vértice en Estela",
  );
}
for (const malla of gltf.meshes.slice(0, 3)) {
  for (const primitivo of malla.primitives) {
    assert(primitivo.attributes.COLOR_0 === undefined, `COLOR_0 solo en Estela (${malla.name})`);
  }
}

// Animación embebida: contrato de la web vía Cesium; desktop no la evalúa.
assert(gltf.animations.length === 1, "1 animación");
const anim = gltf.animations[0];
assert(anim.name === "Rotores" && anim.channels.length === 4, "Rotores con 4 canales");
for (let i = 0; i < 4; i += 1) {
  assert(anim.channels[i].target.node === i + 1, `canal ${i} apunta a Rotor${i + 1}`);
  assert(anim.channels[i].target.path === "rotation", "canal de rotación");
}

const bbox = (malla) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const primitivo of malla.primitives) {
    const acc = gltf.accessors[primitivo.attributes.POSITION];
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i], acc.min[i]);
      max[i] = Math.max(max[i], acc.max[i]);
    }
  }
  return min.map((v, i) => max[i] - v);
};
const vertices = (malla) =>
  malla.primitives.reduce(
    (total, primitivo) => total + gltf.accessors[primitivo.attributes.POSITION].count,
    0,
  );

// La silueta general se conserva; la densidad evita volver a una caja low-poly.
const spanE = bbox(gltf.meshes[0]);
assert(spanE[0] > 0.75 && spanE[0] < 0.9, `span x estructura fuera de rango: ${spanE[0]}`);
assert(spanE[1] > 0.75 && spanE[1] < 0.9, `span y estructura fuera de rango: ${spanE[1]}`);
assert(spanE[2] > 0.55 && spanE[2] < 0.75, `span z estructura fuera de rango: ${spanE[2]}`);
assert(vertices(gltf.meshes[0]) > 12000, `estructura demasiado pobre: ${vertices(gltf.meshes[0])} vértices`);

// Aspas/estelas: diámetro 0.48 m; aspas delgadas, estelas finas en z.
const spanA = bbox(gltf.meshes[1]);
assert(spanA[0] > 0.44 && spanA[0] < 0.52, `span x aspas fuera de rango: ${spanA[0]}`);
assert(spanA[2] > 0.015 && spanA[2] < 0.06, `span z aspas fuera de rango: ${spanA[2]}`);
const spanEstela = bbox(gltf.meshes[3]);
assert(spanEstela[0] > 0.44 && spanEstela[0] < 0.52, `span x estela: ${spanEstela[0]}`);
assert(spanEstela[2] < 0.01, `estela deformada en z: ${spanEstela[2]}`);

console.log(
  `GLB OK: ${buf.length} bytes, ${vertices(gltf.meshes[0])} vértices de estructura, nodos [${nombres.join(", ")}]`,
);

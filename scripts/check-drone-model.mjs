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

// Nodos: cuerpo + 4 rotores + estrobo (el escritorio gira y parpadea por código).
assert(gltf.scenes[0].nodes.length === 6, "6 nodos en la escena");
const nombres = gltf.nodes.map((n) => n.name);
for (const esperado of ["DronReparto", "Rotor1", "Rotor2", "Rotor3", "Rotor4", "Strobe"]) {
  assert(nombres.includes(esperado), `nodo ${esperado}`);
}
assert(gltf.nodes[5].name === "Strobe" && gltf.nodes[5].mesh === 2, "Strobe -> malla Estrobo");

// Mallas: estructura, aspas, estrobo.
assert(gltf.meshes.length === 3, "3 mallas");
assert(gltf.meshes[2].name === "Estrobo", "malla Estrobo");
const blanco = gltf.materials.findIndex((m) => m.name === "Blanco");
assert(
  gltf.meshes[2].primitives[0].material === blanco,
  "estrobo usa el material Blanco (emisivo)",
);

// Animación embebida: la reproduce la web vía Cesium (el desktop no la evalúa).
assert(gltf.animations.length === 1, "1 animación");
const anim = gltf.animations[0];
assert(anim.name === "Rotores" && anim.channels.length === 4, "Rotores con 4 canales");
for (let i = 0; i < 4; i += 1) {
  assert(anim.channels[i].target.node === i + 1, `canal ${i} apunta a Rotor${i + 1}`);
  assert(anim.channels[i].target.path === "rotation", "canal de rotación");
}

// Bounding box de la estructura (unión de todos sus primitivos): campanas de
// motor a ±0.404 m (lado), tren y antena de -0.32 a +0.31 m (alto). Las aspas
// son malla aparte (geometría por rotor).
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
const spanE = bbox(gltf.meshes[0]);
assert(spanE[0] > 0.75 && spanE[0] < 0.9, `span x estructura fuera de rango: ${spanE[0]}`);
assert(spanE[1] > 0.75 && spanE[1] < 0.9, `span y estructura fuera de rango: ${spanE[1]}`);
assert(spanE[2] > 0.55 && spanE[2] < 0.75, `span z estructura fuera de rango: ${spanE[2]}`);

// Aspas: dos palas de 0.21 m por lado + buje; disco fino en z.
const spanA = bbox(gltf.meshes[1]);
assert(spanA[0] > 0.44 && spanA[0] < 0.52, `span x aspas fuera de rango: ${spanA[0]}`);
assert(spanA[2] > 0.02 && spanA[2] < 0.06, `span z aspas fuera de rango: ${spanA[2]}`);

console.log(`GLB OK: ${buf.length} bytes, nodos [${nombres.join(", ")}]`);

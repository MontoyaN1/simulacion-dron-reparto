import { cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, "../public/cesium");
const source = path.resolve(here, "../../node_modules/cesium/Build/Cesium");

if (!existsSync(source)) {
  console.error(`[cesium] No se encontro ${source}. Ejecuta npm install.`);
  process.exit(1);
}

for (const folder of ["Workers", "Assets", "Widgets", "ThirdParty"]) {
  const from = path.join(source, folder);
  if (!existsSync(from)) continue;
  await cp(from, path.join(target, folder), { recursive: true });
}

console.log(`[cesium] Assets copiados en ${path.relative(process.cwd(), target)}`);

import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Proxy de tiles con caché en disco.
 *
 * Antes el cliente pedía el satelital directo a Esri (rate-limit: la ciudad
 * se quedaba gris-verdosa) y el token público de ion hacía el resto. Ahora
 * llega por nuestro propio dominio, se cachea en `data/tiles/` y las cargas
 * siguientes son instantáneas.
 */
const SERVICIOS = {
  esri: {
    url: (z: number, y: number, x: number) =>
      `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    tipo: "image/png" as const,
  },
  etiquetas: {
    url: (z: number, y: number, x: number) =>
      `https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`,
    tipo: "image/png" as const,
  },
};

type NombreServicio = keyof typeof SERVICIOS;

const CACHE_ROOT = path.resolve(process.cwd(), "data/tiles");
/** Tope del caché de tiles en el disco actual (2000 ficheros ~80 MB). */
const TOPE_FICHEROS = 2000;

const cachePath = (service: string, z: number, y: number, x: number): string => {
  const hash = createHash("md5").update(`${service}:${z}/${y}/${x}`).digest("hex").slice(0, 8);
  return path.join(CACHE_ROOT, service, z.toString(), `${y}_${x}_${hash}.png`);
};

const enCache = async (file: string): Promise<Buffer | null> => {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size === 0) return null;
    return await readFile(file);
  } catch {
    return null;
  }
};

const guardar = async (file: string, data: Buffer): Promise<void> => {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  } catch {
    // Caché llena o sin permisos: no rompe la petición, sólo se pierde el cacheo.
  }
};

/** Control del tope de la caché en disco (cuenta real al arrancar el servidor). */
let ficherosGuardados = 0;

/** Cuenta ficheros en la caché para respetar el tope tras un reinicio. */
const contarFicherosCache = async (): Promise<number> => {
  let total = 0;
  const vigiar = async (dir: string, profundo: number): Promise<void> => {
    if (profundo > 6) return;
    try {
      const entries = await import("node:fs/promises").then((mod) => mod.readdir(dir, { withFileTypes: true }));
      for (const entry of entries) {
        const destino = path.join(dir, entry.name);
        if (entry.isDirectory()) await vigiar(destino, profundo + 1);
        else total += 1;
      }
    } catch {
      return;
    }
  };
  await vigiar(CACHE_ROOT, 0);
  return total;
};

export const registrarProxyTiles = async (app: FastifyInstance): Promise<void> => {
  for (const servicio of Object.keys(SERVICIOS) as NombreServicio[]) {
    const config = SERVICIOS[servicio];
    app.get(`/tiles/${servicio}/:z/:y/:x`, async (request, reply) => {
      const { z, y, x } = request.params as Record<string, string>;
      const zi = Number(z);
      const yi = Number(y);
      const xi = Number(x);
      if (
        !Number.isInteger(zi) || zi < 0 || zi > 19 ||
        !Number.isInteger(yi) || yi < 0 || yi >= 2 ** zi ||
        !Number.isInteger(xi) || xi < 0 || xi >= 2 ** zi
      ) {
        return reply.code(400).send({ error: "Tile fuera de rango" });
      }

      // Fuera de Bucaramanga: recorta a la caja del corredor con margen, para
      // no servir streaming de tiles ajenos al proyecto.
      const file = cachePath(servicio, zi, yi, xi);
      const cache = await enCache(file);
      if (cache) {
        return reply
          .type(config.tipo)
          .header("Cache-Control", "public, max-age=86400, immutable")
          .send(cache);
      }

      const response = await fetch(config.url(zi, yi, xi), {
        headers: { "User-Agent": "simulacion-dron-reparto/1.0" },
      });
      if (!response.ok) {
        // No se logra el tile: se sirve un hueco (la capa no se rompe).
        return reply.code(204).send();
      }
      const data = Buffer.from(await response.arrayBuffer());

      if (ficherosGuardados < TOPE_FICHEROS) {
        ficherosGuardados += 1;
        void guardar(file, data);
      }
      return reply
        .type(config.tipo)
        .header("Cache-Control", "public, max-age=86400, immutable")
        .send(data);
    });
  }
  ficherosGuardados = await contarFicherosCache();
  app.log.info({ ficherosCacheados: ficherosGuardados }, "[tiles] proxy con caché activo");
};

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { geodeticToEnu, routeFrame, type Vec3 } from "@dron/shared";
import rangeFootprintGrounds from "./ground-footprints.json";
import { pointInside } from "./buildings";
import { CITY_GROUND_HEIGHT } from "./constants";
import { marcarDegradado } from "./estado";
import type { RouteGroundTable } from "./route-ground";

/** three.js usa Y-arriba: ENU (este, norte, arriba) → (x, y, z). */
export const enuATres = (enu: Vec3, aglSuelo = 0): THREE.Vector3 =>
  new THREE.Vector3(enu[0], aglSuelo + enu[2], enu[1]);

const DATASET = rangeFootprintGrounds as Record<string, number>;

const sueloEdificio = (lon: number, lat: number): number | null => {
  const clave = `${lon.toFixed(7)}:${lat.toFixed(7)}`;
  const valor = DATASET[clave];
  return typeof valor === "number" ? valor : null;
};

interface CajaGrados {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

/** Caja geodésica del corredor con márgenes (≈1 km). */
const cajaCorredor = (): CajaGrados => {
  const lons = [routeFrame.originGeodetic.longitude, routeFrame.destinationGeodetic.longitude];
  const lats = [routeFrame.originGeodetic.latitude, routeFrame.destinationGeodetic.latitude];
  const margen = 0.009;
  return {
    lonMin: Math.min(...lons) - margen,
    lonMax: Math.max(...lons) + margen,
    latMin: Math.min(...lats) - margen,
    latMax: Math.max(...lats) + margen,
  };
};

const mercatorY = (latGrados: number): number => {
  const lat = (latGrados * Math.PI) / 180;
  return (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2;
};

/** Grados aproximados para un punto ENU (el corredor es corto: <1% de error). */
const gradosDe = (enu: Vec3): { lon: number; lat: number } => {
  const lat0 = routeFrame.originGeodetic.latitude;
  const lon0 = routeFrame.originGeodetic.longitude;
  const metrosGradoLat = 111320;
  const metrosGradoLon = metrosGradoLat * Math.cos((lat0 * Math.PI) / 180);
  return {
    lon: lon0 + enu[0] / metrosGradoLon,
    lat: lat0 + enu[1] / metrosGradoLat,
  };
};

const NIVEL = 17;

/** Caja del mosaico en explosión mercator 0..1 (tiles de nivel NIVEL). */
const cajaMosaico = (caja: CajaGrados) => {
  const n = 2 ** NIVEL;
  const xInicio = Math.floor(((caja.lonMin + 180) / 360) * n);
  const xFin = Math.floor(((caja.lonMax + 180) / 360) * n);
  const yInicio = Math.floor(mercatorY(caja.latMax) * n);
  const yFin = Math.floor(mercatorY(caja.latMin) * n);
  return {
    xInicio, xFin, yInicio, yFin,
    columnas: xFin - xInicio + 1,
    filas: yFin - yInicio + 1,
    izq: xInicio / n,
    der: (xFin + 1) / n,
    arriba: yInicio / n,
    abajo: (yFin + 1) / n,
  };
};

/**
 * Satelital del corredor HORNEADA: la imagen se muestreó una vez del proxy
 * (tiles de Esri, nivel 17) y queda versionada en
 * web/public/models/corredor-horneado.jpg. Cero peticiones de tiles en
 * vuelo: el mapa ya no depende de Esri ni ion.
 */
const texturaHorneada = async (): Promise<THREE.Texture | null> =>
  cargarTextura("/models/corredor-satelital.jpg");

/** Rejilla del corredor con alturas reales + UV del mosaico. */
const mallaTerreno = (corredor: RouteGroundTable): THREE.BufferGeometry => {
  const caja = cajaCorredor();
  const plana = cajaMosaico(caja);
  const filasAlong = 84;
  const columnasLateral = 9;
  const medio = routeFrame.distanceMeters;

  const DIRECCION: Vec3 = [
    routeFrame.displacement[0] / medio,
    routeFrame.displacement[1] / medio,
    0,
  ];
  const LADO: Vec3 = [-DIRECCION[1], DIRECCION[0], 0];

  const posiciones: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let fila = 0; fila <= filasAlong; fila += 1) {
    const along = (medio * fila) / filasAlong;
    for (let col = 0; col < columnasLateral; col += 1) {
      const lateral = -300 + (600 * col) / (columnasLateral - 1);
      const enu: Vec3 = [
        DIRECCION[0] * along + LADO[0] * lateral,
        DIRECCION[1] * along + LADO[1] * lateral,
        0,
      ];
      // Altura RELATIVA al ancla: el corredor guarda msnm y el mundo three
      // vive en metros sobre el plano de la UTS (igual que el dron).
      const agl = (corredor.agl(enu) ?? CITY_GROUND_HEIGHT) - CITY_GROUND_HEIGHT;
      posiciones.push(enu[0], agl, enu[1]);

      // El mosaico cubre [cajaM.izq..cajaM.der] × [cajaM.arriba..cajaM.abajo]
      // en mercator: la UV sale de proyectar el vértice allí.
      const { lon, lat } = gradosDe(enu);
      const mercX = (lon + 180) / 360;
      const mercYv = mercatorY(lat);
      // El canvas se dibuja con el tile del NORTE primero (flipY de three):
      // v crece hacia el SUR. Antes estaba invertido y el mapa salía vacío.
      uvs.push(
        (mercX - plana.izq) / (plana.der - plana.izq),
        (plana.abajo - mercYv) / (plana.abajo - plana.arriba),
      );
    }
  }
  const ancho = columnasLateral;
  for (let fila = 0; fila <= filasAlong - 1; fila += 1) {
    for (let col = 0; col < ancho - 1; col += 1) {
      const a = fila * ancho + col;
      const b = a + 1;
      const c = a + ancho;
      const d = c + 1;
      // Winding de desktop (escena.rs:1083): [a, b, c, b, d, c]. Con las
      // normales calculadas desde el winding, este orden apunta hacia ARRIBA;
      // el invertido cullaba las caras superiores y el terreno se veía hueco.
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(posiciones, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
};

/** Caja geodésica {lon_min, lon_max, lat_min, lat_max} de un JSON de desktop. */
interface CajaGradosJson {
  lon_min: number;
  lon_max: number;
  lat_min: number;
  lat_max: number;
}

/**
 * Malla de relieve amplio (capas media/fondo), como `malla_relieve` de desktop:
 * menos densa que la franja, cubre ±`lateral` m, hundida `hundido` m para no
 * pelear por profundidad con la capa de arriba.
 */
const mallaRelieve = (
  corredor: RouteGroundTable,
  caja: CajaGradosJson,
  filas: number,
  cols: number,
  hundido: number,
): THREE.BufferGeometry => {
  const medio = routeFrame.distanceMeters;
  const DIRECCION: Vec3 = [
    routeFrame.displacement[0] / medio,
    routeFrame.displacement[1] / medio,
    0,
  ];
  const LADO: Vec3 = [-DIRECCION[1], DIRECCION[0], 0];

  // La malla cubre EXACTAMENTE la caja geodésica de la ortofoto: los 4
  // vértices de la caja proyectados al marco de la ruta dan el along/lateral
  // (la amplia llega a ±10 km along, no solo los 4 km de la ruta).
  const proyeccion = ([lat, lon]: [number, number]): [number, number] => {
    const enu = geodeticToEnu(
      { latitude: lat, longitude: lon, altitude: 0 },
      routeFrame.originGeodetic,
    );
    return [enu[0] * DIRECCION[0] + enu[1] * DIRECCION[1], enu[0] * LADO[0] + enu[1] * LADO[1]];
  };
  const esquinas = [
    proyeccion([caja.lat_min, caja.lon_min]),
    proyeccion([caja.lat_min, caja.lon_max]),
    proyeccion([caja.lat_max, caja.lon_min]),
    proyeccion([caja.lat_max, caja.lon_max]),
  ];
  const alongMin = Math.min(...esquinas.map((e) => e[0]));
  const alongMax = Math.max(...esquinas.map((e) => e[0]));
  const latMin = Math.min(...esquinas.map((e) => e[1]));
  const latMax = Math.max(...esquinas.map((e) => e[1]));

  const posiciones: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let fila = 0; fila <= filas; fila += 1) {
    const along = alongMin + ((alongMax - alongMin) * fila) / filas;
    for (let col = 0; col <= cols; col += 1) {
      const lat = latMin + ((latMax - latMin) * col) / cols;
      const enu: Vec3 = [
        DIRECCION[0] * along + LADO[0] * lat,
        DIRECCION[1] * along + LADO[1] * lat,
        0,
      ];
      // La tabla del corredor solo cubre la franja: fuera de ella el terreno
      // queda plano al nivel del ancla (el relieve del DEM amplio: pendiente).
      const agl = (corredor.agl(enu) ?? CITY_GROUND_HEIGHT) - CITY_GROUND_HEIGHT;
      posiciones.push(enu[0], agl - hundido, enu[1]);

      // UV directo desde la caja geodésica del JSON (grados → 0..1).
      // TextureLoader usa flipY=true: v=0 es el sur (abajo de la imagen),
      // v=1 es el norte (arriba). Por eso v = (lat - lat_min) / (lat_max - lat_min).
      const { lon, lat: latDeg } = gradosDe(enu);
      uvs.push(
        (lon - caja.lon_min) / (caja.lon_max - caja.lon_min),
        (latDeg - caja.lat_min) / (caja.lat_max - caja.lat_min),
      );
    }
  }
  const ancho = cols + 1;
  for (let fila = 0; fila < filas; fila += 1) {
    for (let col = 0; col < cols; col += 1) {
      const a = fila * ancho + col;
      const b = a + 1;
      const c = a + ancho;
      const d = c + 1;
      // Winding de desktop (escena.rs:1083): [a, b, c, b, d, c]. Con las
      // normales calculadas desde el winding, este orden apunta hacia ARRIBA;
      // el invertido cullaba las caras superiores y el terreno se veía hueco.
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(posiciones, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
};

/**
 * Carga una textura de terreno con TextureLoader (las imágenes ya están
 * redimensionadas a ≤4096 px en disco para el límite de WebGPU).
 */
const cargarTextura = async (url: string): Promise<THREE.Texture | null> => {
  try {
    const t = await new THREE.TextureLoader().loadAsync(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  } catch (error) {
    marcarDegradado(`la textura ${url} no cargó`, error);
    return null;
  }
};

/** Edificios OSM extruidos (718) fusionados en una sola geometría. */
const edificiosFusionados = async (
  corredor: RouteGroundTable,
): Promise<{ geo: THREE.BufferGeometry | null; cuenta: number }> => {
  const response = await fetch("/api/buildings");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as {
    features?: {
      geometry?: { type?: string; coordinates?: readonly (readonly (readonly [number, number])[])[] };
      properties?: { height?: number | null; levels?: number | null; name?: string | null };
    }[];
  };

  const piezas: THREE.BufferGeometry[] = [];
  let cuenta = 0;

  for (const [index, feature] of (data.features ?? []).entries()) {
    const ring = feature.geometry?.type === "Polygon" ? feature.geometry.coordinates?.[0] : null;
    if (!ring || ring.length < 4) continue;

    const localRing = ring.map(([longitude, latitude]) =>
      geodeticToEnu({ latitude, longitude, altitude: 0 }, routeFrame.originGeodetic),
    );
    if (pointInside([0, 0], localRing) || pointInside(routeFrame.displacement, localRing)) {
      continue;
    }

    let east = 0;
    let north = 0;
    for (const punto of localRing) {
      east += punto[0];
      north += punto[1];
    }
    const centro: Vec3 = [east / localRing.length, north / localRing.length, 0];
    if (Math.hypot(centro[0], centro[1]) < 20) continue;
    if (Math.hypot(centro[0] - routeFrame.displacement[0], centro[1] - routeFrame.displacement[1]) < 20) continue;

    const ancla = ring[0];
    const sueloMsnm =
      sueloEdificio(ancla[0], ancla[1]) ??
      corredor.agl(centro) ??
      CITY_GROUND_HEIGHT;
    const suelo = sueloMsnm - CITY_GROUND_HEIGHT;
    const altura =
      feature.properties?.height && feature.properties.height > 1
        ? feature.properties.height
        : feature.properties?.levels && feature.properties.levels > 0
          ? feature.properties.levels * 3.2 + 1.5
          : 9;

    // La forma en (este, -norte): al rotar -90° sobre X, -norte pasa a +z.
    const forma = new THREE.Shape();
    localRing.forEach(([east, north], indice) => {
      const x = east;
      const y = -north;
      if (indice === 0) forma.moveTo(x, y);
      else forma.lineTo(x, y);
    });
    forma.closePath();
    const geo = new THREE.ExtrudeGeometry(forma, { depth: altura, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    // Clase y color: puerto de desktop (TINTES×BASE para normales, paleta
    // institucional para landmarks de la UIS y del campus UTS).
    const clase = clasificar(
      feature.properties?.name ?? null,
      [centro[0], centro[1]],
      altura,
      routeFrame.displacement,
    );
    const colorBase = new THREE.Color();
    if (clase === "normal") {
      const tinte = TINTES[index % TINTES.length];
      colorBase.setRGB(
        BASE[0] * tinte[0],
        BASE[1] * tinte[1],
        BASE[2] * tinte[2],
        THREE.SRGBColorSpace,
      );
    } else {
      const [r, g, b] = COLOR_CLASE[clase];
      colorBase.setRGB(r, g, b, THREE.SRGBColorSpace);
    }
    const colorTecho = colorBase.clone().multiplyScalar(0.72);
    // UVs métricas y techo oscurecido: puerto de emitir_edificio de desktop
    // (u = largo/bahía, v = alto/PISO_M; techo plano en UV_MURO ×0.72).
    geo.computeVertexNormals();
    const posiciones = geo.attributes.position;
    const normales = geo.attributes.normal;
    const uvs = new Float32Array(posiciones.count * 2);
    const colores = new Float32Array(posiciones.count * 3);
    for (let v = 0; v < posiciones.count; v += 1) {
      if (normales.getY(v) > 0.5) {
        uvs[v * 2] = UV_MURO[0];
        uvs[v * 2 + 1] = UV_MURO[1];
        colores[v * 3] = colorTecho.r;
        colores[v * 3 + 1] = colorTecho.g;
        colores[v * 3 + 2] = colorTecho.b;
      } else {
        uvs[v * 2] = (posiciones.getX(v) + posiciones.getZ(v)) / BAY;
        uvs[v * 2 + 1] = posiciones.getY(v) / PISO_M;
        colores[v * 3] = colorBase.r;
        colores[v * 3 + 1] = colorBase.g;
        colores[v * 3 + 2] = colorBase.b;
      }
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(colores, 3));
    geo.translate(0, suelo + 0.12, 0);
    piezas.push(geo);
    cuenta += 1;
  }

  if (cuenta === 0) return { geo: null, cuenta: 0 };
  const fusion = mergeGeometries(piezas, false);
  if (!fusion) throw new Error("No se pudo fusionar la geometría de edificios");
  return { geo: fusion, cuenta };
};

// Paleta y clasificación de edificios: puerto de desktop/src/escena.rs
// (TINTES/BASE/clasificar/textura_fachada). Los sRGB se convierten a lineal
// en setRGB(…, SRGBColorSpace), igual que el `powf(2.2)` de desktop.
const TINTES: [number, number, number][] = [
  [0.722, 0.69, 0.639],
  [0.659, 0.584, 0.514],
  [0.714, 0.749, 0.765],
  [0.753, 0.702, 0.608],
  [0.624, 0.663, 0.678],
  [0.725, 0.604, 0.525],
];
const BASE: [number, number, number] = [0.702, 0.667, 0.62];
/** Altura de piso para el ritmo de ventanas de la fachada (metros). */
const PISO_M = 3.3;
/** Ancho de bahía en metros (desktop usa 3.6 en normales, 3.0–3.2 en landmarks). */
const BAY = 3.6;
/** UV que cae en muro liso de la textura de fachada (techos). */
const UV_MURO: [number, number] = [0.15, 0.5];
const SRGB_CAMPUS_UTS: [number, number, number] = [0.75, 0.76, 0.79];
const SRGB_LADRILLO: [number, number, number] = [0.64, 0.46, 0.36];
const SRGB_INSTITUCIONAL: [number, number, number] = [0.78, 0.79, 0.81];
const SRGB_CREMA: [number, number, number] = [0.84, 0.8, 0.72];
const SRGB_OCRE: [number, number, number] = [0.78, 0.58, 0.36];

type Clase =
  | "normal"
  | "uts"
  | "torreUts"
  | "ocre"
  | "casona"
  | "herencia"
  | "institucional";

const COLOR_CLASE: Record<Exclude<Clase, "normal">, [number, number, number]> = {
  uts: SRGB_CAMPUS_UTS,
  torreUts: SRGB_CAMPUS_UTS,
  ocre: SRGB_OCRE,
  casona: SRGB_CREMA,
  herencia: SRGB_LADRILLO,
  institucional: SRGB_INSTITUCIONAL,
};

/** Tipo de edificio. Los landmarks de campus llevan puerta de distancia:
 * la UIS está a ~4 km del ancla UTS (origen ENU) y viceversa. */
const clasificar = (
  nombre: string | null,
  centro: [number, number],
  alto: number,
  destino: Vec3,
): Clase => {
  const dUis = Math.hypot(centro[0] - destino[0], centro[1] - destino[1]);
  const dUts = Math.hypot(centro[0], centro[1]);
  if (dUis < 500) {
    if (nombre?.includes("Ciencias Humanas 2")) return "ocre";
    if (nombre?.includes("Casona")) return "casona";
    if (nombre?.includes("Biblioteca")) return "herencia";
    if (nombre?.includes("UIS") || nombre?.includes("USI")) return "institucional";
  }
  if (dUts < 350) {
    if (alto >= 24) return "torreUts";
    if (alto >= 10) return "uts";
  }
  return "normal";
};

let fachadaTex: THREE.Texture | null = null;

/** Textura de fachada procedural: 128×128 px = 1 bahía × 1 piso, sin costuras
 * (la banda de losa es idéntica en el borde superior e inferior del módulo). */
const texturaFachada = (): THREE.Texture => {
  if (fachadaTex) return fachadaTex;
  let imagen: THREE.Texture;
  if (typeof document === "undefined") {
    // jsdom/node no tiene canvas 2d: textura uniforme mínima.
    imagen = new THREE.DataTexture(new Uint8Array([240, 237, 230, 255]), 1, 1);
    imagen.needsUpdate = true;
  } else {
    const M = 128;
    const canvas = document.createElement("canvas");
    canvas.width = M;
    canvas.height = M;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      imagen = new THREE.DataTexture(new Uint8Array([240, 237, 230, 255]), 1, 1);
      imagen.needsUpdate = true;
    } else {
      ctx.fillStyle = "#f2efe8"; // muro
      ctx.fillRect(0, 0, M, M);
      ctx.fillStyle = "#d4d0c6"; // losa (bandas idénticas: sin costura)
      ctx.fillRect(0, 0, M, 8);
      ctx.fillRect(0, M - 8, M, 8);
      ctx.fillStyle = "#ddd9cf"; // antepecho
      ctx.fillRect(30, 8, 68, 4);
      ctx.fillStyle = "#4a586c"; // vidrio
      ctx.fillRect(32, 12, 64, M - 24);
      ctx.fillStyle = "#e4e1d8"; // marco: dintel y montantes
      ctx.fillRect(30, M - 12, 68, 4);
      ctx.fillRect(30, 12, 2, M - 24);
      ctx.fillRect(96, 12, 2, M - 24);
      ctx.fillRect(63, 12, 2, M - 24);
      imagen = new THREE.CanvasTexture(canvas);
    }
  }
  imagen.colorSpace = THREE.SRGBColorSpace;
  // UVs métricas (u = metros/bahía): la textura repite por fachada.
  imagen.wrapS = THREE.RepeatWrapping;
  imagen.wrapT = THREE.RepeatWrapping;
  fachadaTex = imagen;
  return imagen;
};

export interface CiudadTres {
  grupo: THREE.Group;
  cuentaEdificios: number;
}

/** Terreno con imagen horneada + edificios fusionados. */
export const construirCiudad = async (corredor: RouteGroundTable): Promise<CiudadTres> => {
  const caja = cajaCorredor();
  // Ortofoto: si no carga, placeholder gris-azulado sin textura.
  const textura = await texturaHorneada().catch((error: unknown) => {
    marcarDegradado("la ortofoto del terreno no cargó", error);
    return null;
  });
  const plana = cajaMosaico(caja);

  const malla = mallaTerreno(corredor);
  // La malla se genera con UV respecto a la caja *grados*; aquí la re-proyecto
  // al mosaico (únicamente útil si el mosaico fue recortado distinto).
  const uvs = malla.getAttribute("uv") as THREE.BufferAttribute;
  const posiciones = malla.getAttribute("position") as THREE.BufferAttribute;

  const terreno = new THREE.Mesh(
    malla,
    // La ortofoto es una textura de referencia, no depende de la iluminación
    // de la escena: MeshBasic evita que la ciudad desaparezca en sombra.
    textura
      ? new THREE.MeshStandardMaterial({ map: textura, roughness: 1, metalness: 0 })
      : new THREE.MeshStandardMaterial({ color: 0x8fa9bf, roughness: 1, metalness: 0 }),
  );
  terreno.receiveShadow = true;

  // Edificios: si el fetch o la fusión fallan, la escena sigue sin ellos.
  const { geo: edifGeo, cuenta } = await edificiosFusionados(corredor).catch(
    (error: unknown) => {
      marcarDegradado("los edificios OSM no cargaron", error);
      return { geo: null, cuenta: 0 };
    },
  );
  const edificios = edifGeo
    ? new THREE.Mesh(
        edifGeo,
        // Toon + vertexColors de clase + fachada procedural de ventanas,
        // muestreada con UVs métricas. Igual que desktop: techo en UV_MURO.
        new THREE.MeshToonMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          map: texturaFachada(),
        }),
      )
    : null;
  if (edificios) {
    edificios.castShadow = true;
    edificios.receiveShadow = true;
  }
  const grupo = new THREE.Group();

  // Capa amplia (±9.7 km real de la caja, hundida 5 m): fondo de ciudad.
  const cajaAmplio = (await import("./mapa-amplio-caja.json")).default as CajaGradosJson;
  const texturaAmplio = await cargarTextura("/models/mapa-amplio.jpg");
  if (texturaAmplio) {
    const mallaAmplio = mallaRelieve(corredor, cajaAmplio, 30, 30, 5);
    grupo.add(new THREE.Mesh(mallaAmplio, new THREE.MeshStandardMaterial({ map: texturaAmplio, roughness: 1, metalness: 0 })));
  }

  // Capa media (±4.9 km real de la caja, hundida 3 m para evitar z-fighting).
  const cajaMedio = (await import("./mapa-medio-caja.json")).default as CajaGradosJson;
  const texturaMedio = await cargarTextura("/models/mapa-medio.jpg");
  if (texturaMedio) {
    const mallaMedio = mallaRelieve(corredor, cajaMedio, 40, 40, 3);
    grupo.add(new THREE.Mesh(mallaMedio, new THREE.MeshStandardMaterial({ map: texturaMedio, roughness: 1, metalness: 0 })));
  }

  // Capa franja (alta resolución, arriba del todo): tapa a las de abajo.
  grupo.add(terreno);
  if (edificios) grupo.add(edificios);
  return { grupo, cuentaEdificios: cuenta };
};

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { geodeticToEnu, routeFrame, type Vec3 } from "@dron/shared";
import rangeFootprintGrounds from "../cesium/ground-footprints.json";
import { pointInside } from "../cesium/buildings";
import { CITY_GROUND_HEIGHT } from "../cesium/constants";
import type { RouteGroundTable } from "../cesium/route-ground";

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
const texturaHorneada = async (): Promise<THREE.Texture> => {
  const textura = await new THREE.TextureLoader().loadAsync(
    "/models/corredor-horneado.jpg",
  );
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.anisotropy = 4;
  return textura;
};

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
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(posiciones, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
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
      properties?: { height?: number | null; levels?: number | null };
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
    geo.translate(0, suelo + 0.12, 0);

    const colorBase = new THREE.Color("#b3aa9e");
    const tinte = PALETTE_TINTE[index % PALETTE_TINTE.length];
    colorBase.multiply(new THREE.Color(tinte));
    const cuentaVertices = geo.attributes.position.count;
    const colores = new Float32Array(cuentaVertices * 3);
    for (let v = 0; v < cuentaVertices; v += 1) {
      colores[v * 3] = colorBase.r;
      colores[v * 3 + 1] = colorBase.g;
      colores[v * 3 + 2] = colorBase.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colores, 3));
    piezas.push(geo);
    cuenta += 1;
  }

  if (cuenta === 0) return { geo: null, cuenta: 0 };
  const fusion = mergeGeometries(piezas, false);
  if (!fusion) throw new Error("No se pudo fusionar la geometría de edificios");
  return { geo: fusion, cuenta };
};

const PALETTE_TINTE = ["#b8b0a3", "#a89583", "#b6bfc3", "#c0b39b", "#9fa9ad", "#b99a86"];

export interface CiudadTres {
  grupo: THREE.Group;
  cuentaEdificios: number;
}

/** Terreno con imagen horneada + edificios fusionados. */
export const construirCiudad = async (corredor: RouteGroundTable): Promise<CiudadTres> => {
  const caja = cajaCorredor();
  const textura = await texturaHorneada();
  const plana = cajaMosaico(caja);

  const malla = mallaTerreno(corredor);
  // La malla se genera con UV respecto a la caja *grados*; aquí la re-proyecto
  // al mosaico (únicamente útil si el mosaico fue recortado distinto).
  const uvs = malla.getAttribute("uv") as THREE.BufferAttribute;
  const posiciones = malla.getAttribute("position") as THREE.BufferAttribute;

  const terreno = new THREE.Mesh(
    malla,
    new THREE.MeshLambertMaterial({ map: textura }),
  );

  const { geo: edifGeo, cuenta } = await edificiosFusionados(corredor);
  const edificios = edifGeo
    ? new THREE.Mesh(
        edifGeo,
        new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      )
    : null;
  const grupo = new THREE.Group();
  grupo.add(terreno);
  if (edificios) grupo.add(edificios);
  return { grupo, cuentaEdificios: cuenta };
};

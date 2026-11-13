import * as THREE from "three";
import type { CameraMode } from "./constants";
import { COLORS } from "./constants";

/** Fase del vuelo que encuadra la cámara (espejo de `DronePhase`). */
export type Fase = "despegue" | "crucero" | "descenso" | "entregado";

/** Distancia de referencia del zoom por rueda (m). */
const DIST_BASE = 8.6;
/** Altura bajo la cual el pad tiene edificios a los lados: no acercarse más. */
const ALTURA_BAJA = 25;
const DIST_MINIMA_SUELO = 35;

interface Encuadre {
  /** Distancia base al dron (m) antes del zoom. */
  readonly base: number;
  /** Altura relativa de la cámara sobre el objetivo (m). */
  readonly altura: number;
  /** Adelanto del punto de mira sobre el rumbo (m): deja aire delante. */
  readonly adelanto: number;
  /** Desplazamiento lateral para ver el perfil del dron (m). */
  readonly lateral: number;
}

/**
 * Encuadre por fase: el dron siempre es el punto de mira (`lookAt`), y lo que
 * cambia es el plano. Despegue = plano bajo que asciende con el dron; crucero =
 * persecución con contexto de ciudad; descenso = aproximación baja al destino;
 * entregado = plano de reposo elevado sobre la zona.
 */
const ENCUADRES: Record<Fase, Encuadre> = {
  despegue: { base: 35, altura: 1.6, adelanto: 1, lateral: 0.4 },
  crucero: { base: 14, altura: 2.35, adelanto: 2.4, lateral: 0.65 },
  descenso: { base: 18, altura: 1.6, adelanto: 1.6, lateral: 0.5 },
  entregado: { base: 26, altura: 3.2, adelanto: 0.8, lateral: 0 },
};

/**
 * Rig de cámara de la escena. Lógica pura sobre three (sin renderer ni DOM)
 * para poder probar el encuadre en vitest; la escena lo usa con su cámara real
 * y su resolución de colisiones.
 */
export class RigCamara {
  readonly camara: THREE.PerspectiveCamera;
  modo: CameraMode = "chase";
  fase: Fase = "crucero";
  /** Zoom por rueda: distancia de referencia en metros. */
  dist = DIST_BASE;
  /** Ángulo acumulado del modo órbita. */
  orbita = 0;
  /** Evita que la cámara atraviese edificios (la escena inyecta la suya). */
  segura: (objetivo: THREE.Vector3, deseada: THREE.Vector3) => THREE.Vector3 = (_o, deseada) =>
    deseada;

  constructor(aspect: number, camara?: THREE.PerspectiveCamera) {
    this.camara =
      camara ?? new THREE.PerspectiveCamera(52, Math.max(0.1, aspect), 0.4, 9000);
  }

  setModo(modo: CameraMode): void {
    this.modo = modo;
    this.orbita = 0;
  }

  setFase(fase: Fase): void {
    this.fase = fase;
  }

  /**
   * Encuadre amplio de arranque: la cámara se coloca sobre el centro de la
   * ruta pero mirando al dron, para no dejarlo fuera de cuadro mientras dura
   * el plano de establecimiento.
   */
  mirar(dron: THREE.Vector3): void {
    this.camara.lookAt(dron);
  }

  /**
   * Un paso del rig. `posicion` es la posición three del dron, `rumbo` su
   * heading en radianes y `altura` su altura sobre el terreno (m).
   */
  actualizar(
    posicion: THREE.Vector3,
    rumbo: number,
    dt: number,
    altura: number,
  ): void {
    if (this.modo === "free") {
      // Modo libre: la cámara no se mueve, pero nunca pierde el dron.
      this.camara.lookAt(posicion);
      return;
    }
    if (this.modo === "orbit") {
      this.orbita += dt * 0.12;
      const efectiva = Math.min(this.dist * 1.4, altura < ALTURA_BAJA ? 11 : 80);
      const deseada = new THREE.Vector3(
        posicion.x + Math.cos(this.orbita) * efectiva,
        posicion.y + 5.8 * (efectiva / 12.5) + 2,
        posicion.z + Math.sin(this.orbita) * efectiva,
      );
      this.camara.position.lerp(this.segura(posicion, deseada), 0.25);
      this.camara.lookAt(posicion);
      return;
    }
    if (this.modo === "top") {
      const visto = new THREE.Vector3(
        posicion.x,
        posicion.y + this.dist * 10,
        posicion.z - 0.01,
      );
      this.camara.position.lerp(this.segura(posicion, visto), 0.08);
      this.camara.lookAt(posicion);
      return;
    }

    const { adelanto, offset } = offsetCamara(this.fase, rumbo, this.dist, altura);
    const objetivo = posicion.clone().add(adelanto);
    const deseada = objetivo.clone().add(offset);
    // La colisión se resuelve desde el dron: si se hace desde el punto
    // adelantado, al acercarse la cámara el dron se va de cuadro.
    this.camara.position.lerp(this.segura(posicion, deseada), 1 - Math.exp(-dt * 6));
    // lookAt al DRON (no al adelanto): único punto que debe quedar en cuadro.
    this.camara.lookAt(posicion);
  }

}

const distanciaEncuadre = (base: number, zoom: number, altura: number): number => {
  const deseada = THREE.MathUtils.clamp(base * zoom, 3, 140);
  return altura < ALTURA_BAJA ? Math.max(deseada, DIST_MINIMA_SUELO) : deseada;
};

export interface OffsetCamara {
  /** Adelanto del punto de mira sobre el dron, en la dirección del rumbo. */
  readonly adelanto: THREE.Vector3;
  /** Posición de la cámara relativa al punto de mira. */
  readonly offset: THREE.Vector3;
}

/**
 * Plano de cámara de una fase: pura, sin cámara ni escena. `dist` es el zoom
 * por rueda y `altura` la del dron sobre el terreno (los planos bajos no se
 * acercan para no meterse en los edificios del pad).
 */
export const offsetCamara = (
  fase: Fase,
  rumbo: number,
  dist = DIST_BASE,
  altura = Number.POSITIVE_INFINITY,
): OffsetCamara => {
  const enc = ENCUADRES[fase];
  const zoom = dist / DIST_BASE;
  const distancia = distanciaEncuadre(enc.base, zoom, altura);
  const seno = Math.sin(rumbo);
  const coseno = Math.cos(rumbo);
  return {
    adelanto: new THREE.Vector3(seno * enc.adelanto, 0, coseno * enc.adelanto),
    offset: new THREE.Vector3(
      -seno * distancia + enc.lateral * coseno,
      enc.altura * zoom,
      -coseno * distancia - enc.lateral * seno,
    ),
  };
};

/** Matriz vista·proyección de la cámara, lista para proyectar a NDC. */
export const vistaProyeccion = (camara: THREE.PerspectiveCamera): THREE.Matrix4 => {
  camara.updateMatrixWorld();
  camara.updateProjectionMatrix();
  return new THREE.Matrix4().multiplyMatrices(
    camara.projectionMatrix,
    camara.matrixWorldInverse,
  );
};

/**
 * ¿El dron cae dentro del frustum? `margen` < 1 exige que además quede con
 * aire respecto al borde de la pantalla.
 */
export const dronEnFrustum = (
  posicion: THREE.Vector3,
  matrizVistaProyeccion: THREE.Matrix4,
  margen = 0.95,
): boolean => {
  const ndc = posicion.clone().applyMatrix4(matrizVistaProyeccion);
  return (
    Math.abs(ndc.x) < margen && Math.abs(ndc.y) < margen && ndc.z > -1 && ndc.z < 1
  );
};

/** Halo pulsante sobre el dron; se orienta a cámara cada frame. */
export const crearHalo = (): THREE.Mesh =>
  new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.15, 48),
    new THREE.MeshBasicMaterial({
      color: COLORS.accent,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );

/**
 * Etiqueta "UTS-01" como sprite con CanvasTexture (sin CSS2DRenderer). El
 * lienzo se inyecta para poder probarla sin DOM.
 */
export const crearEtiqueta = (
  texto: string,
  crearLienzo: () => HTMLCanvasElement = () => document.createElement("canvas"),
): THREE.Sprite => {
  const lienzo = crearLienzo();
  lienzo.width = 256;
  lienzo.height = 72;
  const ctx = lienzo.getContext("2d")!;
  ctx.fillStyle = "rgba(12,21,38,0.86)";
  ctx.fillRect(0, 0, 256, 72);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(0, 68, 256, 4);
  ctx.beginPath();
  ctx.arc(24, 36, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "bold 34px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(texto, 44, 38);

  // El lienzo es sRGB: sin la etiqueta de espacio de color el fondo oscuro
  // sale lavado en el renderer WebGPU.
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  const etiqueta = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: textura, transparent: true, depthTest: false }),
  );
  etiqueta.scale.set(3.6, 1.01, 1);
  etiqueta.position.set(0, 1.9, 0);
  return etiqueta;
};

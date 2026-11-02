import * as THREE from "three";
import { routeFrame, type Telemetry, type Vec3 } from "@dron/shared";
import { enuATres } from "./ciudad";
import type { RouteGroundTable } from "../cesium/route-ground";
import type { MissionState } from "../mision/tipos";

const ENTREGA_MS = 3200;
const RECEPCION_MS = 3600;
const RADIO_UTS = 16;
const RADIO_UIS = 18;
const ALTURA_MANOS = 1.45;

const EL = (v: number): number => (v < 0.5 ? 2 * v * v : 1 - 2 * (1 - v) * (1 - v));
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

export interface PlanoCamara {
  readonly position: Vec3;
  readonly target: Vec3;
}

/**
 * Repartidor simplificado: torso con chaleco reflectante, cabeza, gorra,
 * piernas y brazos. Camina hacia el pad, se agacha con los brazos hacia el
 * dron y se aleja. Misma coreografía (walk → reach → idle → walk) que el
 * motor Cesium.
 */
class Repartidor {
  readonly grupo = new THREE.Group();
  poke = 0;
  caminando = false;
  /** Posición ENU del repartidor (x=este, y=norte) y z=0 sobre el suelo. */
  enu: Vec3 = [0, 0, 0];
  fase = 0;
  activo = true;

  constructor(
    chaleco: string,
    uniforme: string,
    private readonly resuelveSuelo: (enu: Vec3) => number | null,
  ) {
    const materialVestidura = new THREE.MeshLambertMaterial({ color: chaleco });
    const materialUniforme = new THREE.MeshLambertMaterial({ color: uniforme });
    const materialPiel = new THREE.MeshLambertMaterial({ color: "#c69b6f" });
    const materialOscuro = new THREE.MeshLambertMaterial({ color: "#0f172a" });

    const crear = (geom: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
      const malla = new THREE.Mesh(geom, mat);
      this.grupo.add(malla);
      return malla;
    };
    const torsoTres = crear(new THREE.CylinderGeometry(0.2, 0.16, 0.52, 12), materialUniforme);
    torsoTres.position.y = 1.17;
    const chalecoTres = crear(new THREE.CylinderGeometry(0.212, 0.175, 0.4, 12), materialVestidura);
    chalecoTres.position.y = 1.2;
    const cintaTres = crear(new THREE.CylinderGeometry(0.216, 0.214, 0.06, 12), new THREE.MeshLambertMaterial({ color: "#e2e8f0" }));
    cintaTres.position.y = 1.16;
    const cabezaTres = crear(new THREE.SphereGeometry(0.105, 14, 12), materialPiel);
    cabezaTres.position.y = 1.6;
    const gorraTres = crear(new THREE.SphereGeometry(0.108, 14, 10), materialOscuro);
    gorraTres.position.y = 1.665;
    const brazosTres = crear(new THREE.BoxGeometry(0.46, 0.1, 0.1), materialUniforme);
    brazosTres.position.y = 1.1;
    const piernasTres = crear(new THREE.BoxGeometry(0.24, 0.72, 0.2), materialUniforme);
    piernasTres.position.y = 0.36;
    const zapatosTres = crear(new THREE.BoxGeometry(0.28, 0.1, 0.3), materialOscuro);
    zapatosTres.position.y = 0.05;
  }

  colocar(enu: Vec3, rumbo: number): void {
    this.enu = [enu[0], enu[1], enu[2] ?? 0];
    this.grupo.rotation.y = -rumbo;
  }

  /** La posición de sus manos en ENU (donde el paquete se entrega). */
  manos(): Vec3 {
    return [this.enu[0], this.enu[1], 0.86 + this.poke * 0.42];
  }

  actualizar(dt: number): void {
    if (this.caminando) this.fase += dt;
    const latido = Math.sin(this.fase * 0.9) * 0.006;
    const agl = this.resuelveSuelo(this.enu) ?? 0;
    this.grupo.position.copy(enuATres(this.enu, agl));
    void this.fase;
  }
}

export class MisionTres {
  private estado: MissionState = "esperando";
  private desde: number = 0;
  private disparoEntrega = false;
  private disparoRecepcion = false;
  private paqueteCargado = false;
  private paquetes: THREE.Group[] = [];
  private repartidorUts: Repartidor;
  private repartidorUis: Repartidor;
  private origenUts: Vec3 = [-5.6, -8.4, 0];
  private origenUis: Vec3 = [routeFrame.displacement[0] + 6.4, routeFrame.displacement[1] + 9.4, 0];
  private retencion = false;
  private anillos: THREE.Mesh[] = [];
  private destruida = false;
  private banda = 0;
  private paquetePosicion = new THREE.Vector3();
  private paqueteObjetivo = new THREE.Vector3();
  private onEstado: (estado: MissionState) => void = () => undefined;
  private onEspera: (hold: boolean) => void = () => undefined;
  private ultimotelemetryT = 0;
  private ultimaFase: Telemetry["phase"] | null = null;

  constructor(
    private readonly corredor: RouteGroundTable,
    onEstado: (estado: MissionState) => void,
    onEspera: (hold: boolean) => void,
  ) {
    this.onEstado = onEstado;
    this.onEspera = onEspera;
    this.repartidorUts = new Repartidor("#f97316", "#1e293b", (enu) => this.corredor.agl(enu));
    this.repartidorUts.colocar(this.origenUts, 0.42);
    this.repartidorUis = new Repartidor("#facc15", "#1e293b", (enu) => this.corredor.agl(enu));
    this.repartidorUis.colocar(this.origenUis, Math.PI + 0.55);
    this.construirPaquete();
    this.construirZonas();
  }

  private construirPaquete(): void {
    const carton = new THREE.MeshLambertMaterial({ color: "#c08a52" });
    const cinta = new THREE.MeshLambertMaterial({ color: "#9a6b39" });
    const etiqueta = new THREE.MeshLambertMaterial({ color: "#f4f4f0" });
    const grupo = new THREE.Group();
    const caja = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.26), carton);
    const tira = new THREE.Mesh(new THREE.BoxGeometry(0.346, 0.224, 0.06), cinta);
    const sello = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.075, 0.266), etiqueta);
    grupo.add(caja, tira, sello);
    grupo.position.copy(this.paquetePosicion);
    this.paquetes.push(grupo);
  }

  private construirZonas(): void {
    const materialVerde = new THREE.MeshBasicMaterial({
      color: "#22c55e",
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
    });
    const materialNaranja = new THREE.MeshBasicMaterial({
      color: "#f97316",
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
    });
    const zona1 = new THREE.Mesh(
      new THREE.RingGeometry(RADIO_UTS - 0.4, RADIO_UTS, 48),
      materialVerde,
    );
    zona1.rotation.x = -Math.PI / 2;
    const zona2 = new THREE.Mesh(
      new THREE.RingGeometry(RADIO_UIS - 0.4, RADIO_UIS, 48),
      materialNaranja,
    );
    zona2.rotation.x = -Math.PI / 2;
    this.anillos = [zona1, zona2];
  }

  /** Zonas y paquete: se añaden a la escena cuando ésta lo pasa. */
  objetos(): THREE.Object3D[] {
    return [
      ...this.anillos,
      ...this.paquetes,
      this.repartidorUts.grupo,
      this.repartidorUis.grupo,
    ];
  }

  private actualizarPaquete(belly: Vec3, ahora: number): void {
    const manos = this.repartidorUts.manos();
    const destinoReceptor = this.repartidorUis.manos();
    const bellyLocal = belly;
    let objetivo: Vec3;
    if (this.estado === "animando_entrega") {
      const t = EL(clamp01((ahora - this.desde) / ENTREGA_MS));
      objetivo = lerpVec(manos, bellyLocal, clamp01((t - 0.52) / 0.3));
      if (t >= 0.8) this.paqueteCargado = true;
    } else if (this.estado === "animando_recepcion") {
      const t = EL(clamp01((ahora - this.desde) / RECEPCION_MS));
      objetivo = lerpVec(bellyLocal, destinoReceptor, clamp01((t - 0.45) / 0.28));
      if (t >= 0.72) this.paqueteCargado = false;
    } else if (this.paqueteCargado) {
      objetivo = bellyLocal;
    } else if (this.estado === "completado") {
      objetivo = destinoReceptor;
    } else {
      objetivo = manos;
    }
    this.paquetePosicion.copy(enuATres(objetivo, this.corredor.agl(objetivo) ?? 0));
  }

  /** Plano de cámara durante la entrega/recepción (relativo al dron). */
  shot(): PlanoCamara | null {
    if (this.estado === "animando_entrega") {
      return { position: [4.2, -5.4, 1.7], target: [1.0, -0.8, -0.3] };
    }
    if (this.estado === "animando_recepcion") {
      return { position: [4.6, 5.4, 1.8], target: [1.1, 0.9, -0.3] };
    }
    return null;
  }

  hoverZ(sample: Telemetry): number | null {
    if (this.estado === "animando_entrega" || (this.paqueteCargado && sample.t < 3)) return ALTURA_MANOS;
    return null;
  }

  private fijarEstado(estado: MissionState): void {
    if (this.estado === estado) return;
    this.estado = estado;
    this.desde = performance.now();
    this.onEstado(estado);
  }

  private fijarEspera(hold: boolean): void {
    if (this.retencion === hold) return;
    this.retencion = hold;
    this.onEspera(hold);
  }

  reset(): void {
    this.estado = "esperando";
    this.desde = 0;
    this.disparoEntrega = false;
    this.disparoRecepcion = false;
    this.paqueteCargado = false;
    this.banda = 0;
    this.repartidorUts.colocar(this.origenUts, 0.42);
    this.repartidorUis.colocar(this.origenUis, Math.PI + 0.55);
    this.fijarEspera(false);
    this.onEstado("esperando");
  }

  actualizar(sample: Telemetry, ahora: number, belly: Vec3, listo: boolean): void {
    if (this.destruida) return;

    const position = sample.position;
    const enUts = Math.hypot(position[0], position[1]) < RADIO_UTS;
    const enUis =
      Math.hypot(
        position[0] - routeFrame.displacement[0],
        position[1] - routeFrame.displacement[1],
      ) < RADIO_UIS;
    const transcurrido = ahora - this.desde;

    // Detección de reinicio del servidor (el reloj retrocede o vuelve a idle).
    const reinicio =
      (this.ultimaFase !== null && this.ultimaFase !== "idle" && sample.phase === "idle") ||
      sample.t + 1 < this.ultimotelemetryT;
    this.ultimotelemetryT = sample.t;
    this.ultimaFase = sample.phase;
    if (reinicio) {
      this.reset();
      return;
    }

    if (this.estado === "animando_entrega") {
      const alpha = clamp01(transcurrido / ENTREGA_MS);
      this.repartidorUts.caminando = alpha < 0.38;
      this.repartidorUts.enu = alpha < 0.38
        ? this.origenUts
        : this.origenUts;
      this.repartidorUts.poke = alpha > 0.5 ? 1 : 0;
      if (transcurrido >= ENTREGA_MS) {
        this.paqueteCargado = true;
        this.repartidorUts.caminando = false;
        this.fijarEstado("paquete_cargado");
      }
    } else if (this.estado === "animando_recepcion") {
      const alpha = clamp01(transcurrido / RECEPCION_MS);
      this.repartidorUis.caminando = alpha < 0.42;
      this.repartidorUis.poke = alpha > 0.58 ? 1 : 0;
      if (transcurrido >= RECEPCION_MS) {
        this.paqueteCargado = false;
        this.fijarEstado("completado");
      }
    } else if (this.estado === "paquete_cargado") {
      if (sample.phase === "delivered" && enUis && !this.disparoRecepcion) {
        this.disparoRecepcion = true;
        this.fijarEstado("animando_recepcion");
      }
    } else if (this.estado === "esperando" || this.estado === "en_zona") {
      if (sample.t > 4 && sample.phase !== "idle" && !this.disparoEntrega) {
        // Alguien abrió la página con el vuelo ya empezado.
        this.disparoEntrega = true;
        this.paqueteCargado = true;
        this.fijarEstado("paquete_cargado");
      } else if (!listo) {
        if (enUts || enUis) this.fijarEstado("en_zona");
      } else if (enUts && sample.t < 4 && !this.disparoEntrega) {
        this.disparoEntrega = true;
        this.paqueteCargado = false;
        this.fijarEstado("animando_entrega");
      } else if (enUts || enUis) {
        this.fijarEstado("en_zona");
      } else {
        this.fijarEstado("esperando");
      }
    }

    this.actualizarPaquete(belly, ahora);
    this.fijarEspera(!listo || this.estado === "animando_entrega" || this.estado === "animando_recepcion");
    for (const anillo of this.anillos) {
      this.banda = (this.banda + 0.004) % 1;
      anillo.rotation.z = this.banda * Math.PI * 2;
    }
  }

  destroy(): void {
    this.destruida = true;
    for (const grupo of this.paquetes) grupo.clear();
  }
}

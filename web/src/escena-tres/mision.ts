import * as THREE from "three";
import { routeFrame, type Telemetry, type Vec3 } from "@dron/shared";
import { CITY_GROUND_HEIGHT } from "../cesium/constants";
import { enuATres } from "./ciudad";
import type { RouteGroundTable } from "../cesium/route-ground";
import type { MissionState } from "../mision/tipos";

const RADIO_UTS = 16;
const RADIO_UIS = 18;

export interface PlanoCamara {
  readonly position: Vec3;
  readonly target: Vec3;
}

/**
 * Misión en modo continuo: sin personas ni secuencias de entrega.
 * El paquete permanece colgado del dron durante el vuelo y, al aterrizar en la
 * UIS, se queda en el pad. Los estados del chip salen de la propia telemetría.
 */
export class MisionTres {
  private estado: MissionState = "esperando";
  private onEstado: (estado: MissionState) => void;
  private paquete = new THREE.Group();
  private anillos: THREE.Mesh[] = [];
  private destruida = false;
  private paqueteEntregado = false;

  constructor(
    private readonly corredor: RouteGroundTable,
    onEstado: (estado: MissionState) => void,
  ) {
    this.onEstado = onEstado;
    this.construirPaquete();
    this.construirZonas();
  }

  private construirPaquete(): void {
    const carton = new THREE.MeshLambertMaterial({ color: "#c08a52" });
    const cinta = new THREE.MeshLambertMaterial({ color: "#9a6b39" });
    const etiqueta = new THREE.MeshLambertMaterial({ color: "#f4f4f0" });
    const caja = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.26), carton);
    const tira = new THREE.Mesh(new THREE.BoxGeometry(0.346, 0.224, 0.06), cinta);
    const sello = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.075, 0.266), etiqueta);
    this.paquete.add(caja, tira, sello);
  }

  private construirZonas(): void {
    const zona = (radio: number, color: string): THREE.Mesh => {
      const anillo = new THREE.Mesh(
        new THREE.RingGeometry(radio - 0.4, radio, 48),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
      );
      anillo.rotation.x = -Math.PI / 2;
      return anillo;
    };
    const uts = zona(RADIO_UTS, "#22c55e");
    const uis = zona(RADIO_UIS, "#f97316");
    this.anillos = [uts, uis];
  }

  /** Los objetos de la misión los añade la escena. */
  objetos(): THREE.Object3D[] {
    return [...this.anillos, this.paquete];
  }

  /** Posición del paquete en el mundo (three). */
  actualizarPaquete(sample: Telemetry, belly: THREE.Vector3): void {
    if (sample.phase === "delivered") {
      if (!this.paqueteEntregado) {
        this.paqueteEntregado = true;
        const destino: Vec3 = [
          routeFrame.displacement[0] + 1.2,
          routeFrame.displacement[1] - 1.0,
          0.13,
        ];
        const agl = (this.corredor.agl(destino) ?? CITY_GROUND_HEIGHT) - CITY_GROUND_HEIGHT;
        this.paquete.position.copy(enuATres(destino, agl));
        return;
      }
      return;
    }
    this.paqueteEntregado = false;
    this.paquete.position.copy(belly);
  }

  fijarEstado(sample: Telemetry, _enUis: boolean, enUts: boolean): void {
    let estado: MissionState = "esperando";
    if (sample.phase === "delivered") estado = "completado";
    else if (sample.phase === "descent" && _enUis) estado = "animando_recepcion";
    else if (sample.phase === "takeoff" && enUts) estado = "animando_entrega";
    else if (sample.phase === "cruise") estado = "paquete_cargado";
    else if (enUts || _enUis) estado = "en_zona";
    if (estado !== this.estado) {
      this.estado = estado;
      this.onEstado(estado);
    }
  }

  reset(): void {
    this.paqueteEntregado = false;
    this.onEstado("esperando");
  }

  destroy(): void {
    this.destruida = true;
  }
}

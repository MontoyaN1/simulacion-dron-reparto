import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { routeFrame, type Telemetry, type Vec3 } from "@dron/shared";
import {
  CITY_GROUND_HEIGHT,
  COLORS,
  GEAR_CLEARANCE,
  MISSION_ZONES,
  type CameraMode,
} from "../cesium/constants";
import { routeGroundHeight } from "../cesium/world";
import type { RouteGroundTable } from "../cesium/route-ground";
import type { MissionState } from "../mision/tipos";
import { construirCiudad, enuATres } from "./ciudad";
import { MisionTres } from "./mision";

const FOV = 52;
const TRAIL_MIN = 2.5;
const TRAIL_MAX_PUNTOS = 1500;

interface EscenaBuffer {
  sample: () => Telemetry | null;
}

export interface EscenaTresOpciones {
  readonly corredor: RouteGroundTable;
}

/** Escena three.js del corredor. Contrato igual al de la escena de Cesium. */
export class EscenaTres {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly mundo = new THREE.Scene();
  private readonly camara: THREE.PerspectiveCamera;
  private readonly contenedor: HTMLElement;
  private readonly corredor: RouteGroundTable;
  private readonly mision: MisionTres;

  private readonly dron = new THREE.Group();
  private dronMesh: THREE.Object3D | null = null;
  private readonly rotores: THREE.Object3D[] = [];
  private readonly paquete = new THREE.Group();
  private readonly sombraSuelo: THREE.Mesh;

  private readonly trail: THREE.Line;
  private trailPuntos: number[] = [];
  private lastTrailPoint: THREE.Vector3 | null = null;

  private readonly ruta: THREE.Line;

  private buffer: EscenaBuffer | null = null;
  private onEstado: ((estado: MissionState) => void) | null = null;
  private onHold: ((hold: boolean) => void) | null = null;
  private modo: CameraMode = "chase";
  private destruida = false;
  private lastFrame = performance.now();
  private rumboActual = 0;
  private pitchFuselage = 0;
  private rollFuselage = 0;
  private orbita = 0;
  private camaraBloqueada = true;
  /** Altura suavizada del terreno bajo el dron (m sobre el ancla). */
  private lastTrail = performance.now();
  private resizeObs: ResizeObserver;

  constructor(container: HTMLElement, opciones: EscenaTresOpciones) {
    this.contenedor = container;
    this.corredor = opciones.corredor;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.setSize(Math.max(2, container.clientWidth), Math.max(2, container.clientHeight));
    container.appendChild(this.renderer.domElement);

    this.camara = new THREE.PerspectiveCamera(
      FOV,
      Math.max(0.1, container.clientWidth / Math.max(1, container.clientHeight)),
      0.4,
      9000,
    );
    this.camara.position.set(0, 220, -420);
    this.camara.lookAt(0, 0, 0);
    this.mundo.background = new THREE.Color("#8fb4d8");
    this.mundo.fog = new THREE.Fog(new THREE.Color("#a9c4dd"), 1600, 4600);

    const hemisferio = new THREE.HemisphereLight(0xcfe7ff, 0x4a5d33, 1.15);
    const sol = new THREE.DirectionalLight(0xfff2d6, 1.35);
    sol.position.set(-900, 1200, -1400);
    this.mundo.add(hemisferio, sol, this.dron);

    this.sombraSuelo = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 24),
      new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.22 }),
    );
    this.sombraSuelo.rotation.x = -Math.PI / 2;
    this.mundo.add(this.sombraSuelo);
    this.mundo.add(this.paquete);

    this.trail = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.8 }),
    );
    this.mundo.add(this.trail);
    this.ruta = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: COLORS.accent, transparent: true, opacity: 0.85 }),
    );
    this.mundo.add(this.ruta);
    for (const objeto of this.etiquetasZona()) this.mundo.add(objeto);

    this.mision = new MisionTres(
      this.corredor,
      (estado) => this.onEstado?.(estado),
      (hold) => this.onHold?.(hold),
    );
    for (const objeto of this.mision.objetos()) this.mundo.add(objeto);

    this.resizeObs = new ResizeObserver(() => this.redimension());
    this.resizeObs.observe(container);
    this.redimension();

    void this.levantarCiudad();
    void this.levantarDron();
    requestAnimationFrame(this.bucle);
  }

  private redimension(): void {
    const ancho = Math.max(2, this.contenedor.clientWidth);
    const alto = Math.max(2, this.contenedor.clientHeight);
    this.renderer.setSize(ancho, alto);
    this.camara.aspect = ancho / alto;
    this.camara.updateProjectionMatrix();
  }

  /** Altura real del terreno (msnm y sobre el ancla) bajo un punto ENU. */
  private alturaSuelo(enu: Vec3): number {
    const corredor = this.corredor.agl(enu);
    if (corredor !== null && corredor !== undefined) return corredor - CITY_GROUND_HEIGHT;
    return routeGroundHeight(enu);
  }

  /** Rótulos y anillos de misión como sprites sobre el terreno. */
  private etiquetasZona(): THREE.Object3D[] {
    const salida: THREE.Object3D[] = [];
    const colocar = (pos: Vec3, titulo: string, color: string): void => {
      const agl = this.alturaSuelo(pos);
      const punto = enuATres(pos, agl);

      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 128;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "rgba(12,21,38,0.85)";
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = color;
      ctx.fillRect(0, 62, 256, 4);
      ctx.font = "bold 26px Inter, system-ui, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.fillText(titulo, 128, 42);

      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }),
      );
      sprite.scale.set(7.2, 3.6, 1);
      sprite.position.set(punto.x, punto.y + 7, punto.z);
      salida.push(sprite);

      const radio = pos[0] === 0 && pos[1] === 0 ? MISSION_ZONES.uts.radius : MISSION_ZONES.uis.radius;
      const anillo = new THREE.Mesh(
        new THREE.RingGeometry(radio - 0.35, radio, 48),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
      );
      anillo.rotation.x = -Math.PI / 2;
      anillo.position.set(punto.x, punto.y + 0.35, punto.z);
      salida.push(anillo);
    };
    colocar([0, 0, 0], "UTS · Despegue", COLORS.green);
    colocar(routeFrame.displacement, "UIS · Entrega", COLORS.orange);
    return salida;
  }

  /** Ciudad + edificios (async) añadidos cuando estén listos. */
  private async levantarCiudad(): Promise<void> {
    try {
      const ciudad = await construirCiudad(this.corredor);
      if (this.destruida) return;
      this.mundo.add(ciudad.grupo);
    } catch (error) {
      console.warn("[tres] No se pudo construir la ciudad", error);
    }
  }

  /** Dron glTF (rotores + fuselaje) y paquete colgante. */
  private async levantarDron(): Promise<void> {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync("/models/dron-reparto.glb");
      if (this.destruida) return;
      const modelo = gltf.scene;
      modelo.scale.setScalar(1.15);
      modelo.rotation.set(-Math.PI / 2, Math.PI, 0);
      modelo.traverse((nodo) => {
        if (/^rot/i.test(nodo.name)) this.rotores.push(nodo);
      });
      this.dronMesh = modelo;
      this.dron.add(modelo);
      const carton = new THREE.MeshLambertMaterial({ color: "#c08a52" });
      const cinta = new THREE.MeshLambertMaterial({ color: "#9a6b39" });
      const etiqueta = new THREE.MeshLambertMaterial({ color: "#f4f4f0" });
      this.paquete.add(
        new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.26), carton),
        new THREE.Mesh(new THREE.BoxGeometry(0.346, 0.224, 0.06), cinta),
        new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.075, 0.266), etiqueta),
      );
    } catch (error) {
      console.warn("[tres] No se pudo cargar el dron", error);
    }
  }

  attachBuffer(buffer: EscenaBuffer): void {
    this.buffer = buffer;
  }

  attachMissionState(onEstado: (estado: MissionState) => void): void {
    this.onEstado = onEstado;
  }

  attachHold(onHold: (hold: boolean) => void): void {
    this.onHold = onHold;
  }

  setRoute(ruta: readonly Vec3[]): void {    const puntos = ruta.map((punto) => {
      const agl = this.alturaSuelo([punto[0], punto[1], 0]);
      return enuATres(punto, agl + punto[2]);
    });
    this.ruta.geometry.setFromPoints(puntos);
    const caja = new THREE.Box3().setFromPoints(puntos);
    const centro = caja.getCenter(new THREE.Vector3());
    this.camara.position.set(centro.x, centro.y + 380, centro.z - 40);
    this.camara.lookAt(centro);
    this.camaraBloqueada = false;
  }

  setCameraMode(modo: CameraMode): void {
    this.modo = modo;
    this.orbita = 0;
  }

  /** Posición visual del dron (z already clamped al terreno real). */
  private displayDron(sample: Telemetry): Vec3 {
    const enu2: Vec3 = [sample.position[0], sample.position[1], 0];
    const agl = this.alturaSuelo(enu2);
    const z = Math.max(sample.position[2] + GEAR_CLEARANCE, agl * 0 + GEAR_CLEARANCE);
    void z;
    return [sample.position[0], sample.position[1], sample.position[2] + GEAR_CLEARANCE];
  }

  /** Rotores girando, inclinación según la aceleración y rastro del vuelo. */
  private actualizarDron(sample: Telemetry, dt: number): void {
    const display = this.displayDron(sample);
    const agl = this.alturaSuelo(display);
    const posicion = enuATres(display, agl);
    this.dron.position.copy(posicion);

    const rumbo = (sample.headingDeg * Math.PI) / 180;
    const velocidad = Math.hypot(sample.velocity[0], sample.velocity[1]);
    const lateral =
      sample.acceleration[0] * Math.cos(rumbo) - sample.acceleration[1] * Math.sin(rumbo);
    const mezcla = 1 - Math.exp(-dt * 6);
    const pitch = -Math.min(0.2, velocidad * 0.009);
    const roll = THREE.MathUtils.clamp(lateral * 0.12, -0.32, 0.32);
    this.pitchFuselage += (pitch - this.pitchFuselage) * mezcla;
    this.rollFuselage += (roll - this.rollFuselage) * mezcla;
    this.rumboActual = rumbo;
    this.dronMesh?.rotation.set(-Math.PI / 2 + this.pitchFuselage, Math.PI + this.rumboActual, this.rollFuselage);
    for (const rotor of this.rotores) rotor.rotation.y += dt * 24;

    const cerca = posicion.distanceTo(this.lastTrailPoint ?? posicion);
    if (!this.lastTrailPoint || cerca >= TRAIL_MIN) {
      if (this.lastTrailPoint && posicion.distanceTo(this.lastTrailPoint) > 240) {
        this.trailPuntos.length = 0;
      }
      this.lastTrailPoint = posicion.clone();
      this.trailPuntos.push(posicion.x, posicion.y, posicion.z);
      if (this.trailPuntos.length > TRAIL_MAX_PUNTOS * 3) {
        this.trailPuntos.splice(0, 3);
      }
      this.trail.geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.trailPuntos, 3));
    }
  }

  private camaraActualiza(sample: Telemetry, dt: number): void {
    if (this.camaraBloqueada) return;
    const display = this.displayDron(sample);
    const agl = this.alturaSuelo(display);
    const objetivo = new THREE.Vector3(display[0], agl + display[2], display[1]);
    if (this.modo === "chase") {
      const lateral = 0.65 * Math.cos(this.rumboActual);
      const suave = new THREE.Vector3(
        objetivo.x - Math.sin(this.rumboActual) * 8.6 + lateral,
        objetivo.y + 2.35,
        objetivo.z - Math.cos(this.rumboActual) * 8.6 - 0.65 * Math.sin(this.rumboActual),
      );
      this.camara.position.lerp(suave, 1 - Math.exp(-dt * 6));
      this.camara.lookAt(objetivo);
      return;
    }
    if (this.modo === "orbit") {
      this.orbita += dt * 0.12;
      const deorb = new THREE.Vector3(
        objetivo.x + Math.cos(this.orbita) * 12.5,
        objetivo.y + 5.8,
        objetivo.z + Math.sin(this.orbita) * 12.5,
      );
      this.camara.position.lerp(deorb, 0.25);
      this.camara.lookAt(objetivo);
      return;
    }
    if (this.modo === "top") {
      const visto = new THREE.Vector3(objetivo.x, objetivo.y + 85, objetivo.z - 0.01);
      this.camara.position.lerp(visto, 0.08);
      this.camara.lookAt(objetivo);
      return;
    }
    this.camara.lookAt(objetivo);
  }

  /** Bucle principal: minestro telemetría, misión, toma cinematográfica, render. */
  private readonly bucle = (): void => {
    requestAnimationFrame(this.bucle);
    if (this.destruida) return;
    const ahora = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (ahora - this.lastFrame) / 1000));
    this.lastFrame = ahora;
    const sample = this.buffer?.sample();
    if (!sample) {
      this.renderer.render(this.mundo, this.camara);
      return;
    }

    const listo = !this.camaraBloqueada;
    const display = this.displayDron(sample);
    const belly = [
      display[0],
      display[1],
      display[2] - 0.236,
    ] as Vec3;
    const puntoBelly = enuATres(belly, this.alturaSuelo(display) + display[2] - 0.236);
    this.paquete.position.copy(puntoBelly);
    this.sombraSuelo.position.set(display[0], this.alturaSuelo(display) + 0.25, display[1]);

    this.mision.actualizar(sample, ahora, belly, listo);
    const toma = this.mision.shot();
    if (toma) {
      const pos = enuATres(
        [
          display[0] + toma.position[0],
          display[1] + toma.position[1],
          display[2] + toma.position[2],
        ],
        this.alturaSuelo([
          display[0] + toma.position[0],
          display[1] + toma.position[1],
          0,
        ]) + display[2] + toma.position[2],
      );
      const mira = enuATres(
        [
          display[0] + toma.target[0],
          display[1] + toma.target[1],
          display[2] + toma.target[2],
        ],
        this.alturaSuelo([
          display[0] + toma.target[0],
          display[1] + toma.target[2],
          0,
        ]) + display[2] + toma.target[2],
      );
      this.camara.position.copy(pos);
      this.camara.lookAt(mira);
      this.actualizarDron(sample, dt);
    } else {
      this.camaraActualiza(sample, dt);
      this.actualizarDron(sample, dt);
    }

    this.renderer.render(this.mundo, this.camara);
  };

  destroy(): void {
    if (this.destruida) return;
    this.destruida = true;
    this.resizeObs.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

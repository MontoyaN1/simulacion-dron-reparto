import * as THREE from "three";
import { WebGPURenderer, PostProcessing } from "three/webgpu";
import { pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { routeFrame, type Telemetry, type Vec3 } from "@dron/shared";
import { calcularFps, detectarBackend, webgpuDisponible, type Backend } from "./render";
import { degradarPorFps, type EstadoVisual } from "./visual";
import {
  CITY_GROUND_HEIGHT,
  COLORS,
  GEAR_CLEARANCE,
  MISSION_ZONES,
  type CameraMode,
} from "./constants";
import { routeGroundHeight } from "./world";
import { marcarDegradado } from "./estado";
import type { RouteGroundTable } from "./route-ground";
import type { MissionState } from "../mision/tipos";
import { construirCiudad, enuATres } from "./ciudad";
import { MisionTres } from "./mision";
import { crearEtiqueta, crearHalo } from "./camara";

/** Fase de telemetría → fase de encuadre de cámara. */

const FOV = 52;
const TRAIL_MIN = 2.5;
const TRAIL_MAX_PUNTOS = 1500;

interface EscenaBuffer {
  sample: () => Telemetry | null;
}

export interface EscenaTresOpciones {
  readonly corredor: RouteGroundTable;
}

/** Escena three.js del corredor: único motor de render. */
export class EscenaTres {
  private readonly renderer: WebGPURenderer;
  private backendActivo: Backend = "webgl";
  private inicializado = false;
  private readonly fpsDeltas: number[] = [];
  private fpsValor = 0;
  private framesVistos = 0;
  private sol!: THREE.DirectionalLight;
  private post: PostProcessing | null = null;
  private readonly estadoVisual: EstadoVisual = { toon: true, sombras: true, bloom: true, nubes: true };
  private readonly mundo = new THREE.Scene();
  private readonly camara: THREE.PerspectiveCamera;
  private readonly contenedor: HTMLElement;
  private readonly corredor: RouteGroundTable;
  private readonly mision: MisionTres;
  private ciudad: THREE.Group | null = null;
  private readonly colision = new THREE.Raycaster();

  private readonly dron = new THREE.Group();
  private dronMesh: THREE.Object3D | null = null;
  private readonly rotores: THREE.Object3D[] = [];
  private readonly halo = crearHalo();
  private readonly etiqueta = crearEtiqueta("UTS-01");
  private readonly sombraSuelo: THREE.Mesh;

  private readonly trail: THREE.Line;
  private trailPuntos: number[] = [];
  private lastTrailPoint: THREE.Vector3 | null = null;

  private readonly ruta: THREE.Line;

  private buffer: EscenaBuffer | null = null;
  private onEstado: ((estado: MissionState) => void) | null = null;
  private onCamara: ((modo: CameraMode) => void) | null = null;
  /** Cámara estilo desktop (escena.rs:499): seguir, cine y órbita libre. */
  private camaraModo: CameraMode = "seguir";
  private azim = 0;
  private elev = 0.6;
  private dist = 75;
  /** Ejes fijos del corredor: los candidatos de persecución no rotan con el
   * rumbo instantáneo (esa rotación era el tambaleo heredado del legacy). */
  private readonly dirCorredor: THREE.Vector3;
  private readonly ladoCorredor: THREE.Vector3;
  private objetivoCamara = new THREE.Vector3();
  /** Altura del terreno bajo la cámara/drón filtrada en baja frecuencia: el
   * DEM por celdas escalona y esa escalera era el tambaleo residual. */
  private aglCamara: number | null = null;
  /** Personas low-poly en las plazoletas (una InstancedMesh = un draw call). */
  private personas: THREE.InstancedMesh | null = null;
  private readonly ultimaPosDron = new THREE.Vector3();
  /** Transición animada de cámara al Reiniciar o cambiar el sentido. */
  private transicion: {
    desde: THREE.Vector3;
    hasta: THREE.Vector3;
    t0: number;
  } | null = null;
  private destruida = false;
  private rafId = 0;
  private lastFrame = performance.now();
  private rumboActual = 0;
  private pitchFuselage = 0;
  private rollFuselage = 0;
  private camaraBloqueada = true;
  private liberarCamaraEn = performance.now() + 2400;
  private ultimoT = 0;
  /** Altura suavizada del terreno bajo el dron (m sobre el ancla). */
  private lastTrail = performance.now();
  private resizeObs: ResizeObserver;

  constructor(container: HTMLElement, opciones: EscenaTresOpciones) {
    this.contenedor = container;
    this.corredor = opciones.corredor;

    // WebGPURenderer con fallback WebGL2 integrado en three (forceWebGL). Se
    // marca el backend activo según soporte; init() es async y se resuelve en
    // background, pero render() ya lo espera por sí mismo.
    this.renderer = new WebGPURenderer({ antialias: true, powerPreference: "high-performance" });
    void this.iniciarBackend();
    // Sombras suaves (PCF) sobre el dron y los edificios. PCFSoftShadowMap está
    // eliminado en WebGPU: se usa PCFShadowMap + shadow.radius.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Presupuesto de píxeles: dpr alto en iGPU era la mitad del coste.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    this.renderer.setSize(Math.max(2, container.clientWidth), Math.max(2, container.clientHeight));
    container.appendChild(this.renderer.domElement);

    // Ejes fijos del corredor (desktop: corredor.dir/lado), en coords three
    // (x=este, y=arriba, z=norte).
    const largoRuta = Math.hypot(routeFrame.displacement[0], routeFrame.displacement[1]) || 1;
    this.dirCorredor = new THREE.Vector3(
      routeFrame.displacement[0] / largoRuta,
      0,
      routeFrame.displacement[1] / largoRuta,
    );
    this.ladoCorredor = new THREE.Vector3(-this.dirCorredor.z, 0, this.dirCorredor.x);
    this.camara = new THREE.PerspectiveCamera(
      FOV,
      Math.max(0.1, container.clientWidth / Math.max(1, container.clientHeight)),
      0.4,
      // La capa amplia llega a ±9.7 km: sin este far se recorta la ciudad.
      22000,
    );
    this.camara.position.set(0, 220, -420);
    this.camara.lookAt(0, 0, 0);

    const canvas = this.renderer.domElement;
    // Zoom de desktop (entrada_camara): multiplica la distancia de órbita y
    // pasa la cámara a libre adoptando el encuadre actual.
    canvas.addEventListener("wheel", (evento) => {
      if (evento.ctrlKey) return; // el zoom de accesibilidad del navegador queda
      evento.preventDefault();
      // Firefox reporta líneas (deltaMode 1), no píxeles: normalizar.
      const dy = Math.max(-2, Math.min(2, evento.deltaY / 100));
      this.dist = Math.min(900, Math.max(12, this.dist * (1 + dy * 0.08)));
      this.volverLibre();
    }, { passive: false });
    // Arrastre izquierdo = órbita libre, con adopción de encuadre al soltar
    // el modo de seguimiento (entrada_camara de desktop, escena.rs:533).
    let arrastrando = false;
    canvas.addEventListener("pointerdown", (evento) => {
      if (evento.button === 0) arrastrando = true;
    });
    canvas.addEventListener("pointermove", (evento) => {
      if (!arrastrando) return;
      this.azim -= evento.movementX * 0.005;
      this.elev = Math.min(1.45, Math.max(0.06, this.elev + evento.movementY * 0.005));
      this.volverLibre();
    });
    window.addEventListener("pointerup", () => {
      arrastrando = false;
    });
    window.addEventListener("blur", () => {
      arrastrando = false;
    });
    this.mundo.background = new THREE.Color("#8fb4d8");
    // Bruma: desktop deja ver toda la ciudad (±8 km); con 4600 la capa
    // amplia desaparecía por completo tras el horizonte.
    this.mundo.fog = new THREE.Fog(new THREE.Color("#a9c4dd"), 2600, 11000);

    const hemisferio = new THREE.HemisphereLight(0xcfe7ff, 0x4a5d33, 1.15);
    const sol = new THREE.DirectionalLight(0xfff2d6, 1.35);
    sol.position.set(-900, 1200, -1400);
    // Sombras suaves: el sol proyecta y los edificios/terreno las reciben.
    sol.castShadow = true;
    sol.shadow.mapSize.set(1024, 1024);
    sol.shadow.radius = 4;
    sol.shadow.camera.near = 1;
    sol.shadow.camera.far = 5000;
    const alcance = 1200;
    sol.shadow.camera.left = -alcance;
    sol.shadow.camera.right = alcance;
    sol.shadow.camera.top = alcance;
    sol.shadow.camera.bottom = -alcance;
    this.mundo.add(hemisferio, sol, this.dron);
    this.sol = sol;

    this.sombraSuelo = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 24),
      new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.22 }),
    );
    this.sombraSuelo.rotation.x = -Math.PI / 2;
    // Halo y etiqueta cuelgan del grupo del dron: se ven en las 4 fases.
    this.halo.position.y = 0.15;
    this.dron.add(this.halo, this.etiqueta);
    this.mundo.add(this.sombraSuelo);

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

    this.mision = new MisionTres(this.corredor, (estado) => this.onEstado?.(estado));
    for (const objeto of this.mision.objetos()) this.mundo.add(objeto);

    this.resizeObs = new ResizeObserver(() => this.redimension());
    this.resizeObs.observe(container);
    this.redimension();

    // Diagnóstico remoto: con ?debug queda el manejador expuesto, incluso en
    // producción, para poder medir la escena con herramientas externas.
    if (new URLSearchParams(window.location.search).has("debug")) {
      (window as unknown as Record<string, unknown>).__dronScene = this;
    }

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
      this.ciudad = ciudad.grupo;
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
      // Toon: los materiales del GLB se convierten a MeshToonMaterial (anime).
      if (this.estadoVisual.toon) {
        modelo.traverse((nodo) => {
          const malla = nodo as THREE.Mesh;
          if (!malla.isMesh) return;
          malla.castShadow = true;
          const origen = malla.material as THREE.MeshLambertMaterial;
          malla.material = new THREE.MeshToonMaterial({
            color: origen?.color ?? new THREE.Color("#c08a52"),
          });
        });
      }
      const carton = new THREE.MeshLambertMaterial({ color: "#c08a52" });
      const cinta = new THREE.MeshLambertMaterial({ color: "#9a6b39" });
      void carton;
      void cinta;
    } catch (error) {
      marcarDegradado("el GLB del dron no cargó", error);
      // Placeholder: un cuerpo simple para que el dron siga siendo visible.
      const cuerpo = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.35, 1.2),
        new THREE.MeshToonMaterial({ color: "#38bdf8" }),
      );
      cuerpo.castShadow = true;
      this.dronMesh = cuerpo;
      this.dron.add(cuerpo);
    }
  }

  /** Inicializa el renderer (async) y registra el backend efectivo. */
  private async iniciarBackend(): Promise<void> {
    try {
      const disponible = webgpuDisponible();
      await this.renderer.init();
      // Backend real: el fallback interno de three puede activar WebGL2 aunque
      // navigator.gpu exista, así que se lee del renderer, no de la detección.
      const esWebGPU = (this.renderer.backend as { isWebGPUBackend?: boolean })
        ?.isWebGPUBackend;
      this.backendActivo = esWebGPU ? "webgpu" : await detectarBackend(disponible);
    } catch (error) {
      // Fallback: three fuerza WebGL2 si WebGPU no está o init falla.
      this.backendActivo = "webgl";
      console.warn("[tres] WebGPU no disponible; se usa el backend WebGL2", error);
    } finally {
      // render() lanza si se llama antes de init(): el bucle espera este flag.
      if (this.estadoVisual.bloom) this.crearPost();
      this.inicializado = true;
    }
  }

  /** Backend de render efectivo: "webgpu" o "webgl". */
  backend(): Backend {
    return this.backendActivo;
  }

  /** FPS promediado de los últimos frames (0 antes del primer frame). */
  fps(): number {
    return this.fpsValor;
  }

  /** ¿El shader toon está activo? (identidad visual, nunca se degrada). */
  toonActivo(): boolean {
    return this.estadoVisual.toon;
  }

  /** ¿Las sombras están activas? */
  sombrasActivas(): boolean {
    return this.estadoVisual.sombras;
  }

  /** ¿El bloom está activo? */
  bloomActivo(): boolean {
    return this.estadoVisual.bloom;
  }

  /** Apaga el bloom (guarda de FPS). */
  degradarBloom(): void {
    this.estadoVisual.bloom = false;
    this.post = null;
    this.estadoVisual.toon = true;
  }

  /** Crea el RenderPipeline con bloom (umbral alto: solo emisivos). */
  private crearPost(): void {
    const escenaPass = pass(this.mundo, this.camara);
    const colorEscena = escenaPass.getTextureNode("output");
    // bloom(node<vec4>, strength, radius, threshold) — umbral 0.9 como desktop.
    const bloomPass = bloom(colorEscena, 0.1, 0.0, 0.9);
    this.post = new PostProcessing(this.renderer);
    this.post.outputNode = colorEscena.add(bloomPass);
  }

  /** Render con bloom si está activo, o render directo como fallback. */
  private renderEscena(): void {
    if (this.post && this.estadoVisual.bloom) {
      try {
        this.post.render();
      } catch {
        // Red de seguridad: si el bloom TSL falla, se desactiva y se renderiza
        // directo (sin bloom) para no dejar pantalla negra ni bucle de errores.
        this.estadoVisual.bloom = false;
        this.post = null;
        this.renderer.render(this.mundo, this.camara);
      }
    } else {
      this.renderer.render(this.mundo, this.camara);
    }
  }

  /** Guarda de FPS: degrada capas visuales por debajo del mínimo. */
  private aplicarGuardaFps(): void {
    // Calentamiento: los primeros 180 frames (~3 s) no degradan, para que la
    // carga inicial (fetch de edificios, texturas) no dispare la guarda.
    if (this.framesVistos < 180) return;
    const antes = this.estadoVisual;
    const despues = degradarPorFps(this.fpsValor, antes);
    if (despues === antes) return;
    if (antes.bloom && !despues.bloom) this.degradarBloom();
    if (antes.sombras && !despues.sombras) {
      this.estadoVisual.sombras = false;
      this.sol.castShadow = false;
      this.renderer.shadowMap.enabled = false;
    }
    this.estadoVisual.nubes = despues.nubes;
    this.estadoVisual.toon = despues.toon;
  }

  attachBuffer(buffer: EscenaBuffer): void {
    this.buffer = buffer;
  }

  attachMissionState(onEstado: (estado: MissionState) => void): void {
    this.onEstado = onEstado;
  }

  setRoute(ruta: readonly Vec3[]): void {
    if (ruta.length === 0) return;
    // Geometría nueva: en three 0.187 el setFromPoints sobre un buffer vacío
    // no lo agranda y la ruta nunca llega a dibujarse.
    const puntos = ruta.map((punto) =>
      enuATres(punto, this.alturaSuelo([punto[0], punto[1], 0])),
    );
    this.ruta.geometry.dispose();
    this.ruta.geometry = new THREE.BufferGeometry().setFromPoints(puntos);
    this.establecerCamara();
    this.colocarPersonas(puntos[0], puntos[puntos.length - 1]);
  }

  /** Corte SUAVE a plano general del corredor (desktop: vista_amplia en los
   * primeros 2.4 s). Vuela la cámara hasta el encuadre en ~1.5 s en vez de
   * teletransportarla: Reiniciar y el cambio de sentido quedan con animación. */
  establecerCamara(): void {
    if (this.ruta.geometry.getAttribute("position")) {
      const caja = new THREE.Box3().setFromObject(this.ruta);
      const centro = caja.getCenter(new THREE.Vector3());
      this.transicion = {
        desde: this.camara.position.clone(),
        hasta: new THREE.Vector3(centro.x, centro.y + 380, centro.z - 40),
        t0: performance.now(),
      };
    }
    this.camaraBloqueada = true;
    this.liberarCamaraEn = performance.now() + 2600;
    this.aglCamara = null;
  }

  /** Personas low-poly en las plazoletas de la UTS y la UIS: una sola
   * InstancedMesh (un draw call) con colores por instancia. */
  private colocarPersonas(inicio: THREE.Vector3, fin: THREE.Vector3): void {
    const POR_PLAZA = 12;
    if (this.personas) {
      this.mundo.remove(this.personas);
      this.personas.dispose();
      this.personas = null;
    }
    const cuerpo = new THREE.CylinderGeometry(0.16, 0.22, 1.05, 6);
    cuerpo.translate(0, 0.6, 0);
    const cabeza = new THREE.SphereGeometry(0.13, 8, 6);
    cabeza.translate(0, 1.28, 0);
    const geo = mergeGeometries([cuerpo, cabeza]);
    if (!geo) return;
    const personas = new THREE.InstancedMesh(
      geo,
      new THREE.MeshLambertMaterial(),
      POR_PLAZA * 2,
    );
    const ROPA = [0x4a5568, 0x718096, 0x8b6f47, 0x5d6b7a, 0x975a4e, 0x6b705c];
    const matriz = new THREE.Matrix4();
    const color = new THREE.Color();
    let semilla = 7;
    const azar = (): number => {
      semilla = (semilla * 16807) % 2147483647;
      return semilla / 2147483647;
    };
    let i = 0;
    for (const base of [inicio, fin]) {
      for (let k = 0; k < POR_PLAZA; k += 1) {
        const angulo = (k / POR_PLAZA) * Math.PI * 2 + azar() * 0.6;
        const radio = 6 + azar() * 8;
        const x = base.x + Math.cos(angulo) * radio;
        const z = base.z + Math.sin(angulo) * radio;
        // De pie sobre la plazoleta, mirando hacia el punto de entrega.
        matriz.makeRotationY(Math.atan2(base.x - x, base.z - z));
        matriz.setPosition(x, base.y, z);
        personas.setMatrixAt(i, matriz);
        color.setHex(ROPA[i % ROPA.length]);
        personas.setColorAt(i, color);
        i += 1;
      }
    }
    personas.instanceMatrix.needsUpdate = true;
    if (personas.instanceColor) personas.instanceColor.needsUpdate = true;
    personas.castShadow = true;
    this.mundo.add(personas);
    this.personas = personas;
  }

  setCameraMode(modo: CameraMode): void {
    if (modo === this.camaraModo) return;
    if (modo === "libre") {
      this.volverLibre();
      return;
    }
    this.camaraModo = modo;
    this.camaraBloqueada = false;
    this.onCamara?.(modo);
  }

  /** Arrastrar o usar la rueda adopta el encuadre actual como órbita libre
   * (desktop: entrada_camara adopta dist/elev/azim de la posición presente). */
  private volverLibre(): void {
    if (this.camaraModo !== "libre") {
      const rel = this.camara.position.clone().sub(this.objetivoCamara);
      const h = Math.max(1e-3, rel.length());
      this.dist = Math.min(900, Math.max(12, h));
      this.elev = Math.min(1.45, Math.max(0.06, Math.asin(rel.y / h)));
      this.azim = Math.atan2(rel.z, rel.x);
      this.camaraModo = "libre";
      this.onCamara?.("libre");
    }
    this.camaraBloqueada = false;
  }

  /** El HUD se entera cuando la escena cambia de modo sola (R/C/arrastre). */
  attachCameraMode(callback: (modo: CameraMode) => void): void {
    this.onCamara = callback;
  }

  /** Posición visual del dron (z already clamped al terreno real). */
  private displayDron(sample: Telemetry): Vec3 {
    return [
      sample.position[0],
      sample.position[1],
      sample.position[2] + GEAR_CLEARANCE,
    ];
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

    // Halo pulsante y siempre de cara a cámara (el dron nunca deja de verse).
    // Tamaño compensado por distancia: el zoom 3–60 m no debe tragarse el dron.
    const cercaCamara = this.camara.position.distanceTo(posicion);
    const tamano = THREE.MathUtils.clamp(cercaCamara / 14, 0.5, 3.2);
    const pulso = 1 + 0.12 * Math.sin(performance.now() * 0.004);
    this.halo.scale.setScalar(pulso * tamano);
    this.etiqueta.scale.set(3.6 * tamano, 1.01 * tamano, 1);
    this.etiqueta.position.y = 1.9 * tamano;

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

  /** Sigue al dron como desktop (seguir_dron, escena.rs:2186): candidatos
   * FIJOS sobre los ejes del corredor, línea de visión con histéresis y
   * suavizado exponencial — sin offsets que roten con el rumbo (el tambaleo
   * heredado del legacy venía de eso). */
  private camaraActualiza(sample: Telemetry, dt: number): void {
    const display = this.displayDron(sample);
    // El DEM por celdas salta al cruzar una celda (48×75 m): filtrado en baja
    // frecuencia desaparece el tambaleo residual del objetivo de cámara.
    const aglCrudo = this.alturaSuelo(display);
    if (this.aglCamara === null) this.aglCamara = aglCrudo;
    this.aglCamara += (aglCrudo - this.aglCamara) * (1 - Math.exp(-1.5 * dt));
    const agl = this.aglCamara;
    const pos = new THREE.Vector3(display[0], agl + display[2], display[1]);
    this.objetivoCamara.copy(pos);
    // Teletransporte (Reiniciar/Sentido): corte animado a plano general en
    // vez de volar la cámara 4 km atravesando la ciudad.
    if (this.ultimaPosDron.lengthSq() > 0 && pos.distanceTo(this.ultimaPosDron) > 300) {
      this.establecerCamara();
    }
    this.ultimaPosDron.copy(pos);
    if (this.camaraBloqueada) {
      // Transición: vuela la cámara hasta el plano general con ease cúbico,
      // mirando siempre al dron; luego espera la liberación como desktop.
      if (this.transicion) {
        const transcurrido = Math.min(1, (performance.now() - this.transicion.t0) / 1500);
        const pulso =
          transcurrido < 0.5
            ? 4 * transcurrido ** 3
            : 1 - (-2 * transcurrido + 2) ** 3 / 2;
        this.camara.position.lerpVectors(this.transicion.desde, this.transicion.hasta, pulso);
        if (transcurrido >= 1) this.transicion = null;
      }
      this.camara.lookAt(pos);
      if (performance.now() < this.liberarCamaraEn) return;
      this.camaraBloqueada = false;
    }

    const desde = pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    let elegido: THREE.Vector3;
    if (this.camaraModo === "cine") {
      // offset_cine: órbita lenta three-quarter alrededor del dron.
      const t = performance.now() / 1000;
      const angulo = 0.55 + 0.22 * Math.sin(t * 0.18);
      const distancia = 10 + 2 * Math.sin(t * 0.11);
      const altura = 4.25 + 0.75 * Math.sin(t * 0.23 + 1);
      const candidato = pos
        .clone()
        .add(
          this.dirCorredor
            .clone()
            .multiplyScalar(Math.cos(angulo) * distancia)
            .add(this.ladoCorredor.clone().multiplyScalar(Math.sin(angulo) * distancia))
            .add(new THREE.Vector3(0, altura, 0)),
        );
      elegido = this.recortarVision(desde, candidato, 1.2, 1.5);
      const suavizado = 1 - Math.exp(-4 * dt);
      this.camara.position.lerp(elegido, suavizado);
      this.camara.position.y = Math.max(this.camara.position.y, this.alturaSuelo([this.camara.position.x, this.camara.position.z, 0]) + 2);
      this.camara.lookAt(pos.x, pos.y + 1, pos.z);
      return;
    }
    if (this.camaraModo === "libre") {
      // Órbita libre alrededor del dron, con el mismo recorte de colisión.
      const offset = new THREE.Vector3(
        Math.sin(this.azim) * Math.cos(this.elev),
        Math.sin(this.elev),
        Math.cos(this.azim) * Math.cos(this.elev),
      ).multiplyScalar(this.dist);
      const candidato = pos.clone().add(offset);
      elegido = this.recortarVision(desde, candidato, 2, 1.5);
      const suavizado = 1 - Math.exp(-10 * dt);
      this.camara.position.lerp(elegido, suavizado);
      this.camara.position.y = Math.max(this.camara.position.y, this.alturaSuelo([this.camara.position.x, this.camara.position.z, 0]) + 4);
      this.camara.lookAt(pos.x, pos.y + 1.5, pos.z);
      return;
    }

    // Persecución: candidatos de más aérea a más pegada; se usa el primero
    // con línea de visión libre (si no, el que deje al menos 40 % de hueco).
    const atras = this.dirCorredor.clone().multiplyScalar(-1);
    const lateral = this.ladoCorredor;
    const candidatos = [
      pos.clone().add(atras.clone().multiplyScalar(45)).add(new THREE.Vector3(0, 62, 0)),
      pos.clone().add(atras.clone().multiplyScalar(60)).add(new THREE.Vector3(0, 45, 0)),
      pos.clone().add(lateral.clone().multiplyScalar(50)).add(new THREE.Vector3(0, 40, 0)),
      pos.clone().add(atras.clone().multiplyScalar(30)).add(new THREE.Vector3(0, 78, 0)),
      pos.clone().add(new THREE.Vector3(0, 95, 0)),
    ];
    elegido = candidatos[0];
    for (const candidato of candidatos) {
      const distancia = candidato.clone().sub(desde).length();
      const toi = this.toiVision(desde, candidato);
      if (toi === null) {
        elegido = candidato;
        break;
      }
      // Solo se acepta si la pared queda lejos: si no, la cámara acabaría
      // pegada a una fachada y no se ve nada.
      if (toi >= 0.6 * distancia) {
        elegido = desde.clone().add(
          candidato.clone().sub(desde).normalize().multiplyScalar(Math.max(toi - 2, 1.5)),
        );
        break;
      }
    }
    const suavizado = 1 - Math.exp(-6 * dt);
    this.camara.position.lerp(elegido, suavizado);
    // Nunca por debajo del suelo: +6 m como desktop.
    this.camara.position.y = Math.max(
      this.camara.position.y,
      this.alturaSuelo([this.camara.position.x, this.camara.position.z, 0]) + 6,
    );
    this.camara.lookAt(pos.x, pos.y + 1.5, pos.z);
  }

  /** Distancia al primer edificio que corta la línea desde→objetivo
   * (desktop: golpe_de). Null si la línea está limpia. */
  private toiVision(desde: THREE.Vector3, objetivo: THREE.Vector3): number | null {
    const delta = objetivo.clone().sub(desde);
    const distancia = delta.length();
    if (distancia < 1e-3) return null;
    this.colision.set(desde, delta.normalize());
    this.colision.far = distancia;
    const impactos = this.ciudad
      ? this.colision.intersectObject(this.ciudad, true)
      : [];
    return impactos.length > 0 ? impactos[0].distance : null;
  }

  /** Coloca la cámara a `margen` del primer golpe (desktop: toi − margen). */
  private recortarVision(
    desde: THREE.Vector3,
    candidato: THREE.Vector3,
    margen: number,
    minimo: number,
  ): THREE.Vector3 {
    const toi = this.toiVision(desde, candidato);
    if (toi === null) return candidato;
    return desde.clone().add(
      candidato
        .clone()
        .sub(desde)
        .normalize()
        .multiplyScalar(Math.max(toi - margen, minimo)),
    );
  }

  /** Evita que la cámara atraviese edificios o baje bajo el terreno. */
  /** Bucle principal: minestro telemetría, misión, toma cinematográfica, render. */
  private readonly bucle = (): void => {
    if (this.destruida) return;
    this.rafId = requestAnimationFrame(this.bucle);
    if (!this.inicializado) return;
    try {
      const ahora = performance.now();
      const deltaMs = ahora - this.lastFrame;
      const dt = Math.min(0.1, Math.max(0.001, deltaMs / 1000));
      this.lastFrame = ahora;
      // Rolling de FPS sobre los últimos 60 frames.
      this.fpsDeltas.push(deltaMs);
      if (this.fpsDeltas.length > 60) this.fpsDeltas.shift();
      this.fpsValor = calcularFps(this.fpsDeltas);
      this.framesVistos += 1;
      this.aplicarGuardaFps();
      const sample = this.buffer?.sample();
      if (!sample) {
        this.renderEscena();
        return;
      }

    // Reset del servidor: corte suave a plano general (mismo encuadre que al
    // cargar) para que el primer frame no nazca dentro de los edificios.
    if (sample.t + 1 < this.ultimoT) {
      this.establecerCamara();
    }
    this.ultimoT = sample.t;

    const display = this.displayDron(sample);
    const aglDron = this.alturaSuelo(display);
    const puntoBelly = enuATres(
      [display[0], display[1], display[2] - 0.236],
      aglDron,
    );
    this.mision.actualizarPaquete(sample, puntoBelly);
    this.mision.fijarEstado(
      sample,
      Math.hypot(display[0] - routeFrame.displacement[0], display[1] - routeFrame.displacement[1]) < 18,
      Math.hypot(display[0], display[1]) < 16,
    );
    this.sombraSuelo.position.set(display[0], aglDron + 0.25, display[1]);
    this.actualizarDron(sample, dt);
    this.camaraActualiza(sample, dt);
    // El anillo se orienta a cámara DESPUÉS de moverla: con el orden inverso
    // queda un frame desfasado y se ve el canto.
    this.halo.quaternion.copy(this.camara.quaternion);

      this.renderEscena();
    } catch (error) {
      // Un asset/capa async no puede matar el loop: el siguiente frame sigue
      // vivo y la consola conserva la causa para depuración.
      console.error("[tres] frame recuperado", error);
    }
  };

  destroy(): void {
    if (this.destruida) return;
    this.destruida = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObs.disconnect();
    // Liberar geometrías, materiales y texturas de GPU.
    this.mundo.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
        // Las instancias (personas) liberan además sus matrices/colores.
        if ((mesh as THREE.InstancedMesh).isInstancedMesh) mesh.dispose();
      }
    });
    this.post?.dispose?.();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

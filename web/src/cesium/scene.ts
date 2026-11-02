import * as Cesium from "cesium";
import { routeFrame, type Vec3 } from "@dron/shared";
import { CITY_GROUND_HEIGHT, COLORS, MISSION_ZONES, type CameraMode } from "./constants";
import { DroneModel } from "./drone";
import { CameraRig } from "./camera-rig";
import { loadBuildingPrimitive } from "./buildings";
import { createWorldFrame, type WorldFrame } from "./world";
import { TerrainSampling } from "./terrain";
import { RouteGroundTable } from "./route-ground";
import { MissionDirector, type CameraShot, type MissionState } from "./mission";
import type { TelemetryBuffer } from "../sim/buffer";

const INITIAL_DURATION_MS = 2400;
const CAMERA_SETTLE_MS = 2400;
const CAMERA_FOV_DEG = 52;

const css = (value: string, alpha = 1): Cesium.Color =>
  Cesium.Color.fromCssColorString(value).withAlpha(alpha);

export class DroneScene {
  private readonly viewer: Cesium.Viewer;
  private readonly world: WorldFrame;
  private readonly corredor: RouteGroundTable;
  private readonly drone: DroneModel;
  private readonly cameraRig: CameraRig;
  private readonly terrain: TerrainSampling;
  private missionDirector: MissionDirector | null = null;
  private missionCallback: ((state: MissionState) => void) | null = null;
  private holdCallback: ((hold: boolean) => void) | null = null;
  private shotActive = false;
  private decorations: Cesium.Entity[] = [];
  private routeEntities: Cesium.Entity[] = [];
  private route: readonly Vec3[] = [];
  private readonly preRenderHandler: () => void;
  private buffer: TelemetryBuffer | null = null;
  private cameraUnlockAt = performance.now() + INITIAL_DURATION_MS;
  private cameraFollowing = false;
  private destroyed = false;
  private cityPrimitive: Cesium.Primitive | null = null;
  private osmBuildings: Cesium.Cesium3DTileset | null = null;
  private readonly resizeObserver: ResizeObserver;
  private readonly creditContainer: HTMLDivElement;
  private renderLoopHandle: number | null = null;
  private renderLoopInterval: number | null = null;
  private lastRenderAt = 0;

  private readonly renderLoopTick: () => void = () => {
    if (this.destroyed) return;
    const now = performance.now();
    if (now - this.lastRenderAt < 20) return;
    this.lastRenderAt = now;
    try {
      this.viewer.resize();
      this.viewer.render();
    } catch (error) {
      console.warn("Error de render tolerado por Cesium", error);
    }
    this.renderLoopHandle = requestAnimationFrame(this.renderLoopTick);
  };

  private startRenderLoop(): void {
    this.lastRenderAt = performance.now();
    this.renderLoopHandle = requestAnimationFrame(this.renderLoopTick);
    this.renderLoopInterval = window.setInterval(this.renderLoopTick, 1000 / 60);
  }

  private stopRenderLoop(): void {
    if (this.renderLoopHandle !== null) {
      cancelAnimationFrame(this.renderLoopHandle);
      this.renderLoopHandle = null;
    }
    if (this.renderLoopInterval !== null) {
      window.clearInterval(this.renderLoopInterval);
      this.renderLoopInterval = null;
    }
  }

  constructor(container: HTMLElement) {
    this.creditContainer = document.createElement("div");
    this.creditContainer.className = "stage-credits";
    container.append(this.creditContainer);

    const imagery = new Cesium.UrlTemplateImageryProvider({
      // Por el proxy propio con caché en disco: Esri sin token se agota y
      // la ciudad quedaba gris. Atribución intacta.
      url: "tiles/esri/{z}/{y}/{x}",
      maximumLevel: 19,
      credit: new Cesium.Credit("Esri World Imagery"),
    });
    this.viewer = new Cesium.Viewer(container, {
      creditContainer: this.creditContainer,
      baseLayer: new Cesium.ImageryLayer(imagery),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: true,
      useDefaultRenderLoop: false,
      showRenderLoopErrors: false,
      msaaSamples: 2,
      contextOptions: {
        webgl: { antialias: true, powerPreference: "high-performance" },
      },
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    });
    // Presupuesto de render: el objetivo del proyecto es >= 30 fps.
    // Los dos costes dominantes en GPU integrada eran la escala sobre dpr
    // (píxeles×2.25) y la cadena de bloom (varios pases fullscreen).
    const params = new URLSearchParams(window.location.search);
    const calidad = params.get("calidad") ?? "alta";
    // Presupuesto agressivo por defecto: es lo que sostiene >= 30 fps en
    // GPU integrada. `?calidad=cine` sube al look de la presentación.
    // `?calidad=baja` quita sombras y antialias por completo.
    this.viewer.resolutionScale = Math.min(window.devicePixelRatio, 0.75);
    this.viewer.scene.msaaSamples = 1;
    this.viewer.scene.shadowMap.softShadows = false;
    this.viewer.scene.postProcessStages.bloom.enabled = calidad === "cine";
    this.viewer.scene.postProcessStages.fxaa.enabled = calidad === "cine";
    if (calidad === "baja") {
      this.viewer.resolutionScale = Math.max(0.5, window.devicePixelRatio * 0.6);
      this.viewer.scene.postProcessStages.fxaa.enabled = false;
      this.viewer.scene.postProcessStages.bloom.enabled = false;
      this.viewer.scene.shadowMap.enabled = false;
    }
    // `?fps` muestra el contador real de Cesium (verificación de 30 fps).
    // `?fps` muestra el contador real de Cesium: es el gate de los 30 fps.
    if (params.has("fps")) this.viewer.scene.debugShowFramesPerSecond = true;

    this.viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
    this.viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1.5;
    this.viewer.scene.screenSpaceCameraController.maximumZoomDistance = 2400;
    this.viewer.scene.screenSpaceCameraController.inertiaZoom = 0.72;
    this.viewer.scene.screenSpaceCameraController.inertiaSpin = 0.86;
    this.viewer.scene.screenSpaceCameraController.inertiaTranslate = 0.8;

    const layer = this.viewer.imageryLayers.get(0);
    layer.saturation = 0.9;
    layer.brightness = 0.98;
    layer.contrast = 1.04;

    const scene = this.viewer.scene;
    scene.globe.baseColor = css("#87968f");
    // La iluminación dinámica del globo multiplicaba el satelital por ~0,3:
    // la ciudad se veía en penumbra (medido: 45/255 con luz vs 135 sin ella).
    // Se desactiva; las sombras reales (shadowMap) de dron y edificios siguen
    // funcionando, que es la profundidad que importa.
    scene.globe.enableLighting = false;
    scene.globe.dynamicAtmosphereLighting = true;
    scene.globe.dynamicAtmosphereLightingFromSun = true;
    scene.globe.showGroundAtmosphere = true;
    scene.globe.depthTestAgainstTerrain = true;
    // Rendimiento del mapa: SSE 2 (por defecto) pide 4x más tiles de terreno y
    // satelital. 6 mantiene nitidez de vuelo y baja el tráfico a ~1/3;
    // caché mayor para no volver a pedir lo ya visto.
    scene.globe.maximumScreenSpaceError = 6;
    scene.globe.tileCacheSize = 300;
    scene.fog.enabled = true;
    scene.fog.density = 0.00012;
    scene.fog.minimumBrightness = 0.1;
    scene.postProcessStages.fxaa.enabled = true;

    // Sombra real: sin esto el dron parece flotar sobre la ciudad.
    scene.shadowMap.enabled = true;
    scene.shadowMap.softShadows = false;
    scene.shadowMap.darkness = 0.32;
    scene.shadowMap.size = 1024;
    scene.shadowMap.maximumDistance = 2200;

    // Bloom: los materiales emisivos del dron y la polilínea brillante no
    // existen visualmente sin esta etapa.
    const bloom = scene.postProcessStages.bloom;
    bloom.enabled = calidad === "cine";
    bloom.uniforms.glowOnly = false;
    bloom.uniforms.contrast = 128;
    bloom.uniforms.brightness = -0.32;
    bloom.uniforms.delta = 1.0;
    bloom.uniforms.sigma = 3.8;
    bloom.uniforms.stepSize = 1.2;

    // SSAO desactivado a propósito: combinado con shadowMap deja el 91 % del
    // frame en negro en esta versión de Cesium (medido). Sombras + bloom ya
    // dan la profundidad; no compensa el riesgo.
    scene.postProcessStages.ambientOcclusion.enabled = false;

    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.hueShift = 0;
      scene.skyAtmosphere.saturationShift = 0;
      scene.skyAtmosphere.brightnessShift = 0;
    }
    scene.backgroundColor = css("#a8c5d8");
    // 15:30 en Bucaramanga (UTC-5): sol con altura suficiente para modelar el
    // dron y a las personas, y todavía con sombras largas y cálidas.
    this.viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-10-21T20:30:00Z");

    const frustum = this.viewer.camera.frustum;
    if (frustum instanceof Cesium.PerspectiveFrustum) {
      frustum.fov = Cesium.Math.toRadians(CAMERA_FOV_DEG);
    }

    this.world = createWorldFrame();
    this.world.setGround(CITY_GROUND_HEIGHT, true);
    this.corredor = new RouteGroundTable();
    this.terrain = new TerrainSampling(this.viewer, this.world, this.corredor);
    this.addBeacons();
    this.drone = new DroneModel(this.viewer, this.world);
    this.cameraRig = new CameraRig(this.viewer, this.world, this.terrain);
    this.missionDirector = new MissionDirector(
      this.viewer,
      this.world,
      (state) => this.missionCallback?.(state),
      (hold) => this.holdCallback?.(hold),
    );
    void this.loadCity();

    this.preRenderHandler = () => this.preRender();
    scene.preRender.addEventListener(this.preRenderHandler);
    this.cameraUnlockAt = performance.now() + INITIAL_DURATION_MS;

    this.resizeObserver = new ResizeObserver(() => this.viewer.resize());
    this.resizeObserver.observe(container);
    this.startRenderLoop();

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__dronScene = this;
      // Diagnóstico en desarrollo: cambia la hora del sol sin tocar código.
      (window as unknown as Record<string, unknown>).__setSun = (iso: string) => {
        this.viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(iso);
      };
      // Diagnóstico en desarrollo: expone Cesium para regenerar la muestra de
      // alturas de los edificios sin modificar el bundler.
      (window as unknown as Record<string, unknown>).__Cesium = Cesium;
      // Diagnóstico en desarrollo: reconstruye el primitivo de edificios con el
      // terreno ya cargado. Sirve para detectar si se hornearon con alturas de
      // baja resolución.
      (window as unknown as Record<string, unknown>).__reloadBuildings = async () => {
        if (this.cityPrimitive) {
          this.viewer.scene.primitives.remove(this.cityPrimitive);
          this.cityPrimitive = null;
        }
        this.cityPrimitive = await loadBuildingPrimitive(
          this.viewer,
          this.world,
          this.viewer.terrainProvider,
        );
        return !!this.cityPrimitive;
      };
    }
  }

  private addBeacons(): void {
    for (const entity of this.decorations) this.viewer.entities.remove(entity);
    this.decorations = [];
    this.addBeacon([0, 0, 0], "UTS", "Despegue", COLORS.green, MISSION_ZONES.uts.radius);
    this.addBeacon(
      routeFrame.displacement,
      "UIS",
      "Entrega",
      COLORS.orange,
      MISSION_ZONES.uis.radius,
    );
  }

  private addBeacon(
    vector: Vec3,
    title: string,
    subtitle: string,
    color: string,
    radius: number,
  ): void {
    const ground = this.world.ground(vector);
    const top = this.world.enu([vector[0], vector[1], 6]);
    this.decorations.push(
      this.viewer.entities.add({
        position: ground,
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius,
          material: css(color, 0.12),
          outline: true,
          outlineColor: css(color, 0.85),
          height: new Cesium.CallbackProperty(
            () => (Cesium.Cartographic.fromCartesian(ground)?.height ?? 0) + 0.12,
            false,
          ),
        },
        polyline: {
          positions: [ground, top],
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: css(color, 0.75),
            dashLength: 14,
          }),
          arcType: Cesium.ArcType.NONE,
        },
        label: {
          text: `${title}\n${subtitle}`,
          font: "600 13px Inter, system-ui, sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: css("#020617", 0.9),
          outlineWidth: 2,
          showBackground: true,
          backgroundColor: css("#0b1524", 0.85),
          backgroundPadding: new Cesium.Cartesian2(9, 6),
          pixelOffset: new Cesium.Cartesian2(0, -12),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    );
  }

  private refreshGround(): void {
    this.addBeacons();
    this.drawRoute();
    this.drone.clearTrail();
  }

  private async loadCity(): Promise<void> {
    let terrainReady = false;
    try {
      const terrain = await Cesium.createWorldTerrainAsync({ requestVertexNormals: true });
      if (this.destroyed) return;
      this.viewer.terrainProvider = terrain;
      this.viewer.scene.globe.show = true;
      terrainReady = true;
      await this.anchorToTerrain(terrain);
    } catch (error) {
      console.warn("Terreno Cesium no disponible; se usa el plano local", error);
      this.world.setGround(0, false);
      this.viewer.scene.globe.show = true;
      this.refreshGround();
    }

    this.cityPrimitive = await loadBuildingPrimitive(
      this.viewer,
      this.world,
      terrainReady ? this.viewer.terrainProvider : undefined,
    );
    if (this.destroyed) return;

    if (!this.cityPrimitive && terrainReady) {
      try {
        const buildings = await Cesium.createOsmBuildingsAsync({
          defaultColor: Cesium.Color.fromCssColorString("#b8b0a3"),
        });
        if (this.destroyed) {
          buildings.destroy();
          return;
        }
        this.osmBuildings = buildings;
        this.viewer.scene.primitives.add(buildings);
      } catch (error) {
        console.warn("OSM Buildings no disponible", error);
      }
    }
  }

  /**
   * Recalibra el ancla ENU con la altura real del terreno en la UTS.
   * `CITY_GROUND_HEIGHT` es solo un valor de arranque: el terreno de Cesium
   * puede diferir varios metros y con eso el dron aparecía enterrado.
   */
  private async anchorToTerrain(terrain: Cesium.TerrainProvider): Promise<void> {
    const carto = Cesium.Cartographic.fromCartesian(this.world.origin);
    if (!carto) return;
    try {
      const samples = await Cesium.sampleTerrainMostDetailed(terrain, [
        carto.clone() as Cesium.Cartographic,
      ]);
      const sample = samples[0];
      if (this.destroyed || !sample || !Number.isFinite(sample.height)) return;
      this.world.setGround(sample.height, true);
      // A partir de aquí todo el marco ENU (edificios, zonas, repartidores,
      // ruta, balizas y dron) se apoya en el terreno que se ve, no en la
      // rejilla offline, que en la UTS estaba desviada ~10 m.
      this.world.setHeightProvider((vector) => this.terrain.agl(vector));
      if (this.destroyed) return;
      // Tabla de alturas del corredor: se muestrea una vez (y se guarda en
      // localStorage) para que el vuelo no dispare peticiones de terreno.
      try {
        await this.corredor.cargar({ world: this.world, terrain });
        console.info("[corredor] alturas registradas");
      } catch (error) {
        console.warn("[corredor] sin tabla de alturas; se usa la rejilla offline", error);
      }
      this.refreshGround();
      this.missionDirector?.refreshZones();
    } catch (error) {
      console.warn("No se pudo recalibrar el ancla con el terreno real", error);
    }
  }

  attachBuffer(buffer: TelemetryBuffer): void {
    this.buffer = buffer;
  }

  attachMissionState(listener: (state: MissionState) => void): void {
    this.missionCallback = listener;
  }

  attachHold(listener: (hold: boolean) => void): void {
    this.holdCallback = listener;
  }

  setRoute(route: readonly Vec3[]): void {
    this.route = route;
    this.missionDirector?.reset();
    const positions = this.drawRoute();
    if (!positions || positions.length < 2) return;

    this.drone.clearTrail();
    const sphere = Cesium.BoundingSphere.fromPoints(positions);
    this.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(sphere.center, 1200), {
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(-20),
        Cesium.Math.toRadians(-38),
        3200,
      ),
      duration: INITIAL_DURATION_MS / 1000,
    });
    this.cameraUnlockAt = performance.now() + CAMERA_SETTLE_MS;
  }

  private drawRoute(): Cesium.Cartesian3[] | null {
    for (const entity of this.routeEntities) this.viewer.entities.remove(entity);
    this.routeEntities = [];
    if (this.route.length < 2) return null;

    // La ruta incluye los tramos verticales de ascenso y descenso (mismo
    // punto norte-este con distinto z). Al dibujarse quedaban como un mástil
    // cian clavado al dron: se omiten los tramos sin desplazamiento horizontal.
    const kept: Vec3[] = [];
    for (const point of this.route) {
      const previous = kept[kept.length - 1];
      if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 8) continue;
      kept.push(point);
    }
    const positions = kept.map((point) => this.world.enu(point));

    this.routeEntities.push(
      this.viewer.entities.add({
        polyline: {
          positions,
          width: 3,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.18,
            color: css(COLORS.accent, 0.78),
          }),
          arcType: Cesium.ArcType.NONE,
        },
      }),
      this.viewer.entities.add({
        polyline: {
          positions: kept.map((point) => this.world.ground(point)),
          width: 1.5,
          material: new Cesium.PolylineDashMaterialProperty({
            color: css(COLORS.accent, 0.28),
            dashLength: 18,
          }),
          arcType: Cesium.ArcType.NONE,
        },
      }),
    );

    for (const point of this.route.slice(1, -1)) {
      this.routeEntities.push(
        this.viewer.entities.add({
          position: this.world.enu(point),
          point: {
            pixelSize: 5,
            color: css(COLORS.accent, 0.75),
            outlineColor: css("#e0f2fe", 0.5),
            outlineWidth: 1,
          },
        }),
      );
    }
    return positions;
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraRig.setMode(mode);
  }

  /** Plano fijo de la secuencia: encuadra dron y repartidor a escala humana. */
  private applyShot(shot: CameraShot): void {
    const display = this.drone.displayPosition;
    const position = this.world.enu([
      display[0] + shot.position[0],
      display[1] + shot.position[1],
      display[2] + shot.position[2],
    ]);
    const target = this.world.enu([
      display[0] + shot.target[0],
      display[1] + shot.target[1],
      display[2] + shot.target[2],
    ]);
    this.shotActive = true;
    this.cameraRig.placeCamera(position, target);
  }

  private preRender(): void {
    if (this.destroyed) return;
    const sample = this.buffer?.sample();
    if (!sample) return;

    const now = performance.now();

    const hoverOverride = this.missionDirector?.hoverZ(sample) ?? null;
    this.drone.update(sample, hoverOverride);

    const ready = now >= this.cameraUnlockAt;
    this.missionDirector?.update(sample, now, this.drone.bellyPoint(), ready);

    const shot = this.missionDirector?.shot() ?? null;
    if (shot) {
      this.applyShot(shot);
      return;
    }

    if (this.shotActive) {
      this.shotActive = false;
      this.cameraUnlockAt = now;
      this.cameraRig.beginFollow(now);
    }
    if (now < this.cameraUnlockAt) return;
    if (!this.cameraFollowing) {
      this.cameraFollowing = true;
      this.cameraRig.beginFollow(now);
    }
    this.cameraRig.update(sample, now);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopRenderLoop();
    this.resizeObserver.disconnect();
    this.viewer.scene.preRender.removeEventListener(this.preRenderHandler);
    this.drone.destroy();
    this.cameraRig.destroy();
    this.missionDirector?.destroy();
    this.missionDirector = null;
    if (this.cityPrimitive) {
      this.viewer.scene.primitives.remove(this.cityPrimitive);
      this.cityPrimitive = null;
    }
    if (this.osmBuildings) {
      this.viewer.scene.primitives.remove(this.osmBuildings);
      this.osmBuildings = null;
    }
    for (const entity of [...this.decorations, ...this.routeEntities]) {
      this.viewer.entities.remove(entity);
    }
    this.decorations = [];
    this.routeEntities = [];
    this.creditContainer.remove();
    this.viewer.destroy();
  }
}

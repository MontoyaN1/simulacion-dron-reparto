import * as Cesium from "cesium";
import { routeFrame, type Vec3 } from "@dron/shared";
import { COLORS, type CameraMode } from "./constants";
import { DroneModel } from "./drone";
import { createWorldFrame, type WorldFrame } from "./world";
import type { TelemetryBuffer } from "../sim/buffer";

const INITIAL_DURATION_MS = 2600;
const CAMERA_SETTLE_MS = 2600;

const css = (value: string, alpha = 1): Cesium.Color =>
  Cesium.Color.fromCssColorString(value).withAlpha(alpha);

const smoothAngle = (current: number, target: number, factor: number): number => {
  const difference =
    ((((target - current + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return current + difference * factor;
};

export class DroneScene {
  private readonly viewer: Cesium.Viewer;
  private readonly world: WorldFrame;
  private readonly drone: DroneModel;
  private readonly decorations: Cesium.Entity[] = [];
  private routeEntities: Cesium.Entity[] = [];
  private readonly preRenderHandler: () => void;
  private buffer: TelemetryBuffer | null = null;
  private cameraMode: CameraMode = "chase";
  private cameraUnlockAt = performance.now() + INITIAL_DURATION_MS;
  private readonly smoothedTarget = new Cesium.Cartesian3();
  private targetReady = false;
  private smoothedHeading = 0;
  private destroyed = false;
  private buildings: Cesium.GeoJsonDataSource | null = null;
  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement) {
    this.viewer = new Cesium.Viewer(container, {
      baseLayer: new Cesium.ImageryLayer(
        new Cesium.OpenStreetMapImageryProvider({
          url: "https://tile.openstreetmap.org/",
          maximumLevel: 19,
        }),
      ),
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
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    });

    const layer = this.viewer.imageryLayers.get(0);
    layer.saturation = 0.32;
    layer.brightness = 0.64;
    layer.contrast = 1.1;
    layer.gamma = 0.95;

    const scene = this.viewer.scene;
    scene.globe.baseColor = css("#0a1220");
    scene.globe.enableLighting = false;
    scene.globe.showGroundAtmosphere = true;
    scene.fog.enabled = true;
    scene.fog.density = 0.00016;
    scene.postProcessStages.fxaa.enabled = true;
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.hueShift = -0.03;
      scene.skyAtmosphere.saturationShift = -0.3;
      scene.skyAtmosphere.brightnessShift = -0.12;
    }
    scene.backgroundColor = css("#050a14");
    this.viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-10-21T20:30:00Z");

    this.world = createWorldFrame();
    this.addBeacons();
    this.drone = new DroneModel(this.viewer, this.world);
    void this.loadBuildings();

    this.preRenderHandler = () => this.preRender();
    scene.preRender.addEventListener(this.preRenderHandler);
    this.cameraUnlockAt = performance.now() + INITIAL_DURATION_MS;

    this.resizeObserver = new ResizeObserver(() => {
      this.viewer.resize();
    });
    this.resizeObserver.observe(container);
  }

  private addBeacons(): void {
    this.addBeacon(this.world.enu([0, 0, 0]), "UTS", "Despegue", COLORS.green);
    this.addBeacon(this.world.enu(routeFrame.displacement), "UIS", "Entrega", COLORS.orange);
  }

  private addBeacon(
    position: Cesium.Cartesian3,
    title: string,
    subtitle: string,
    color: string,
  ): void {
    this.decorations.push(
      this.viewer.entities.add({
        position,
        cylinder: {
          length: 6,
          topRadius: 1.5,
          bottomRadius: 3.2,
          material: css(color, 0.5),
          outline: true,
          outlineColor: css(color, 0.9),
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
          pixelOffset: new Cesium.Cartesian2(0, -32),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    );
  }

  private async loadBuildings(): Promise<void> {
    try {
      const dataSource = await Cesium.GeoJsonDataSource.load("/api/buildings", {
        clampToGround: false,
        credit: "OpenStreetMap contributors",
      });
      if (this.destroyed) return;

      for (const entity of dataSource.entities.values) {
        const polygon = entity.polygon;
        if (!polygon) continue;
        const rawHeight = entity.properties?.height?.getValue(Cesium.JulianDate.now());
        const height = typeof rawHeight === "number" && rawHeight > 0 ? rawHeight : 9;
        const seed = String(entity.id)
          .split("")
          .reduce((total, character) => total + character.charCodeAt(0), 0);
        const shade = 0.24 + ((seed % 13) / 13) * 0.14;
        polygon.height = new Cesium.ConstantProperty(0.2);
        polygon.extrudedHeight = new Cesium.ConstantProperty(height);
        polygon.material = new Cesium.ColorMaterialProperty(
          Cesium.Color.fromHsl(0.58 + ((seed % 7) / 7) * 0.03, 0.22, shade, 0.97),
        );
        polygon.outline = new Cesium.ConstantProperty(false);
      }

      this.buildings = dataSource;
      await this.viewer.dataSources.add(dataSource);
    } catch {
      this.buildings = null;
    }
  }

  attachBuffer(buffer: TelemetryBuffer): void {
    this.buffer = buffer;
  }

  setRoute(route: readonly Vec3[]): void {
    for (const entity of this.routeEntities) {
      this.viewer.entities.remove(entity);
    }
    this.routeEntities = [];

    if (route.length < 2) return;

    const positions = route.map((point) => this.world.enu(point));
    this.routeEntities.push(
      this.viewer.entities.add({
        polyline: {
          positions,
          width: 4,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: css(COLORS.accent, 0.9),
          }),
          arcType: Cesium.ArcType.NONE,
        },
      }),
      this.viewer.entities.add({
        polyline: {
          positions: route.map((point) => this.world.ground(point)),
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: css(COLORS.accent, 0.35),
            dashLength: 18,
          }),
          arcType: Cesium.ArcType.NONE,
        },
      }),
    );

    for (const point of route.slice(1, -1)) {
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

    this.drone.clearTrail();
    const sphere = Cesium.BoundingSphere.fromPoints(positions);
    this.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(sphere.center, 1200), {
      offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(-20), Cesium.Math.toRadians(-38), 3600),
      duration: INITIAL_DURATION_MS / 1000,
    });
    this.cameraUnlockAt = performance.now() + CAMERA_SETTLE_MS;
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    this.targetReady = false;
    this.cameraUnlockAt = performance.now() + 700;
    if (mode === "free") {
      this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    }
  }

  private preRender(): void {
    if (this.destroyed) return;
    const sample = this.buffer?.sample();
    if (!sample) return;

    this.drone.update(sample.position, sample.headingDeg);

    if (performance.now() < this.cameraUnlockAt) return;

    const target = this.world.enu(sample.position);
    const heading = Cesium.Math.toRadians(sample.headingDeg);

    if (!this.targetReady) {
      Cesium.Cartesian3.clone(target, this.smoothedTarget);
      this.smoothedHeading = heading;
      this.targetReady = true;
    } else {
      Cesium.Cartesian3.lerp(this.smoothedTarget, target, 0.22, this.smoothedTarget);
      this.smoothedHeading = smoothAngle(this.smoothedHeading, heading, 0.16);
    }

    const camera = this.viewer.camera;
    switch (this.cameraMode) {
      case "chase":
        camera.lookAt(
          this.smoothedTarget,
          new Cesium.HeadingPitchRange(this.smoothedHeading, Cesium.Math.toRadians(-16), 18),
        );
        break;
      case "orbit":
        camera.lookAt(
          this.smoothedTarget,
          new Cesium.HeadingPitchRange(
            performance.now() * 0.00022,
            Cesium.Math.toRadians(-22),
            46,
          ),
        );
        break;
      case "top":
        camera.lookAt(
          this.smoothedTarget,
          new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-88), 900),
        );
        break;
      case "free":
        break;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.viewer.scene.preRender.removeEventListener(this.preRenderHandler);
    this.drone.destroy();
    if (this.buildings) {
      this.viewer.dataSources.remove(this.buildings, true);
      this.buildings = null;
    }
    for (const entity of [...this.decorations, ...this.routeEntities]) {
      this.viewer.entities.remove(entity);
    }
    this.decorations.length = 0;
    this.routeEntities = [];
    this.viewer.destroy();
  }
}

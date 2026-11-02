import * as Cesium from "cesium";
import { routeFrame, type Vec3 } from "@dron/shared";
import { CITY_GROUND_HEIGHT, COLORS, type CameraMode } from "./constants";
import { DroneModel } from "./drone";
import { createWorldFrame, type WorldFrame } from "./world";
import type { TelemetryBuffer } from "../sim/buffer";

const INITIAL_DURATION_MS = 2600;
const CAMERA_SETTLE_MS = 2600;
const CAMERA_FOV_DEG = 55;
const CHASE_DISTANCE = 9.5;
const CHASE_SIDE = 0.6;
const CHASE_HEIGHT = 2.4;

const css = (value: string, alpha = 1): Cesium.Color =>
  Cesium.Color.fromCssColorString(value).withAlpha(alpha);

export class DroneScene {
  private readonly viewer: Cesium.Viewer;
  private readonly world: WorldFrame;
  private readonly drone: DroneModel;
  private decorations: Cesium.Entity[] = [];
  private routeEntities: Cesium.Entity[] = [];
  private route: readonly Vec3[] = [];
  private readonly preRenderHandler: () => void;
  private buffer: TelemetryBuffer | null = null;
  private cameraMode: CameraMode = "chase";
  private cameraUnlockAt = performance.now() + INITIAL_DURATION_MS;
  private destroyed = false;
  private buildings: Cesium.GeoJsonDataSource | null = null;
  private cityTileset: Cesium.Cesium3DTileset | null = null;
  private readonly resizeObserver: ResizeObserver;
  private readonly creditContainer: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.creditContainer = document.createElement("div");
    this.creditContainer.className = "stage-credits";
    container.append(this.creditContainer);

    this.viewer = new Cesium.Viewer(container, {
      creditContainer: this.creditContainer,
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

    this.viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        maximumLevel: 19,
        credit: new Cesium.Credit("Esri World Imagery"),
      }),
    );
    const layer = this.viewer.imageryLayers.get(0);
    layer.saturation = 0.92;
    layer.brightness = 0.96;
    layer.contrast = 1.04;
    this.viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        maximumLevel: 19,
      }),
    );

    const scene = this.viewer.scene;
    scene.globe.baseColor = css("#0a1220");
    scene.globe.enableLighting = false;
    scene.globe.showGroundAtmosphere = true;
    scene.fog.enabled = true;
    scene.fog.density = 0.00006;
    scene.postProcessStages.fxaa.enabled = true;
    if (scene.skyAtmosphere) {
      scene.skyAtmosphere.hueShift = -0.03;
      scene.skyAtmosphere.saturationShift = -0.3;
      scene.skyAtmosphere.brightnessShift = -0.12;
    }
    scene.backgroundColor = css("#050a14");
    this.viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-10-21T15:00:00Z");

    const frustum = this.viewer.camera.frustum;
    if (frustum instanceof Cesium.PerspectiveFrustum) {
      frustum.fov = Cesium.Math.toRadians(CAMERA_FOV_DEG);
    }

    this.world = createWorldFrame();
    this.world.setGround(CITY_GROUND_HEIGHT, true);
    scene.globe.show = false;
    this.addBeacons();
    this.drone = new DroneModel(this.viewer, this.world);
    void this.loadCity();

    this.preRenderHandler = () => this.preRender();
    scene.preRender.addEventListener(this.preRenderHandler);
    this.cameraUnlockAt = performance.now() + INITIAL_DURATION_MS;

    this.resizeObserver = new ResizeObserver(() => {
      this.viewer.resize();
    });
    this.resizeObserver.observe(container);
  }

  private addBeacons(): void {
    for (const entity of this.decorations) {
      this.viewer.entities.remove(entity);
    }
    this.decorations = [];
    this.addBeacon([0, 0, 0], "UTS", "Despegue", COLORS.green);
    this.addBeacon(routeFrame.displacement, "UIS", "Entrega", COLORS.orange);
  }

  private addBeacon(
    vector: Vec3,
    title: string,
    subtitle: string,
    color: string,
  ): void {
    const ground = this.world.ground(vector);
    const top = this.world.enu([vector[0], vector[1], 6]);
    this.decorations.push(
      this.viewer.entities.add({
        position: ground,
        ellipse: {
          semiMajorAxis: 3.2,
          semiMinorAxis: 3.2,
          material: css(color, 0.1),
          outline: true,
          outlineColor: css(color, 0.8),
          height: new Cesium.CallbackProperty(
            () =>
              (Cesium.Cartographic.fromCartesian(ground)?.height ?? 0) + 0.12,
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
    this.world.setGround(CITY_GROUND_HEIGHT, true);
    this.addBeacons();
    this.drawRoute();
    this.drone.clearTrail();
  }

  private async loadCity(): Promise<void> {
    const key = import.meta.env.VITE_GOOGLE_3D_TILES_KEY as string | undefined;
    try {
      const tileset = await Cesium.createGooglePhotorealistic3DTileset(
        key ? { key } : undefined,
        { maximumScreenSpaceError: 10 },
      );
      if (this.destroyed) {
        tileset.destroy();
        return;
      }
      this.cityTileset = tileset;
      this.viewer.scene.primitives.add(tileset);
      this.viewer.scene.globe.show = false;
      this.refreshGround();
      await this.loadBuildings();
      return;
    } catch (error) {
      console.warn("Google 3D Tiles no disponible; se intenta OSM Buildings", error);
    }

    try {
      const buildings = await Cesium.createOsmBuildingsAsync({
        defaultColor: Cesium.Color.fromCssColorString("#c3ccd6"),
      });
      if (this.destroyed) {
        buildings.destroy();
        return;
      }
      this.cityTileset = buildings;
      this.viewer.scene.primitives.add(buildings);
      this.viewer.scene.globe.show = false;
      this.refreshGround();
      await this.loadBuildings();
      return;
    } catch (error) {
      console.warn("OSM Buildings no disponible; se usan extrusions locales", error);
    }

    this.world.setGround(0, false);
    this.viewer.scene.globe.show = true;
    this.addBeacons();
    this.drawRoute();
    this.drone.clearTrail();
    await this.loadBuildings();
  }

  private async loadBuildings(): Promise<void> {
    try {
      const dataSource = await Cesium.GeoJsonDataSource.load("/api/buildings", {
        clampToGround: false,
        credit: "OpenStreetMap contributors",
      });
      if (this.destroyed) return;

      const inverse = Cesium.Matrix4.inverse(this.world.matrix, new Cesium.Matrix4());
      const scratch = new Cesium.Cartesian3();
      const now = Cesium.JulianDate.now();
      const destination = routeFrame.displacement;
      const exclusion = 120;
      const local = (center: Cesium.Cartesian3): Vec3 => {
        const point = Cesium.Matrix4.multiplyByPoint(inverse, center, scratch);
        return [point.x, point.y, 0];
      };

      for (const entity of dataSource.entities.values) {
        const polygon = entity.polygon;
        if (!polygon) continue;
        const rawHeight = entity.properties?.height?.getValue(now);
        const height = typeof rawHeight === "number" && rawHeight > 0 ? rawHeight : 9;
        if (height > 40) continue;
        const seed = String(entity.id)
          .split("")
          .reduce((total, character) => total + character.charCodeAt(0), 0);
        const shade = 0.4 + ((seed % 13) / 13) * 0.16;

        const hierarchy = polygon.hierarchy?.getValue(now);
        const positions = hierarchy?.positions;
        const center =
          positions && positions.length > 0
            ? Cesium.BoundingSphere.fromPoints(positions).center
            : Cesium.Cartesian3.ZERO;
        const point = local(center);
        if (Math.hypot(point[0], point[1]) < exclusion) continue;
        if (Math.hypot(point[0] - destination[0], point[1] - destination[1]) < exclusion) {
          continue;
        }
        const ground = this.world.heightAt(point);

        polygon.height = new Cesium.ConstantProperty(ground + 0.15);
        polygon.extrudedHeight = new Cesium.ConstantProperty(ground + height);
        polygon.material = new Cesium.ColorMaterialProperty(
          Cesium.Color.fromHsl(0.58 + ((seed % 7) / 7) * 0.03, 0.14, shade, 0.82),
        );
        polygon.outline = new Cesium.ConstantProperty(true);
        polygon.outlineColor = new Cesium.ConstantProperty(
          Cesium.Color.fromCssColorString("#0f172a").withAlpha(0.35),
        );
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
    this.route = route;
    const positions = this.drawRoute();
    if (!positions || positions.length < 2) return;

    this.drone.clearTrail();
    const sphere = Cesium.BoundingSphere.fromPoints(positions);
    this.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(sphere.center, 1200), {
      offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(-20), Cesium.Math.toRadians(-38), 3600),
      duration: INITIAL_DURATION_MS / 1000,
    });
    this.cameraUnlockAt = performance.now() + CAMERA_SETTLE_MS;
  }

  private drawRoute(): Cesium.Cartesian3[] | null {
    for (const entity of this.routeEntities) {
      this.viewer.entities.remove(entity);
    }
    this.routeEntities = [];

    if (this.route.length < 2) return null;

    const positions = this.route.map((point) => this.world.enu(point));
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
          positions: this.route.map((point) => this.world.ground(point)),
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: css(COLORS.accent, 0.35),
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
    this.cameraMode = mode;
    if (mode !== "free") {
      this.cameraUnlockAt = performance.now();
    } else {
      this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    }
  }

  private placeCamera(position: Cesium.Cartesian3, target: Cesium.Cartesian3): void {
    const camera = this.viewer.camera;
    const direction = Cesium.Cartesian3.subtract(target, position, new Cesium.Cartesian3());
    const length = Cesium.Cartesian3.magnitude(direction);
    if (length < 1e-3) return;
    Cesium.Cartesian3.normalize(direction, direction);

    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(position);
    const inverse = Cesium.Matrix4.inverse(transform, new Cesium.Matrix4());
    const local = Cesium.Matrix4.multiplyByPointAsVector(
      inverse,
      direction,
      new Cesium.Cartesian3(),
    );
    Cesium.Cartesian3.normalize(local, local);

    const heading = Math.atan2(local.x, local.y);
    const pitch = Math.asin(Cesium.Math.clamp(local.z, -1, 1));
    camera.setView({ destination: position, orientation: { heading, pitch, roll: 0 } });
  }

  private preRender(): void {
    if (this.destroyed) return;
    const sample = this.buffer?.sample();
    if (!sample) return;

    const now = performance.now();
    this.drone.update(sample);

    if (now < this.cameraUnlockAt) return;

    const heading = Cesium.Math.toRadians(sample.headingDeg);

    const p = sample.position;
    switch (this.cameraMode) {
      case "chase": {
        const forward = heading;
        const offset: Vec3 = [
          p[0] - Math.sin(forward) * CHASE_DISTANCE + Math.cos(forward) * CHASE_SIDE,
          p[1] - Math.cos(forward) * CHASE_DISTANCE - Math.sin(forward) * CHASE_SIDE,
          p[2] + CHASE_HEIGHT,
        ];
        const look: Vec3 = [
          p[0] + Math.sin(forward) * 7,
          p[1] + Math.cos(forward) * 7,
          p[2] + 1.8,
        ];
        this.placeCamera(this.world.enu(offset), this.world.enu(look));
        break;
      }
      case "orbit": {
        const angle = now * 0.00012;
        const radius = 13;
        const offset: Vec3 = [
          p[0] + Math.cos(angle) * radius,
          p[1] + Math.sin(angle) * radius,
          p[2] + 7.5,
        ];
        this.placeCamera(this.world.enu(offset), this.world.enu([p[0], p[1], p[2] + 1.4]));
        break;
      }
      case "top": {
        const position = this.world.enu([p[0] + 0.2, p[1], p[2] + 80]);
        this.placeCamera(position, this.world.enu([p[0], p[1], p[2]]));
        break;
      }
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
    if (this.cityTileset) {
      this.viewer.scene.primitives.remove(this.cityTileset);
      this.cityTileset = null;
    }
    if (this.buildings) {
      this.viewer.dataSources.remove(this.buildings, true);
      this.buildings = null;
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

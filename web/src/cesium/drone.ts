import * as Cesium from "cesium";
import type { Telemetry, Vec3 } from "@dron/shared";
import { COLORS, DRONE_MODEL_SCALE, GEAR_CLEARANCE, PACKAGE_SIZE } from "./constants";
import type { WorldFrame } from "./world";

const TRAIL_MIN_DISTANCE = 2.5;
const TRAIL_MAX_POINTS = 1500;
const ROTOR_BASE_RPS = 4.5;
const ROTOR_SPEED_GAIN = 1.4;
const ROTOR_MAX_RPS = 14;

const color = (css: string, alpha = 1): Cesium.Color =>
  Cesium.Color.fromCssColorString(css).withAlpha(alpha);

export class DroneModel {
  private readonly entities: Cesium.Entity[] = [];
  private readonly trailPositions: Cesium.Cartesian3[] = [];
  private readonly trailEntity: Cesium.Entity;
  private readonly fallback: Cesium.Entity;
  private center = new Cesium.Cartesian3();
  private ground = new Cesium.Cartesian3();
  private rotation = Cesium.Matrix3.clone(Cesium.Matrix3.IDENTITY);
  private modelMatrix = Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY);
  private model: Cesium.Model | null = null;
  private fallbackShadow: Cesium.Entity | null = null;
  private lastTrailPoint: Cesium.Cartesian3 | null = null;
  private lastFrameTime = performance.now();
  private pitch = 0;
  private roll = 0;
  private rotorPhase = 0;
  private display: Vec3 = [0, 0, GEAR_CLEARANCE];
  private destroyed = false;

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly world: WorldFrame,
  ) {
    this.center = this.world.enu([0, 0, GEAR_CLEARANCE]);
    this.ground = this.world.ground([0, 0, 0]);

    this.trailEntity = this.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => this.trailPositions, false),
        width: 2.4,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: color(COLORS.accent, 0.72),
        }),
        arcType: Cesium.ArcType.NONE,
      },
    });

    this.fallback = this.add({
      position: new Cesium.CallbackPositionProperty(() => this.center, false),
      ellipsoid: {
        radii: new Cesium.Cartesian3(0.58, 0.58, 0.18),
        material: color(COLORS.body),
        outline: true,
        outlineColor: color(COLORS.accent, 0.8),
      },
    });

    this.fallbackShadow = this.add({
      ellipse: {
        semiMajorAxis: 0.9,
        semiMinorAxis: 0.9,
        material: color("#000000", 0.2),
        height: new Cesium.CallbackProperty(
          () => (Cesium.Cartographic.fromCartesian(this.ground)?.height ?? 0) + 0.15,
          false,
        ),
      },
      position: new Cesium.CallbackPositionProperty(() => this.ground, false),
    });
    // Se activa solo si el GLB no carga: sin sombras reales, el respaldo
    // quedaría suspendido en el aire.
    this.fallbackShadow.show = false;
    void this.loadModel();
  }

  private add(options: Cesium.Entity.ConstructorOptions): Cesium.Entity {
    const entity = this.viewer.entities.add(options);
    this.entities.push(entity);
    return entity;
  }

  private async loadModel(): Promise<void> {
    try {
      const model = await Cesium.Model.fromGltfAsync({
        url: "/models/dron-reparto.glb",
        modelMatrix: this.modelMatrix,
        scale: DRONE_MODEL_SCALE,
        upAxis: Cesium.Axis.Z,
        forwardAxis: Cesium.Axis.Y,
        clampAnimations: false,
        shadows: Cesium.ShadowMode.ENABLED,
        enableShowOutline: false,
        backFaceCulling: true,
      });
      if (this.destroyed) {
        model.destroy();
        return;
      }
      this.model = model;
      this.model.modelMatrix = this.modelMatrix;
      this.viewer.scene.primitives.add(model);
      const start = (): void => {
        if (this.destroyed) return;
        model.activeAnimations.addAll({
          loop: Cesium.ModelAnimationLoop.REPEAT,
          animationTime: (duration) => this.rotorPhase % duration,
        });
        this.fallback.show = false;
      };
      if (model.ready) start();
      else model.readyEvent.addEventListener(start);
    } catch (error) {
      if (this.fallbackShadow) this.fallbackShadow.show = true;
      console.warn(
        "No se pudo cargar el modelo GLB del dron; se usa el respaldo",
        error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : String(error),
      );
    }
  }


  update(sample: Telemetry, hoverZ?: number | null): void {
    if (this.destroyed) return;
    const now = performance.now();
    const deltaSeconds = Math.min(0.1, Math.max(0.001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;

    // `world.enu` ya añade la elevación real del terreno, así que aquí solo
    // hace falta el offset de la geometría del modelo sobre el suelo.
    const minimumZ = GEAR_CLEARANCE;
    const engineZ = sample.position[2] + GEAR_CLEARANCE;
    const hoverOverride = hoverZ ?? null;
    const displayZ =
      hoverOverride !== null && hoverOverride > engineZ
        ? Math.max(hoverOverride, minimumZ)
        : Math.max(engineZ, minimumZ);
    const display: Vec3 = [sample.position[0], sample.position[1], displayZ];
    this.display = display;
    this.center = this.world.enu(display);
    this.ground = this.world.ground(display);

    // Los rotores giran con tiempo real: siguen girando aunque la simulación
    // esté pausada, como un dron realmente en hover.
    const rotorRate = Math.min(
      ROTOR_MAX_RPS,
      ROTOR_BASE_RPS + sample.speed * ROTOR_SPEED_GAIN,
    );
    this.rotorPhase += deltaSeconds * rotorRate;

    const speed = Math.hypot(sample.velocity[0], sample.velocity[1]);
    const heading = Cesium.Math.toRadians(sample.headingDeg);
    const lateralAcceleration =
      sample.acceleration[0] * Math.cos(heading) -
      sample.acceleration[1] * Math.sin(heading);
    const targetPitch = -Math.min(0.2, speed * 0.009);
    // Un cuadricóptero real inclina 15-25° al girar; el valor anterior (0.2 rad
    // máx) nunca se alcanzaba porque la aceleración lateral está limitada a
    // 2.5 m/s². Con ganancia 0.12 el banco llega a ~17°.
    const targetRoll = Cesium.Math.clamp(lateralAcceleration * 0.12, -0.32, 0.32);
    const blend = 1 - Math.exp(-deltaSeconds * 6);
    this.pitch += (targetPitch - this.pitch) * blend;
    this.roll += (targetRoll - this.roll) * blend;

    const orientation = Cesium.Transforms.headingPitchRollQuaternion(
      this.center,
      new Cesium.HeadingPitchRoll(heading, this.pitch, this.roll),
    );
    this.rotation = Cesium.Matrix3.fromQuaternion(orientation, this.rotation);
    this.modelMatrix = Cesium.Matrix4.fromRotationTranslation(
      this.rotation,
      this.center,
      this.modelMatrix,
    );
    if (this.model) this.model.modelMatrix = this.modelMatrix;

    if (
      !this.lastTrailPoint ||
      Cesium.Cartesian3.distance(this.lastTrailPoint, this.center) >= TRAIL_MIN_DISTANCE
    ) {
      if (
        this.lastTrailPoint &&
        Cesium.Cartesian3.distance(this.lastTrailPoint, this.center) > 240
      ) {
        this.trailPositions.length = 0;
      }
      this.lastTrailPoint = Cesium.Cartesian3.clone(this.center);
      this.trailPositions.push(Cesium.Cartesian3.clone(this.center));
      if (this.trailPositions.length > TRAIL_MAX_POINTS) this.trailPositions.shift();
    }
  }

  get trail(): Cesium.Entity {
    return this.trailEntity;
  }

  /** Posición visual del centro del dron en ENU (incluye clamp y hover). */
  get displayPosition(): Vec3 {
    return this.display;
  }

  /**
   * Centro del paquete cuando va enganchado: cara inferior del fuselaje
   * (z = -0.205 unidades de modelo) menos media altura de la caja, para que
   * quede colgando y no atravesando el chasis.
   */
  bellyPoint(): Vec3 {
    const [x, y, z] = this.display;
    return [x, y, z - 0.205 * DRONE_MODEL_SCALE - PACKAGE_SIZE[2] / 2];
  }

  clearTrail(): void {
    this.trailPositions.length = 0;
    this.lastTrailPoint = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.model) {
      this.viewer.scene.primitives.remove(this.model);
      this.model = null;
    }
    for (const entity of this.entities) this.viewer.entities.remove(entity);
    this.entities.length = 0;
    this.trailPositions.length = 0;
  }
}

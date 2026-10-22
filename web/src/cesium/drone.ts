import * as Cesium from "cesium";
import type { Telemetry, Vec3 } from "@dron/shared";
import { COLORS } from "./constants";
import type { WorldFrame } from "./world";

const ARM_LENGTH = 0.46;
const ROTOR_HEIGHT = 0.12;
const BLADE_LENGTH = 0.24;
const GEAR_CLEARANCE = 0.34;
const TRAIL_MIN_DISTANCE = 2.5;
const TRAIL_MAX_POINTS = 1500;

const color = (css: string, alpha = 1): Cesium.Color =>
  Cesium.Color.fromCssColorString(css).withAlpha(alpha);

interface DroneState {
  position: Vec3;
  headingDeg: number;
  velocity: Vec3;
  acceleration: Vec3;
  t: number;
  rotorPhase: number;
}

export class DroneModel {
  private readonly entities: Cesium.Entity[] = [];
  private readonly trailPositions: Cesium.Cartesian3[] = [];
  private readonly trailEntity: Cesium.Entity;
  private readonly state: DroneState = {
    position: [0, 0, 0],
    headingDeg: 0,
    velocity: [0, 0, 0],
    acceleration: [0, 0, 0],
    t: 0,
    rotorPhase: 0,
  };
  private center = new Cesium.Cartesian3();
  private ground = new Cesium.Cartesian3();
  private rotation = Cesium.Matrix3.clone(Cesium.Matrix3.IDENTITY);
  private orientation = new Cesium.Quaternion(0, 0, 0, 1);
  private lastTrailPoint: Cesium.Cartesian3 | null = null;
  private lastFrameTime = performance.now();
  private pitch = 0;
  private roll = 0;
  private destroyed = false;

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly world: WorldFrame,
  ) {
    this.center = this.world.enu(this.state.position);
    this.ground = this.world.ground(this.state.position);

    this.trailEntity = this.add({
      polyline: {
        positions: new Cesium.CallbackProperty(() => this.trailPositions, false),
        width: 3,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.28,
          color: color(COLORS.accent, 0.9),
        }),
        arcType: Cesium.ArcType.NONE,
      },
    });

    this.buildFrame();
    this.buildRotors();
    this.buildCamera();
    this.buildPackage();
    this.buildLights();
    this.buildShadowAndTether();
  }

  private add(options: Cesium.Entity.ConstructorOptions): Cesium.Entity {
    const entity = this.viewer.entities.add(options);
    this.entities.push(entity);
    return entity;
  }

  private localPoint(x: number, y: number, z: number): Cesium.Cartesian3 {
    const offset = Cesium.Matrix3.multiplyByVector(
      this.rotation,
      new Cesium.Cartesian3(x, y, z),
      new Cesium.Cartesian3(),
    );
    return Cesium.Cartesian3.add(this.center, offset, new Cesium.Cartesian3());
  }

  private orientationProperty(): Cesium.CallbackProperty {
    return new Cesium.CallbackProperty(() => this.orientation, false);
  }

  private positionProperty(x: number, y: number, z: number): Cesium.CallbackPositionProperty {
    return new Cesium.CallbackPositionProperty(() => this.localPoint(x, y, z), false);
  }

  private box(
    x: number,
    y: number,
    z: number,
    dimensions: Cesium.Cartesian3,
    material: Cesium.Color,
    outline?: Cesium.Color,
  ): void {
    this.add({
      position: this.positionProperty(x, y, z),
      orientation: this.orientationProperty(),
      box: {
        dimensions,
        material,
        outline: Boolean(outline),
        outlineColor: outline ?? material,
        outlineWidth: 1,
      },
    });
  }

  private buildFrame(): void {
    this.box(
      0,
      0,
      0,
      new Cesium.Cartesian3(0.64, 0.44, 0.14),
      color(COLORS.body),
      color(COLORS.metal, 0.45),
    );
    this.box(
      0,
      -0.01,
      0.085,
      new Cesium.Cartesian3(0.46, 0.32, 0.055),
      color("#1e293b"),
      color("#0f172a", 0.8),
    );
    this.box(
      0,
      0.21,
      0.055,
      new Cesium.Cartesian3(0.16, 0.08, 0.05),
      color(COLORS.accent, 0.85),
      color("#0ea5e9"),
    );
    this.box(
      0,
      -0.02,
      0.135,
      new Cesium.Cartesian3(0.3, 0.22, 0.06),
      color("#334155"),
      color("#0f172a"),
    );
    this.box(
      0,
      -0.02,
      0.168,
      new Cesium.Cartesian3(0.32, 0.035, 0.062),
      color(COLORS.package, 0.95),
    );

    for (let index = 0; index < 4; index += 1) {
      const angle = Math.PI / 4 + (index * Math.PI) / 2;
      const dx = Math.sin(angle);
      const dy = Math.cos(angle);
      this.add({
        polyline: {
          positions: new Cesium.CallbackProperty(
            () => [
              this.localPoint(dx * 0.16, dy * 0.14, 0.0),
              this.localPoint(dx * ARM_LENGTH, dy * ARM_LENGTH, 0.015),
            ],
            false,
          ),
          width: 5,
          material: color(COLORS.metal, 0.9),
          arcType: Cesium.ArcType.NONE,
        },
      });
      this.add({
        polyline: {
          positions: new Cesium.CallbackProperty(
            () => [
              this.localPoint(dx * 0.18, dy * 0.17, -0.075),
              this.localPoint(dx * 0.28, dy * 0.26, -0.29),
            ],
            false,
          ),
          width: 2.5,
          material: color("#64748b", 0.9),
          arcType: Cesium.ArcType.NONE,
        },
      });
    }

    for (const side of [-1, 1]) {
      this.add({
        polyline: {
          positions: new Cesium.CallbackProperty(
            () => [
              this.localPoint(side * 0.27, -0.3, -0.3),
              this.localPoint(side * 0.27, 0.3, -0.3),
            ],
            false,
          ),
          width: 3.5,
          material: color("#1f2937"),
          arcType: Cesium.ArcType.NONE,
        },
      });
    }

    this.add({
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => [
            this.localPoint(0.1, -0.2, 0.06),
            this.localPoint(0.16, -0.34, 0.3),
          ],
          false,
        ),
        width: 1.6,
        material: color("#94a3b8"),
        arcType: Cesium.ArcType.NONE,
      },
    });
  }

  private buildRotors(): void {
    for (let index = 0; index < 4; index += 1) {
      const angle = Math.PI / 4 + (index * Math.PI) / 2;
      const x = Math.sin(angle) * ARM_LENGTH;
      const y = Math.cos(angle) * ARM_LENGTH;

      this.add({
        position: this.positionProperty(x, y, ROTOR_HEIGHT - 0.05),
        orientation: this.orientationProperty(),
        cylinder: {
          length: 0.1,
          topRadius: 0.05,
          bottomRadius: 0.062,
          material: color("#475569"),
          outline: true,
          outlineColor: color("#0f172a", 0.8),
        },
      });

      this.add({
        position: this.positionProperty(x, y, ROTOR_HEIGHT + 0.008),
        orientation: this.orientationProperty(),
        cylinder: {
          length: 0.02,
          topRadius: 0.03,
          bottomRadius: 0.03,
          material: color("#cbd5e1"),
        },
      });

      this.add({
        position: this.positionProperty(x, y, ROTOR_HEIGHT + 0.024),
        orientation: this.orientationProperty(),
        cylinder: {
          length: 0.006,
          topRadius: BLADE_LENGTH,
          bottomRadius: BLADE_LENGTH,
          material: color("#e0f2fe", 0.18),
        },
      });

      for (let blade = 0; blade < 2; blade += 1) {
        const offset = blade * (Math.PI / 2);
        this.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => {
              const bladeAngle = this.state.rotorPhase + offset + index * 0.6;
              const dx = Math.cos(bladeAngle) * BLADE_LENGTH;
              const dy = Math.sin(bladeAngle) * BLADE_LENGTH;
              return [
                this.localPoint(x - dx, y - dy, ROTOR_HEIGHT + 0.03),
                this.localPoint(x + dx, y + dy, ROTOR_HEIGHT + 0.03),
              ];
            }, false),
            width: 2,
            material: color("#bae6fd", 0.32),
            arcType: Cesium.ArcType.NONE,
          },
        });
      }
    }
  }

  private buildCamera(): void {
    this.add({
      position: this.positionProperty(0, 0.22, -0.11),
      ellipsoid: {
        radii: new Cesium.Cartesian3(0.075, 0.075, 0.07),
        material: color("#1f2937"),
        outline: true,
        outlineColor: color("#64748b", 0.8),
      },
    });
    this.add({
      position: this.positionProperty(0, 0.29, -0.11),
      ellipsoid: {
        radii: new Cesium.Cartesian3(0.038, 0.03, 0.038),
        material: color("#020617"),
      },
    });
    this.add({
      position: this.positionProperty(0, 0.32, -0.11),
      point: {
        pixelSize: 4,
        color: color("#38bdf8", 0.9),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  private buildPackage(): void {
    this.box(
      0,
      -0.02,
      -0.21,
      new Cesium.Cartesian3(0.28, 0.22, 0.16),
      color(COLORS.package),
      color("#7c2d12", 0.9),
    );
    this.box(
      0,
      -0.02,
      -0.21,
      new Cesium.Cartesian3(0.3, 0.028, 0.17),
      color("#78350f", 0.95),
    );
    this.box(
      0,
      -0.02,
      -0.21,
      new Cesium.Cartesian3(0.028, 0.24, 0.17),
      color("#78350f", 0.95),
    );
  }

  private buildLights(): void {
    const lights: Array<{ x: number; y: number; color: string }> = [
      { x: 0.33, y: 0.0, color: COLORS.green },
      { x: -0.33, y: 0.0, color: COLORS.red },
    ];
    for (const light of lights) {
      this.add({
        position: this.positionProperty(light.x, light.y, 0.02),
        point: {
          pixelSize: 5,
          color: color(light.color),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
    this.add({
      position: this.positionProperty(0, -0.26, 0.12),
      point: {
        pixelSize: 6,
        color: Cesium.Color.WHITE,
        show: new Cesium.CallbackProperty(
          () => this.state.t % 1.1 < 0.08,
          false,
        ),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  private buildShadowAndTether(): void {
    this.add({
      ellipse: {
        semiMajorAxis: 1.0,
        semiMinorAxis: 1.0,
        material: color("#000000", 0.26),
        height: new Cesium.CallbackProperty(
          () =>
            (Cesium.Cartographic.fromCartesian(this.ground)?.height ?? 0) + 0.15,
          false,
        ),
      },
      position: new Cesium.CallbackPositionProperty(() => this.ground, false),
    });

    this.add({
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => [this.center, this.ground],
          false,
        ),
        width: 1.2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: color(COLORS.accent, 0.28),
          dashLength: 12,
        }),
        arcType: Cesium.ArcType.NONE,
      },
    });
  }

  update(sample: Telemetry): void {
    if (this.destroyed) return;
    const now = performance.now();
    const deltaSeconds = Math.min(0.1, Math.max(0.001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;

    this.state.position = [sample.position[0], sample.position[1], sample.position[2]];
    this.state.headingDeg = sample.headingDeg;
    this.state.velocity = [sample.velocity[0], sample.velocity[1], sample.velocity[2]];
    this.state.acceleration = [
      sample.acceleration[0],
      sample.acceleration[1],
      sample.acceleration[2],
    ];
    this.state.t = sample.t;

    const display: Vec3 = [
      this.state.position[0],
      this.state.position[1],
      this.state.position[2] + GEAR_CLEARANCE,
    ];
    this.center = this.world.enu(display);
    this.ground = this.world.ground(display);

    const speed = Math.hypot(this.state.velocity[0], this.state.velocity[1]);
    const heading = Cesium.Math.toRadians(this.state.headingDeg);
    const rightX = Math.cos(heading);
    const rightY = -Math.sin(heading);
    const lateralAcceleration =
      this.state.acceleration[0] * rightX + this.state.acceleration[1] * rightY;

    const targetPitch = -Math.min(0.17, speed * 0.0085);
    const targetRoll = Cesium.Math.clamp(lateralAcceleration * 0.03, -0.24, 0.24);
    const blend = 1 - Math.exp(-deltaSeconds * 7);
    this.pitch += (targetPitch - this.pitch) * blend;
    this.roll += (targetRoll - this.roll) * blend;

    this.orientation = Cesium.Transforms.headingPitchRollQuaternion(
      this.center,
      new Cesium.HeadingPitchRoll(heading, this.pitch, this.roll),
    );
    this.rotation = Cesium.Matrix3.fromQuaternion(this.orientation, new Cesium.Matrix3());

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
      if (this.trailPositions.length > TRAIL_MAX_POINTS) {
        this.trailPositions.shift();
      }
    }
  }

  get trail(): Cesium.Entity {
    return this.trailEntity;
  }

  clearTrail(): void {
    this.trailPositions.length = 0;
    this.lastTrailPoint = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const entity of this.entities) {
      this.viewer.entities.remove(entity);
    }
    this.entities.length = 0;
    this.trailPositions.length = 0;
  }
}

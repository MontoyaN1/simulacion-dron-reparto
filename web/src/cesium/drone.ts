import * as Cesium from "cesium";
import type { Vec3 } from "@dron/shared";
import { COLORS } from "./constants";
import type { WorldFrame } from "./world";

const ARM_LENGTH = 0.72;
const ROTOR_HEIGHT = 0.08;
const BLADE_LENGTH = 0.3;
const TRAIL_MIN_DISTANCE = 2.5;
const TRAIL_MAX_POINTS = 1500;

const color = (css: string, alpha = 1): Cesium.Color =>
  Cesium.Color.fromCssColorString(css).withAlpha(alpha);

export class DroneModel {
  private readonly entities: Cesium.Entity[] = [];
  private readonly trailPositions: Cesium.Cartesian3[] = [];
  private readonly trailEntity: Cesium.Entity;
  private readonly state = {
    position: [0, 0, 0] as Vec3,
    headingDeg: 0,
    rotorPhase: 0,
  };
  private lastTrailPoint: Cesium.Cartesian3 | null = null;
  private lastFrameTime = performance.now();
  private destroyed = false;

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly world: WorldFrame,
  ) {
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

    for (let index = 0; index < 4; index += 1) {
      const armAngle = Math.PI / 4 + (index * Math.PI) / 2;
      this.add({
        polyline: {
          positions: new Cesium.CallbackProperty(() => {
            const arm = this.armGeometry(armAngle);
            return [
              this.world.enu(this.state.position),
              this.world.enu([arm.x, arm.y, arm.z + 0.02]),
            ];
          }, false),
          width: 5,
          material: color(COLORS.metal, 0.95),
          arcType: Cesium.ArcType.NONE,
        },
      });

      this.add({
        ellipsoid: {
          radii: new Cesium.Cartesian3(0.33, 0.33, 0.018),
          material: color(COLORS.accent, 0.14),
          outline: true,
          outlineColor: color(COLORS.accent, 0.5),
        },
        position: new Cesium.CallbackPositionProperty(() => {
          const arm = this.armGeometry(armAngle);
          return this.world.enu([arm.x, arm.y, arm.z + ROTOR_HEIGHT]);
        }, false),
      });

      this.add({
        polyline: {
          positions: new Cesium.CallbackProperty(() => {
            const arm = this.armGeometry(armAngle);
            const bladeAngle = this.state.rotorPhase + (index * Math.PI) / 2;
            const dx = Math.cos(bladeAngle) * BLADE_LENGTH;
            const dy = Math.sin(bladeAngle) * BLADE_LENGTH;
            return [
              this.world.enu([arm.x - dx, arm.y - dy, arm.z + ROTOR_HEIGHT]),
              this.world.enu([arm.x + dx, arm.y + dy, arm.z + ROTOR_HEIGHT]),
            ];
          }, false),
          width: 2,
          material: color("#bae6fd", 0.85),
          arcType: Cesium.ArcType.NONE,
        },
      });
    }

    this.add({
      box: {
        dimensions: new Cesium.Cartesian3(1.05, 1.05, 0.3),
        material: color(COLORS.body),
        outline: true,
        outlineColor: color(COLORS.metal, 0.55),
      },
      position: new Cesium.CallbackPositionProperty(
        () => this.world.enu(this.state.position),
        false,
      ),
      orientation: new Cesium.CallbackProperty(() => {
        const position = this.world.enu(this.state.position);
        return Cesium.Transforms.headingPitchRollQuaternion(
          position,
          new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(this.state.headingDeg), 0, 0),
        );
      }, false),
    });

    this.add({
      box: {
        dimensions: new Cesium.Cartesian3(0.38, 0.3, 0.22),
        material: color(COLORS.package),
        outline: true,
        outlineColor: color("#7c2d12", 0.8),
      },
      position: new Cesium.CallbackPositionProperty(() => {
        const p = this.state.position;
        return this.world.enu([p[0], p[1], p[2] - 0.34]);
      }, false),
    });

    this.add({
      point: {
        pixelSize: 7,
        color: color(COLORS.accent),
        outlineColor: color("#e0f2fe", 0.9),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      position: new Cesium.CallbackPositionProperty(() => {
        const p = this.state.position;
        return this.world.enu([p[0], p[1], p[2] - 0.15]);
      }, false),
    });

    this.add({
      ellipse: {
        semiMajorAxis: 1.1,
        semiMinorAxis: 1.1,
        material: color("#000000", 0.28),
        height: 0.2,
      },
      position: new Cesium.CallbackPositionProperty(
        () => this.world.ground(this.state.position),
        false,
      ),
    });

    this.add({
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => [this.world.enu(this.state.position), this.world.ground(this.state.position)],
          false,
        ),
        width: 1.2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: color(COLORS.accent, 0.3),
          dashLength: 12,
        }),
        arcType: Cesium.ArcType.NONE,
      },
    });
  }

  private add(options: Cesium.Entity.ConstructorOptions): Cesium.Entity {
    const entity = this.viewer.entities.add(options);
    this.entities.push(entity);
    return entity;
  }

  private armGeometry(armAngle: number): { x: number; y: number; z: number } {
    const heading = Cesium.Math.toRadians(this.state.headingDeg);
    const forward = ARM_LENGTH * Math.cos(armAngle);
    const right = ARM_LENGTH * Math.sin(armAngle);
    const p = this.state.position;
    return {
      x: p[0] + forward * Math.sin(heading) + right * Math.cos(heading),
      y: p[1] + forward * Math.cos(heading) - right * Math.sin(heading),
      z: p[2],
    };
  }

  update(position: Vec3, headingDeg: number): void {
    if (this.destroyed) return;
    const now = performance.now();
    const deltaSeconds = Math.min(0.1, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    this.state.position = [position[0], position[1], position[2]];
    this.state.headingDeg = headingDeg;
    this.state.rotorPhase += deltaSeconds * 34;

    const center = this.world.enu(this.state.position);
    if (
      !this.lastTrailPoint ||
      Cesium.Cartesian3.distance(this.lastTrailPoint, center) >= TRAIL_MIN_DISTANCE
    ) {
      this.lastTrailPoint = Cesium.Cartesian3.clone(center);
      this.trailPositions.push(Cesium.Cartesian3.clone(center));
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

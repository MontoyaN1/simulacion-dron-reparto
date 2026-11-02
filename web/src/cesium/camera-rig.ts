import * as Cesium from "cesium";
import type { Telemetry, Vec3 } from "@dron/shared";
import { CAMERA_CONTROLS, CAMERA_LIMTS, type CameraMode } from "./constants";
import type { WorldFrame } from "./world";
import type { TerrainSampling } from "./terrain";

interface Transition {
  readonly startedAt: number;
  readonly durationMs: number;
  readonly fromPosition: Cesium.Cartesian3;
  readonly fromTarget: Cesium.Cartesian3;
}

const CHASE_DISTANCE = 8.6;
const CHASE_SIDE = 0.65;
const CHASE_HEIGHT = 2.35;
const ORBIT_RADIUS = 12.5;
const ORBIT_HEIGHT = 5.8;
const TOP_HEIGHT = 85;
const FREE_VERTICAL_PITCH = Cesium.Math.toRadians(0.1);

const blend = (dt: number, rate: number): number => 1 - Math.exp(-dt * rate);
const smoothStep = (value: number): number => value * value * (3 - 2 * value);
const smoothAngle = (current: number, target: number, factor: number): number => {
  const difference =
    ((((target - current + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return current + difference * factor;
};
const clampToRange = (value: number, range: { readonly min: number; readonly max: number }): number =>
  Math.max(range.min, Math.min(range.max, value));

export class CameraRig {
  private mode: CameraMode = "chase";
  private initialized = false;
  private readonly target: [number, number, number] = [0, 0, 0];
  private heading = 0;
  private orbitAngle = 0;
  private lastFrameAt = performance.now();
  private lastLookTarget: Cesium.Cartesian3 | null = null;
  private transition: Transition | null = null;

  private chaseDistance = CHASE_DISTANCE;
  private chaseSide = 0;
  private chaseLookAhead = 0;
  private orbitRadius = ORBIT_RADIUS;
  private orbitHeightOffset = 0;
  private topHeight = TOP_HEIGHT;
  private topPanX = 0;
  private topPanY = 0;

  private dragging = false;
  private pointerId: number | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private dragDx = 0;
  private dragDy = 0;
  private pendingWheel = 0;
  private zoomHold = 0;
  private readonly listeners: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = [];

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly world: WorldFrame,
    private readonly terrain: TerrainSampling,
  ) {
    this.attachInteraction();
    this.tuneFreeController();
  }

  setMode(mode: CameraMode, now = performance.now()): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.resetInteraction();
    if (mode === "free") {
      this.transition = null;
      this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      return;
    }
    this.beginTransition(now, 850);
  }

  beginFollow(now = performance.now()): void {
    if (this.mode !== "free") this.beginTransition(now, 1200);
  }

  destroy(): void {
    for (const [target, type, listener] of this.listeners) {
      target.removeEventListener(type, listener);
    }
    this.listeners.length = 0;
  }

  private resetInteraction(): void {
    this.chaseDistance = CHASE_DISTANCE;
    this.chaseSide = 0;
    this.chaseLookAhead = 0;
    this.orbitRadius = ORBIT_RADIUS;
    this.orbitHeightOffset = 0;
    this.topHeight = TOP_HEIGHT;
    this.topPanX = 0;
    this.topPanY = 0;
  }

  private tuneFreeController(): void {
    const controller = this.viewer.scene.screenSpaceCameraController;
    controller.minimumZoomDistance = 1;
    controller.maximumZoomDistance = 1600;
    controller.inertiaZoom = 0.78;
    controller.inertiaSpin = 0.9;
    controller.inertiaTranslate = 0.86;
  }

  private on(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, options);
    this.listeners.push([target, type, listener]);
  }

  private attachInteraction(): void {
    const canvas = this.viewer.canvas;

    this.on(
      canvas,
      "pointerdown",
      (event) => {
        const pointer = event as PointerEvent;
        if (pointer.pointerType === "touch") return;
        this.dragging = true;
        this.pointerId = pointer.pointerId;
        this.pointerX = pointer.clientX;
        this.pointerY = pointer.clientY;
        this.dragDx = 0;
        this.dragDy = 0;
      },
      { passive: false },
    );
    this.on(
      window,
      "pointermove",
      (event) => {
        if (!this.dragging) return;
        const pointer = event as PointerEvent;
        if (pointer.pointerId !== this.pointerId) return;
        this.dragDx += pointer.clientX - this.pointerX;
        this.dragDy += pointer.clientY - this.pointerY;
        this.pointerX = pointer.clientX;
        this.pointerY = pointer.clientY;
      },
      { passive: true },
    );
    this.on(
      window,
      "pointerup",
      (event) => {
        const pointer = event as PointerEvent;
        if (pointer.pointerId !== this.pointerId) return;
        this.dragging = false;
        this.pointerId = null;
      },
      { passive: true },
    );
    this.on(
      window,
      "pointercancel",
      () => {
        this.dragging = false;
        this.pointerId = null;
      },
      { passive: true },
    );
    this.on(
      canvas,
      "wheel",
      (event) => {
        if (this.mode === "free") return;
        const wheel = event as WheelEvent;
        wheel.preventDefault();
        this.pendingWheel += wheel.deltaY;
      },
      { passive: false },
    );
    this.on(
      window,
      "keydown",
      (event) => {
        const key = (event as KeyboardEvent).code;
        if (!CAMERA_CONTROLS.zoomKeys.includes(key)) return;
        const keyboard = event as KeyboardEvent;
        if (keyboard.repeat) return;
        this.zoomHold += CAMERA_CONTROLS.zoomIn.includes(key) ? 1 : -1;
      },
      { passive: true },
    );
    this.on(
      window,
      "keyup",
      (event) => {
        const key = (event as KeyboardEvent).code;
        if (!CAMERA_CONTROLS.zoomKeys.includes(key)) return;
        this.zoomHold = 0;
      },
      { passive: true },
    );
  }

  private applyInteraction(dt: number): void {
    if (this.mode === "free") {
      this.dragDx = 0;
      this.dragDy = 0;
      this.pendingWheel = 0;
      this.zoomHold = 0;
      return;
    }

    if (this.pendingWheel !== 0) {
      const delta = this.pendingWheel / 100;
      this.applyZoom(Math.sign(delta) * Math.min(2, Math.abs(delta)));
      this.pendingWheel = 0;
    }
    if (this.zoomHold !== 0) {
      this.applyZoom(this.zoomHold * dt * CAMERA_CONTROLS.zoomRate);
    }

    const gain = CAMERA_CONTROLS.dragGain;
    const angleGain = CAMERA_CONTROLS.dragAngleGain;
    if (this.dragging) {
      switch (this.mode) {
        case "chase": {
          this.chaseSide = clampToRange(
            this.chaseSide + this.dragDx * gain,
            CAMERA_LIMTS.chaseSide,
          );
          this.chaseLookAhead = clampToRange(
            this.chaseLookAhead + this.dragDy * gain * 0.7,
            CAMERA_LIMTS.chaseLookAhead,
          );
          break;
        }
        case "orbit": {
          this.orbitAngle += this.dragDx * angleGain;
          this.orbitHeightOffset = clampToRange(
            this.orbitHeightOffset + this.dragDy * gain * 0.55,
            CAMERA_LIMTS.orbitHeight,
          );
          break;
        }
        case "top": {
          const heading = this.heading;
          this.topPanX += this.dragDx * gain * 45 * Math.cos(heading) - this.dragDy * gain * 45 * Math.sin(heading);
          this.topPanY += -this.dragDx * gain * 45 * Math.sin(heading) - this.dragDy * gain * 45 * Math.cos(heading);
          break;
        }
      }
    } else {
      const returnFactor = 1 - Math.exp(-dt * CAMERA_CONTROLS.strafeReturnRate);
      this.chaseSide += (0 - this.chaseSide) * returnFactor;
      this.chaseLookAhead += (0 - this.chaseLookAhead) * returnFactor;
      this.orbitHeightOffset += (0 - this.orbitHeightOffset) * returnFactor;
      this.topPanX += (0 - this.topPanX) * returnFactor;
      this.topPanY += (0 - this.topPanY) * returnFactor;
    }
    this.dragDx = 0;
    this.dragDy = 0;
  }

  private applyZoom(amount: number): void {
    const delta = clampToRange(amount, { min: -2, max: 2 });
    if (Math.abs(delta) < 1e-4) return;
    const zoomFactor = Math.exp(CAMERA_CONTROLS.zoomRate * delta * 0.055);
    switch (this.mode) {
      case "chase":
        this.chaseDistance = clampToRange(this.chaseDistance * zoomFactor, CAMERA_LIMTS.chaseDistance);
        break;
      case "orbit":
        this.orbitRadius = clampToRange(this.orbitRadius * zoomFactor, CAMERA_LIMTS.orbitRadius);
        break;
      case "top":
        this.topHeight = clampToRange(this.topHeight * zoomFactor * 1.6, CAMERA_LIMTS.topHeight);
        break;
    }
  }

  private beginTransition(now: number, durationMs: number): void {
    const camera = this.viewer.camera;
    const fromTarget = this.lastLookTarget
      ? Cesium.Cartesian3.clone(this.lastLookTarget)
      : Cesium.Cartesian3.add(
          camera.position,
          Cesium.Cartesian3.multiplyByScalar(camera.direction, 50, new Cesium.Cartesian3()),
          new Cesium.Cartesian3(),
        );
    this.transition = {
      startedAt: now,
      durationMs,
      fromPosition: Cesium.Cartesian3.clone(camera.position),
      fromTarget,
    };
  }

  placeCamera(position: Cesium.Cartesian3, target: Cesium.Cartesian3): void {
    const camera = this.viewer.camera;
    const direction = Cesium.Cartesian3.subtract(target, position, new Cesium.Cartesian3());
    if (Cesium.Cartesian3.magnitude(direction) < 1e-3) return;
    Cesium.Cartesian3.normalize(direction, direction);

    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(position);
    const inverse = Cesium.Matrix4.inverse(transform, new Cesium.Matrix4());
    const local = Cesium.Matrix4.multiplyByPointAsVector(
      inverse,
      direction,
      new Cesium.Cartesian3(),
    );
    Cesium.Cartesian3.normalize(local, local);
    camera.setView({
      destination: position,
      orientation: {
        heading: Math.atan2(local.x, local.y),
        pitch: Math.asin(Cesium.Math.clamp(local.z, -1, 1)),
        roll: 0,
      },
    });
    this.lastLookTarget = Cesium.Cartesian3.clone(target);
  }

  update(sample: Telemetry, now = performance.now()): void {
    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastFrameAt) / 1000));
    this.lastFrameAt = now;
    if (this.mode === "free") {
      this.clampFreeCamera();
      return;
    }

    this.applyInteraction(dt);

    const position = sample.position;
    const heading = Cesium.Math.toRadians(sample.headingDeg);
    if (!this.initialized) {
      this.target[0] = position[0];
      this.target[1] = position[1];
      this.target[2] = position[2];
      this.heading = heading;
      this.initialized = true;
    } else {
      const jump = Math.hypot(
        position[0] - this.target[0],
        position[1] - this.target[1],
        position[2] - this.target[2],
      );
      if (jump > 220) {
        this.target[0] = position[0];
        this.target[1] = position[1];
        this.target[2] = position[2];
        this.heading = heading;
        this.transition = null;
      } else {
        const positionBlend = blend(dt, 12);
        this.target[0] += (position[0] - this.target[0]) * positionBlend;
        this.target[1] += (position[1] - this.target[1]) * positionBlend;
        this.target[2] += (position[2] - this.target[2]) * positionBlend;
        this.heading = smoothAngle(this.heading, heading, blend(dt, 5));
      }
    }

    let desiredPosition: Vec3;
    let desiredTarget: Vec3;
    if (this.mode === "orbit") {
      this.orbitAngle += dt * 0.12;
      const angle = this.orbitAngle;
      const orbitHeight = Math.max(0.8, ORBIT_HEIGHT + this.orbitHeightOffset);
      desiredPosition = [
        this.target[0] + Math.cos(angle) * this.orbitRadius,
        this.target[1] + Math.sin(angle) * this.orbitRadius,
        this.target[2] + orbitHeight,
      ];
      desiredTarget = [this.target[0], this.target[1], this.target[2] + 0.75];
    } else if (this.mode === "top") {
      const panRadius = Math.hypot(this.topPanX, this.topPanY);
      const maxPan = CAMERA_LIMTS.topPanRadius;
      const scaleX = panRadius > maxPan ? maxPan / panRadius : 1;
      const panX = this.topPanX * scaleX;
      const panY = this.topPanY * scaleX;
      desiredPosition = [this.target[0] + panX, this.target[1] + panY - 0.01, this.target[2] + this.topHeight];
      desiredTarget = [this.target[0] + panX, this.target[1] + panY, this.target[2]];
    } else {
      const forward = this.heading;
      const side = Math.cos(forward) * this.chaseSide;
      const sideY = -Math.sin(forward) * this.chaseSide;
      const look = 4.5 + this.chaseLookAhead;
      desiredPosition = [
        this.target[0] - Math.sin(forward) * this.chaseDistance + side,
        this.target[1] - Math.cos(forward) * this.chaseDistance + sideY,
        this.target[2] + CHASE_HEIGHT,
      ];
      desiredTarget = [
        this.target[0] + Math.sin(forward) * look,
        this.target[1] + Math.cos(forward) * look,
        this.target[2] + 0.85,
      ];
    }

    const safePosition = this.clampCameraAboveGround(desiredPosition);
    let cameraPosition = this.world.enu(safePosition);
    let cameraTarget = this.world.enu(desiredTarget);
    if (this.transition) {
      const progress = Math.min(1, (now - this.transition.startedAt) / this.transition.durationMs);
      const alpha = smoothStep(progress);
      cameraPosition = Cesium.Cartesian3.lerp(
        this.transition.fromPosition,
        cameraPosition,
        alpha,
        new Cesium.Cartesian3(),
      );
      cameraTarget = Cesium.Cartesian3.lerp(
        this.transition.fromTarget,
        cameraTarget,
        alpha,
        new Cesium.Cartesian3(),
      );
      if (progress >= 1) this.transition = null;
    }
    this.placeCamera(cameraPosition, cameraTarget);
  }

  private clampCameraAboveGround(position: Vec3): Vec3 {
    const agl = this.terrain.agl(position);
    const floor = agl + CAMERA_LIMTS.cameraGroundClearance;
    return position[2] < floor ? [position[0], position[1], floor] : position;
  }

  private clampFreeCamera(): void {
    const camera = this.viewer.camera;
    const clampedPitch = Cesium.Math.clamp(
      camera.pitch,
      Cesium.Math.toRadians(-88),
      Cesium.Math.toRadians(6),
    );
    const delta = clampedPitch - camera.pitch;
    if (Math.abs(delta) > FREE_VERTICAL_PITCH) {
      camera.lookUp(delta);
    }
    const carto = camera.positionCartographic;
    if (!carto) return;
    const height = this.viewer.scene.globe.getHeight(carto);
    if (typeof height !== "number" || !Number.isFinite(height)) return;
    const floor = height + CAMERA_LIMTS.cameraGroundClearance;
    if (carto.height < floor) {
      carto.height = floor;
      camera.setView({
        destination: Cesium.Ellipsoid.WGS84.cartographicToCartesian(carto),
        orientation: { heading: camera.heading, pitch: clampedPitch, roll: camera.roll },
      });
    }
  }
}

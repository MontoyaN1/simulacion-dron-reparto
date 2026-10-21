import type { Vec3 } from "../math/vec3";
import { add, distance, dot, norm, scale, sub } from "../math/vec3";
import { remainingAlongRoute, routeMetrics } from "./route";
import type {
  DronePhase,
  SimEvent,
  SimEventType,
  SimulationOptions,
  SimulationSnapshot,
  Telemetry,
} from "./types";
import { defaultSimulationOptions } from "./types";

const MIN_DT = 1e-6;
const MAX_DT = 0.2;

export class DroneSimulation {
  private readonly options: SimulationOptions;
  private readonly cumulative: readonly number[];
  private readonly totalLength: number;

  private position: Vec3 = [0, 0, 0];
  private velocity: Vec3 = [0, 0, 0];
  private acceleration: Vec3 = [0, 0, 0];

  private elapsed = 0;
  private waypointIndex = 0;
  private travelled = 0;
  private energyWh = 0;
  private headingDeg = 0;
  private powerWatts = 0;

  private phase: DronePhase = "idle";
  private started = false;
  private delivered = false;

  private events: SimEvent[] = [];
  private eventCounter = 1;
  private lowBatteryWarned = false;
  private halfwayAnnounced = false;

  constructor(route: readonly Vec3[], overrides: Partial<Omit<SimulationOptions, "route">> = {}) {
    if (route.length < 2) {
      throw new Error("La ruta necesita al menos dos puntos");
    }
    this.options = {
      ...defaultSimulationOptions(route),
      ...overrides,
      route: route.map((point) => [point[0], point[1], point[2]] as Vec3),
    };
    const metrics = routeMetrics(this.options.route);
    this.cumulative = metrics.cumulative;
    this.totalLength = metrics.totalLength;
  }

  get optionsSnapshot(): SimulationOptions {
    return this.options;
  }

  get isStarted(): boolean {
    return this.started;
  }

  get isDelivered(): boolean {
    return this.delivered;
  }

  start(): void {
    if (this.delivered || this.started) return;
    this.started = true;
    this.phase = "takeoff";
    this.pushEvent("system", "Despegue autorizado desde la UTS");
  }

  reset(): void {
    this.position = [0, 0, 0];
    this.velocity = [0, 0, 0];
    this.acceleration = [0, 0, 0];
    this.elapsed = 0;
    this.waypointIndex = 0;
    this.travelled = 0;
    this.energyWh = 0;
    this.headingDeg = 0;
    this.powerWatts = 0;
    this.phase = "idle";
    this.started = false;
    this.delivered = false;
    this.events = [];
    this.eventCounter = 1;
    this.lowBatteryWarned = false;
    this.halfwayAnnounced = false;
  }

  private pushEvent(type: SimEventType, message: string): void {
    this.events.push({
      id: this.eventCounter,
      t: Number(this.elapsed.toFixed(2)),
      type,
      message,
    });
    this.eventCounter += 1;
  }

  private batteryPercent(): number {
    const used = (this.energyWh / this.options.batteryCapacityWh) * 100;
    return Math.max(0, Math.min(100, 100 - used));
  }

  private setPhase(phase: DronePhase, message?: string): void {
    if (this.phase === phase) return;
    this.phase = phase;
    if (message) this.pushEvent("system", message);
  }

  step(rawDt: number): void {
    if (!this.started || this.delivered) return;
    const dt = Math.min(MAX_DT, Math.max(MIN_DT, rawDt));
    const route = this.options.route;
    const target = route[this.waypointIndex];

    if (distance(this.position, target) <= this.options.arrivalRadius) {
      this.waypointIndex += 1;
      if (this.waypointIndex >= route.length) {
        this.finishDelivery();
        return;
      }
      this.position = [target[0], target[1], target[2]];
      const newDirection = sub(route[this.waypointIndex], this.position);
      const directionLength = norm(newDirection);
      if (directionLength > 1e-6) {
        const alongTrack = dot(this.velocity, scale(1 / directionLength, newDirection));
        this.velocity =
          alongTrack > 0
            ? scale(alongTrack, scale(1 / directionLength, newDirection))
            : [0, 0, 0];
      } else {
        this.velocity = [0, 0, 0];
      }
    }

    const currentTarget = route[this.waypointIndex];
    const toTarget = sub(currentTarget, this.position);
    const remaining = norm(toTarget);
    const horizontalDistance = Math.hypot(toTarget[0], toTarget[1]);
    const verticalDistance = Math.abs(toTarget[2]);
    const isVerticalSegment = horizontalDistance < 1 && verticalDistance > 1;

    const targetSpeed = isVerticalSegment
      ? this.options.verticalSpeed
      : this.options.cruiseSpeed;

    let desiredVelocity: Vec3 = [0, 0, 0];
    if (remaining > 1e-6) {
      const limitedSpeed = Math.min(targetSpeed, remaining / dt);
      desiredVelocity = scale(limitedSpeed / remaining, toTarget);
    }

    const velocityError = sub(desiredVelocity, this.velocity);
    const errorNorm = norm(velocityError);
    const accelerationMagnitude = Math.min(this.options.maxAcceleration, errorNorm / dt);
    this.acceleration =
      errorNorm > 1e-9 ? scale(accelerationMagnitude / errorNorm, velocityError) : [0, 0, 0];

    const nextVelocity = add(this.velocity, scale(dt, this.acceleration));

    let nextPosition = add(this.position, scale(dt, nextVelocity));
    const stepLength = distance(this.position, nextPosition);
    if (stepLength >= remaining) {
      nextPosition = currentTarget;
    }

    const actualStep = distance(this.position, nextPosition);
    this.travelled += actualStep;
    this.position = nextPosition;
    this.velocity = stepLength >= remaining ? desiredVelocity : nextVelocity;

    this.elapsed += dt;

    const horizontalSpeed = Math.hypot(this.velocity[0], this.velocity[1]);
    if (horizontalSpeed > 0.4) {
      this.headingDeg = ((Math.atan2(this.velocity[0], this.velocity[1]) * 180) / Math.PI + 360) % 360;
    }

    const speed = norm(this.velocity);
    const climbRate = Math.max(0, this.velocity[2]);
    this.powerWatts =
      this.options.hoverPowerW +
      this.options.dragPowerFactor * speed * speed +
      this.options.climbPowerW * climbRate;
    this.energyWh += (this.powerWatts * dt) / 3600;

    const nextPhase = this.classifyPhase(currentTarget, horizontalDistance);
    if (nextPhase === "cruise" && this.phase === "takeoff") {
      this.setPhase("cruise", "Ascenso completado: inicio de crucero");
    } else if (nextPhase === "descent" && this.phase !== "descent") {
      this.setPhase("descent", "Inicio del descenso hacia la UIS");
    } else {
      this.setPhase(nextPhase);
    }

    const progress = this.totalLength > 0 ? 1 - this.distanceRemaining() / this.totalLength : 0;
    if (!this.halfwayAnnounced && progress >= 0.5) {
      this.halfwayAnnounced = true;
      this.pushEvent("system", "Mitad del recorrido superada");
    }

    const battery = this.batteryPercent();
    if (!this.lowBatteryWarned && battery <= 20) {
      this.lowBatteryWarned = true;
      this.pushEvent("warning", "Bateria por debajo del 20 %");
    }
  }

  private classifyPhase(target: Vec3, horizontalDistance: number): DronePhase {
    const dz = target[2] - this.position[2];
    if (horizontalDistance < 2 && dz > 1) {
      return this.waypointIndex <= 1 ? "takeoff" : "cruise";
    }
    if (horizontalDistance < 2 && dz < -1) {
      return "descent";
    }
    return "cruise";
  }

  private finishDelivery(): void {
    const last = this.options.route[this.options.route.length - 1];
    this.position = [last[0], last[1], last[2]];
    this.velocity = [0, 0, 0];
    this.acceleration = [0, 0, 0];
    this.delivered = true;
    this.phase = "delivered";
    this.pushEvent("delivery", "Paquete entregado en la UIS");
  }

  private distanceRemaining(): number {
    return remainingAlongRoute(this.options.route, this.cumulative, this.waypointIndex, this.position);
  }

  drainEvents(): SimEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  telemetry(): Telemetry {
    const speed = norm(this.velocity);
    const remaining = this.distanceRemaining();
    return {
      t: this.elapsed,
      position: [this.position[0], this.position[1], this.position[2]],
      velocity: [this.velocity[0], this.velocity[1], this.velocity[2]],
      acceleration: [this.acceleration[0], this.acceleration[1], this.acceleration[2]],
      speed,
      verticalSpeed: this.velocity[2],
      headingDeg: this.headingDeg,
      altitudeAgl: this.position[2],
      distanceTravelled: this.travelled,
      distanceRemaining: remaining,
      progress: this.totalLength > 0 ? Math.max(0, Math.min(1, 1 - remaining / this.totalLength)) : 0,
      batteryPercent: this.batteryPercent(),
      powerWatts: this.powerWatts,
      phase: this.phase,
      waypointIndex: this.waypointIndex,
    };
  }

  snapshot(): SimulationSnapshot {
    return {
      options: this.options,
      telemetry: this.telemetry(),
      route: this.options.route,
      events: [...this.events],
      delivered: this.delivered,
      started: this.started,
    };
  }
}

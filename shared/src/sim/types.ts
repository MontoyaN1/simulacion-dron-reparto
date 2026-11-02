import type { Vec3 } from "../math/vec3";

export type DronePhase = "idle" | "takeoff" | "cruise" | "descent" | "delivered";

export type SimEventType = "system" | "decision" | "warning" | "delivery";

export interface SimEvent {
  readonly id: number;
  readonly t: number;
  readonly type: SimEventType;
  readonly message: string;
}

export interface Telemetry {
  readonly t: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly acceleration: Vec3;
  readonly speed: number;
  readonly verticalSpeed: number;
  readonly headingDeg: number;
  readonly altitudeAgl: number;
  readonly distanceTravelled: number;
  readonly distanceRemaining: number;
  readonly progress: number;
  readonly batteryPercent: number;
  readonly powerWatts: number;
  readonly phase: DronePhase;
  readonly waypointIndex: number;
}

export interface SimulationOptions {
  readonly seed: number;
  readonly route: readonly Vec3[];
  readonly cruiseSpeed: number;
  readonly verticalSpeed: number;
  readonly maxAcceleration: number;
  readonly arrivalRadius: number;
  readonly batteryCapacityWh: number;
  readonly hoverPowerW: number;
  readonly dragPowerFactor: number;
  readonly climbPowerW: number;
}

export interface SimulationSnapshot {
  readonly options: SimulationOptions;
  readonly telemetry: Telemetry;
  readonly route: readonly Vec3[];
  readonly events: readonly SimEvent[];
  readonly delivered: boolean;
  readonly started: boolean;
}

export const DEFAULT_CRUISE_SPEED = 15;
export const DEFAULT_CRUISE_ALTITUDE = 50;

export const defaultSimulationOptions = (
  route: readonly Vec3[],
): Omit<SimulationOptions, "route"> => ({
  seed: 20261021,
  cruiseSpeed: DEFAULT_CRUISE_SPEED,
  verticalSpeed: 4,
  maxAcceleration: 2.5,
  arrivalRadius: 1.5,
  batteryCapacityWh: 80,
  hoverPowerW: 210,
  dragPowerFactor: 1.6,
  climbPowerW: 45,
});

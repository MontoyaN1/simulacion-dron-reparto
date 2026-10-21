export type {
  DronePhase,
  SimEvent,
  SimEventType,
  SimulationOptions,
  SimulationSnapshot,
  Telemetry,
} from "./types";
export {
  DEFAULT_CRUISE_ALTITUDE,
  DEFAULT_CRUISE_SPEED,
  defaultSimulationOptions,
} from "./types";

export { DroneSimulation } from "./engine";
export { remainingAlongRoute, resampleRoute, routeMetrics, straightRoute, verticalRoute } from "./route";
export type { RouteMetrics } from "./route";

export type {
  ClientCommand,
  ServerMessage,
  SessionInfo,
  SimulationStatus,
} from "./protocol";
export { isClientCommand } from "./protocol";

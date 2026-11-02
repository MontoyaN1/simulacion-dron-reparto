import type { Campus } from "../config/campuses";
import type { Vec3 } from "../math/vec3";
import type { SimEvent, Telemetry } from "./types";

export interface SimulationStatus {
  readonly running: boolean;
  readonly speed: number;
  readonly started: boolean;
  readonly delivered: boolean;
}

export interface SessionInfo {
  readonly telemetry: Telemetry;
  readonly route: readonly Vec3[];
  readonly events: readonly SimEvent[];
  readonly status: SimulationStatus;
  readonly campuses: readonly Campus[];
}

export type ClientCommand =
  | { readonly type: "start" }
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "reset" }
  | { readonly type: "speed"; readonly value: number };

export type ServerMessage =
  | { readonly type: "init"; readonly payload: SessionInfo }
  | { readonly type: "telemetry"; readonly payload: Telemetry }
  | { readonly type: "status"; readonly payload: SimulationStatus }
  | { readonly type: "event"; readonly payload: SimEvent }
  | { readonly type: "route"; readonly payload: { readonly route: readonly Vec3[] } };

export const isClientCommand = (value: unknown): value is ClientCommand => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { type?: unknown; value?: unknown };
  switch (candidate.type) {
    case "start":
    case "pause":
    case "resume":
    case "reset":
      return true;
    case "speed":
      return typeof candidate.value === "number" && Number.isFinite(candidate.value);
    default:
      return false;
  }
};

export const BASE_ALTITUDE_METERS = 0;

export const CAMERA_MODES = [
  { id: "chase", label: "Persecución" },
  { id: "orbit", label: "Órbita" },
  { id: "top", label: "Cenital" },
  { id: "free", label: "Libre" },
] as const;

export type CameraMode = (typeof CAMERA_MODES)[number]["id"];

export const COLORS = {
  accent: "#38bdf8",
  green: "#22c55e",
  orange: "#f97316",
  red: "#ef4444",
  body: "#111827",
  metal: "#94a3b8",
  package: "#f59e0b",
} as const;

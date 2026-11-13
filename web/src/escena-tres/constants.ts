export const BASE_ALTITUDE_METERS = 0;

/**
 * Geometría real del GLB (`scripts/build-drone-model.mjs`): el punto más bajo
 * del tren de aterrizaje está en z = -0.3 con radio 0.023 => -0.323 unidades
 * de modelo. La escala aplicada al cargar el modelo se multiplica aquí.
 * Cualquier cambio en el GLB debe actualizar este número.
 */
export const DRONE_MODEL_SCALE = 1.15;
export const GEAR_CLEARANCE = 0.323 * DRONE_MODEL_SCALE + 0.25;
export const CITY_GROUND_HEIGHT = 938.5;

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

export const MISSION_ZONES = {
  uts: { radius: 16 },
  uis: { radius: 18 },
  deliveryClearance: 0.5,
} as const;


export const BASE_ALTITUDE_METERS = 0;
export const CITY_GROUND_HEIGHT = 938.5;

/**
 * Geometría real del GLB (`scripts/build-drone-model.mjs`): el punto más bajo
 * del tren de aterrizaje está en z = -0.3 con radio 0.023 => -0.323 unidades
 * de modelo. La escala aplicada al cargar el modelo se multiplica aquí.
 * Cualquier cambio en el GLB debe actualizar este número.
 */
export const DRONE_MODEL_SCALE = 1.15;
export const DRONE_SKID_OFFSET = 0.323;
export const DRONE_GROUND_MARGIN = 0.25;
export const GEAR_CLEARANCE = DRONE_SKID_OFFSET * DRONE_MODEL_SCALE + DRONE_GROUND_MARGIN;

/**
 * Altura de hover durante la carga/descarga. Deja el vientre del dron a la
 * altura de las manos del repartidor (un dron real se carga así, no en el
 * suelo).
 */
export const DRONE_HANDOFF_HEIGHT = 1.45;

/** Dimensiones del paquete en metros: [ancho, fondo, alto]. */
export const PACKAGE_SIZE: readonly [number, number, number] = [0.34, 0.26, 0.22];

export const CAMERA_MODES = [
  { id: "chase", label: "Persecución" },
  { id: "orbit", label: "Órbita" },
  { id: "top", label: "Cenital" },
  { id: "free", label: "Libre" },
] as const;

export type CameraMode = (typeof CAMERA_MODES)[number]["id"];

export const CAMERA_LIMTS = {
  chaseDistance: { min: 3.5, max: 32 },
  chaseSide: { min: -12, max: 12 },
  chaseLookAhead: { min: -6, max: 22 },
  orbitRadius: { min: 5, max: 60 },
  orbitHeight: { min: 1, max: 22 },
  topHeight: { min: 24, max: 380 },
  topPanRadius: 240,
  cameraGroundClearance: 1.4,
} as const;

export const CAMERA_CONTROLS = {
  zoomKeys: ["KeyQ", "KeyE", "Equal", "NumpadAdd", "NumpadSubtract"] as readonly string[],
  zoomIn: ["KeyE", "Equal", "NumpadAdd"] as readonly string[],
  zoomRate: 2.1,
  strafeReturnRate: 0.35,
  dragGain: 0.024,
  dragAngleGain: 0.0045,
} as const;

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

export const MISSION_COLORS = {
  carrier: "#38bdf8",
  receiver: "#f97316",
  package: "#f59e0b",
  packageStrap: "#7c2d12",
} as const;

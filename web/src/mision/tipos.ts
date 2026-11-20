import type { CameraMode } from "../escena-tres/constants";

/**
 * Estados de la misión que consume el HUD.
 */
export type MissionState =
  | "esperando"
  | "en_zona"
  | "animando_entrega"
  | "paquete_cargado"
  | "animando_recepcion"
  | "completado";

export const MISSION_STATE_LABEL: Record<MissionState, string> = {
  esperando: "Zonas listas",
  en_zona: "En zona",
  animando_entrega: "Entrega del paquete…",
  paquete_cargado: "Paquete cargado",
  animando_recepcion: "Recepción del paquete…",
  completado: "Recepción completada",
};

export type { CameraMode };

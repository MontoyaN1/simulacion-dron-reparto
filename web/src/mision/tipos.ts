import type { CameraMode } from "../cesium/constants";

/**
 * Estados de la misión compartidos por los dos motores de escena
 * (Cesium y three.js). El HUD cambia sin importar el motor.
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

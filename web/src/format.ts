import type { DronePhase, Vec3 } from "@dron/shared";

export const fmt = (value: number, digits = 1): string =>
  new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);

export const fmtInt = (value: number): string =>
  new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(value);

export const fmtClock = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

export const fmtVector = (vector: Vec3, digits = 1): string =>
  `(${fmt(vector[0], digits)}, ${fmt(vector[1], digits)}, ${fmt(vector[2], digits)})`;

export const PHASE_LABELS: Record<DronePhase, string> = {
  idle: "En espera",
  takeoff: "Despegue",
  cruise: "Crucero",
  descent: "Descenso",
  delivered: "Entregado",
};

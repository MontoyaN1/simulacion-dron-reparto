/**
 * Infraestructura de render de la escena: elección de backend y medición de
 * FPS. La lógica pura vive aquí para poder testearla sin WebGL/WebGPU real.
 */

export type Backend = "webgpu" | "webgl";

/**
 * Elige el backend de render. Con WebGPU disponible usa "webgpu"; si no,
 * cae a "webgl". El renderer real (WebGPURenderer de three) tiene fallback
 * WebGL2 integrado, pero esta función permite anticipar y reportar el backend
 * antes de crear el renderer.
 */
export const detectarBackend = async (webgpuDisponible: boolean): Promise<Backend> =>
  webgpuDisponible ? "webgpu" : "webgl";

/**
 * FPS a partir de los deltas (ms) de los últimos frames. Devuelve 0 si no hay
 * frames (evita división por cero).
 */
export const calcularFps = (deltasMs: readonly number[]): number => {
  if (deltasMs.length === 0) return 0;
  const total = deltasMs.reduce((suma, d) => suma + d, 0);
  if (total <= 0) return 0;
  return (deltasMs.length * 1000) / total;
};

/** Comprueba soporte WebGPU del entorno (navegador). */
export const webgpuDisponible = (): boolean =>
  typeof navigator !== "undefined" && "gpu" in navigator;

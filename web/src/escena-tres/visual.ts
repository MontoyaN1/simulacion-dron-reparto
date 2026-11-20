/**
 * Estado del acabado visual y guarda de FPS. Cuando el framerate baja de 45 se
 * degradan capas visuales en orden de menor a mayor identidad visual: primero
 * bloom, luego sombras, luego nubes. El toon es la identidad visual del proyecto
 * y nunca se degrada. Una capa apagada no se reactiva sola.
 */

export interface EstadoVisual {
  toon: boolean;
  sombras: boolean;
  bloom: boolean;
  nubes: boolean;
}

export const FPS_MINIMO = 45;

/**
 * Aplica la guarda de FPS: devuelve un nuevo estado con una capa menos si
 * `fps` está por debajo del mínimo. Orden de degradación: bloom → sombras →
 * nubes. Nunca reactiva capas apagadas ni toca `toon`.
 */
export const degradarPorFps = (fps: number, estado: EstadoVisual): EstadoVisual => {
  if (fps >= FPS_MINIMO) return estado;
  if (estado.bloom) return { ...estado, bloom: false };
  if (estado.sombras) return { ...estado, sombras: false };
  if (estado.nubes) return { ...estado, nubes: false };
  return estado;
};

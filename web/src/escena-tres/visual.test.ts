import { describe, expect, it } from "vitest";
import { degradarPorFps, type EstadoVisual } from "./visual";

describe("Task 5: acabado visual con guarda de fps", () => {
  it("con fps alto el estado visual mantiene toon, sombras y bloom", () => {
    const estado: EstadoVisual = { toon: true, sombras: true, bloom: true, nubes: true };
    const result = degradarPorFps(58, estado);
    expect(result.toon).toBe(true);
    expect(result.sombras).toBe(true);
    expect(result.bloom).toBe(true);
  });

  it("con fps bajo (45) degrada primero bloom", () => {
    const estado: EstadoVisual = { toon: true, sombras: true, bloom: true, nubes: true };
    const result = degradarPorFps(42, estado);
    expect(result.bloom).toBe(false);
    expect(result.sombras).toBe(true); // sombras aguantan todavía
  });

  it("con fps muy bajo degrada bloom, luego sombras, luego nubes", () => {
    let estado: EstadoVisual = { toon: true, sombras: true, bloom: true, nubes: true };
    estado = degradarPorFps(30, estado); // cae bloom
    expect(estado.bloom).toBe(false);
    estado = degradarPorFps(30, estado); // cae sombras
    expect(estado.sombras).toBe(false);
    estado = degradarPorFps(30, estado); // cae nubes
    expect(estado.nubes).toBe(false);
    // toon es la identidad visual: nunca se degrada.
    expect(estado.toon).toBe(true);
  });

  it("nunca reactiva capas ya apagadas con fps fluctuante", () => {
    const estado: EstadoVisual = { toon: true, sombras: true, bloom: false, nubes: true };
    const result = degradarPorFps(60, estado);
    expect(result.bloom).toBe(false); // no se reactiva solo
  });
});

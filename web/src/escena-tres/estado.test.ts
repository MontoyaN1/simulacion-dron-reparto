import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { construirCiudad } from "./ciudad";
import { RouteGroundTable } from "./route-ground";
import { estadoEscena, resetearEstadoEscena } from "./estado";

describe("Task 2: robustez de assets", () => {
  it("asset ausente degrada sin romper la escena", async () => {
    resetearEstadoEscena();
    // Fetch de edificios y carga de textura rotos a propósito.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("sin red")));
    vi.spyOn(THREE.TextureLoader.prototype, "loadAsync").mockRejectedValue(
      new Error("textura ausente"),
    );

    const ciudad = await construirCiudad(new RouteGroundTable());

    // El terreno existe (placeholder si falta la ortofoto).
    expect(ciudad.grupo).toBeInstanceOf(THREE.Group);
    expect(ciudad.grupo.children.length).toBeGreaterThan(0);
    // La escena queda marcada como degradada.
    expect(estadoEscena()).toBe("degradado");

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("caso feliz queda en ok", async () => {
    resetearEstadoEscena();
    // Sin fallos: el estado debe ser ok.
    expect(estadoEscena()).toBe("ok");
  });
});

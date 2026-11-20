import { describe, expect, it, vi } from "vitest";
import { calcularFps, detectarBackend } from "./render";

describe("Task 3: renderer WebGPU con fallback y medidor de fps", () => {
  it("detectarBackend elige webgpu cuando está disponible", async () => {
    await expect(detectarBackend(true)).resolves.toBe("webgpu");
  });

  it("detectarBackend cae a webgl sin WebGPU", async () => {
    await expect(detectarBackend(false)).resolves.toBe("webgl");
  });

  it("calcularFps promedia los deltas de los frames", () => {
    // 4 frames de 16 ms → 62.5 fps aprox.
    const fps = calcularFps([16, 16, 16, 16]);
    expect(fps).toBeGreaterThan(55);
    expect(fps).toBeLessThan(70);
  });

  it("calcularFps devuelve 0 sin frames (evita división por cero)", () => {
    expect(calcularFps([])).toBe(0);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { routeFrame } from "@dron/shared";
import { RouteGroundTable } from "./route-ground";
import { routeGroundHeight } from "./world";

const DATOS = (
  JSON.parse(readFileSync(path.resolve(__dirname, "corridor-ground.json"), "utf8")) as {
    datos: [number, number, number][];
  }
).datos;

const LATERAL = [-150, -75, 0, 75, 150];
const DIRECCION = [
  routeFrame.displacement[0] / routeFrame.distanceMeters,
  routeFrame.displacement[1] / routeFrame.distanceMeters,
];
const LADO = [-DIRECCION[1], DIRECCION[0]];

const enu = (along: number, lateral: number): [number, number, number] => [
  DIRECCION[0] * along + LADO[0] * lateral,
  DIRECCION[1] * along + LADO[1] * lateral,
  0,
];

describe("RouteGroundTable (sin Cesium)", () => {
  const tabla = new RouteGroundTable();

  it("carga el archivo versionado al construir", () => {
    expect(tabla.disponible).toBe(true);
  });

  it("devuelve la altura exacta en el centro de cada celda muestreada", () => {
    for (const [alongIndex, lateralIndex, altura] of DATOS) {
      const medida = tabla.agl(enu(alongIndex * 50, LATERAL[lateralIndex]));
      expect(medida).toBeCloseTo(altura, 6);
    }
  });

  it("acota al borde fuera del corredor lateral en vez de devolver null", () => {
    const borde = tabla.agl(enu(1000, 900));
    expect(borde).not.toBeNull();
    expect(Number.isFinite(borde!)).toBe(true);
  });

  it("interpola entre dos filas consecutivas sin salirse del rango", () => {
    const filas = Math.floor(routeFrame.distanceMeters / 50);
    for (let index = 0; index < filas; index += 1) {
      const a = tabla.agl(enu(index * 50, 0))!;
      const b = tabla.agl(enu((index + 1) * 50, 0))!;
      const medio = tabla.agl(enu(index * 50 + 25, 0))!;
      expect(medio).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-9);
      expect(medio).toBeLessThanOrEqual(Math.max(a, b) + 1e-9);
    }
  });

  it("coincide con el relieve real: la UIS está más alta que la UTS", () => {
    const uts = tabla.agl([0, 0, 0])!;
    const uis = tabla.agl([routeFrame.displacement[0], routeFrame.displacement[1], 0])!;
    expect(uis).toBeGreaterThan(uts);
  });
});

describe("routeGroundHeight (respaldo offline)", () => {
  it("es finito en todo el corredor", () => {
    for (const metros of [0, 500, 1500, 3000, 3981]) {
      expect(Number.isFinite(routeGroundHeight(enu(metros, 0)))).toBe(true);
    }
  });
});

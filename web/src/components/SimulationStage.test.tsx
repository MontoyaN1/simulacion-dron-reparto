// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { SimulationStatus, Telemetry, Vec3 } from "@dron/shared";
import { RouteGroundTable } from "../escena-tres/route-ground";
import { TelemetryBuffer } from "../sim/buffer";
import { SimulationStage } from "./SimulationStage";

/**
 * `EscenaTres` real monta un `WebGLRenderer`, que jsdom no puede crear. Se
 * sustituye por una falsa para poder asertar el CABLEADO (cuántas escenas se
 * construyen y con qué), que es lo que cambia esta tarea. El render en sí se
 * verifica en navegador (`.analisis/web/01-motor-tres.png`).
 */
const { construidas } = vi.hoisted(() => ({
  construidas: [] as { host: HTMLElement; opciones: { corredor: unknown } }[],
}));

vi.mock("../escena-tres/escena", () => ({
  EscenaTres: class {
    constructor(host: HTMLElement, opciones: { corredor: unknown }) {
      construidas.push({ host, opciones });
    }
    attachBuffer(): void {}
    attachMissionState(): void {}
    setRoute(): void {}
    setCameraMode(): void {}
    attachCameraMode(): void {}
    destroy(): void {}
  },
}));

const STATUS: SimulationStatus = {
  running: false,
  speed: 1,
  started: false,
  delivered: false,
};

const telemetria = (): Telemetry => ({
  t: 0,
  position: [0, 0, 0],
  velocity: [0, 0, 0],
  acceleration: [0, 0, 0],
  speed: 0,
  verticalSpeed: 0,
  headingDeg: 0,
  altitudeAgl: 0,
  distanceTravelled: 0,
  distanceRemaining: 0,
  progress: 0,
  batteryPercent: 100,
  powerWatts: 0,
  phase: "idle",
  waypointIndex: 0,
});

const montar = (route: Vec3[] = []) =>
  render(
    <SimulationStage
      buffer={new TelemetryBuffer()}
      route={route}
      telemetry={telemetria()}
      status={STATUS}
      connected
      send={() => {}}
    />,
  );

beforeEach(() => {
  construidas.length = 0;
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("SimulationStage · motor único", () => {
  it("construye exactamente una EscenaTres, con el host y la tabla del corredor", () => {
    montar();

    expect(construidas).toHaveLength(1);
    const { host, opciones } = construidas[0];
    expect(host.classList.contains("stage-host")).toBe(true);
    expect(opciones.corredor).toBeInstanceOf(RouteGroundTable);
  });

  it("ignora cualquier query ?motor= y usa siempre EscenaTres", () => {
    window.history.replaceState({}, "", "/?motor=cesium");
    montar();

    expect(construidas).toHaveLength(1);
    expect(construidas[0].opciones.corredor).toBeInstanceOf(RouteGroundTable);
    window.history.replaceState({}, "", "/");
  });

  it("no muestra la etiqueta del motor retirado en el panel de fps", () => {
    const { container } = montar();
    const etiqueta = container.querySelector(".fps-motor")?.textContent ?? "";

    expect(etiqueta.toLowerCase()).not.toContain("cesium");
    expect(etiqueta).toBe("three");
  });
});

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  RigCamara,
  crearEtiqueta,
  crearHalo,
  dronEnFrustum,
  offsetCamara,
  vistaProyeccion,
  type Fase,
} from "./camara";

const FRAMES = 240;

/**
 * Simula un vuelo coherente por fase y devuelve la última posición del dron.
 * La cámara arranca lejos y debe converger con el lerp, igual que en la escena.
 */
const volarFase = (rig: RigCamara, fase: Fase): { posicion: THREE.Vector3; altura: number } => {
  const posicion = new THREE.Vector3();
  let altura = 0;
  for (let i = 0; i < FRAMES; i++) {
    if (fase === "despegue") altura = 4 + i * 0.25;
    else if (fase === "crucero") altura = 50;
    else if (fase === "descenso") altura = Math.max(6, 50 - i * 0.18);
    else altura = 3;
    posicion.set(0, altura, fase === "crucero" ? i * 0.25 : 40);
    rig.actualizar(posicion, -0.187, 1 / 60, altura);
  }
  return { posicion, altura };
};

describe("Task 4: cámara por fase y dron siempre en cuadro", () => {
  it("el dron queda en cuadro en las 4 fases", () => {
    const rig = new RigCamara(16 / 9);
    for (const f of ["despegue", "crucero", "descenso", "entregado"] as const) {
      rig.setFase(f);
      const { posicion } = volarFase(rig, f);
      expect(dronEnFrustum(posicion, vistaProyeccion(rig.camara)), f).toBe(true);
    }
  });

  it("el dron sigue en cuadro con el zoom en los extremos y pantalla estrecha", () => {
    const rig = new RigCamara(3 / 4);
    for (const dist of [3, 8.6, 60]) {
      rig.dist = dist;
      for (const f of ["despegue", "crucero", "descenso", "entregado"] as const) {
        rig.setFase(f);
        const { posicion } = volarFase(rig, f);
        expect(dronEnFrustum(posicion, vistaProyeccion(rig.camara)), `${f}@${dist}`).toBe(true);
      }
    }
  });

  it("los modos de cámara existentes siguen mirando al dron", () => {
    const rig = new RigCamara(16 / 9);
    rig.dist = 20;
    const posicion = new THREE.Vector3(0, 60, 40);
    for (const modo of ["chase", "orbit", "top", "free"] as const) {
      rig.setModo(modo);
      for (let i = 0; i < FRAMES; i++) rig.actualizar(posicion, 0.2, 1 / 60, 60);
      expect(dronEnFrustum(posicion, vistaProyeccion(rig.camara)), modo).toBe(true);
    }
  });

  it("cada fase usa un encuadre distinto de verdad", () => {
    // Sobre el diseño puro (sin lag del lerp): despegue y descenso van en plano
    // bajo; crucero sube para dar contexto; entregado reposa más lejos y alto.
    const plano = (fase: Fase): { altura: number; distancia: number } => {
      const { offset } = offsetCamara(fase, 0, 8.6, 50);
      return { altura: offset.y, distancia: Math.abs(offset.z) };
    };
    const despegue = plano("despegue");
    const crucero = plano("crucero");
    const descenso = plano("descenso");
    const entregado = plano("entregado");

    expect(despegue.altura).toBeLessThan(crucero.altura);
    expect(descenso.altura).toBeLessThan(crucero.altura);
    expect(despegue.distancia).toBeGreaterThan(crucero.distancia);
    expect(entregado.distancia).toBeGreaterThan(crucero.distancia);
    expect(entregado.altura).toBeGreaterThan(crucero.altura);
    const planos = [despegue, crucero, descenso, entregado].map(
      (m) => `${m.altura}|${m.distancia}`,
    );
    expect(new Set(planos).size).toBe(4);
  });

  it("el plano amplio de arranque no pierde el dron", () => {
    // Reproduce los primeros 2.4 s del visor: cámara amplia sobre el centro de
    // la ruta mirando al origen. El dron está en el pad, fuera de cuadro.
    const rig = new RigCamara(16 / 9);
    rig.camara.position.set(0, 380, -40);
    rig.camara.lookAt(0, 0, 0);
    const dron = new THREE.Vector3(55, 53, 533);
    expect(dronEnFrustum(dron, vistaProyeccion(rig.camara))).toBe(false);

    rig.mirar(dron);
    expect(dronEnFrustum(dron, vistaProyeccion(rig.camara))).toBe(true);
  });

  it("dronEnFrustum rechaza un dron fuera de cuadro", () => {
    // Guarda: el helper debe poder fallar; si no, los tests de fase no prueban nada.
    const rig = new RigCamara(16 / 9);
    // Cámara mirando a -z y dron detrás (a +z): fuera del frustum.
    rig.camara.position.set(0, 0, 0);
    rig.camara.lookAt(0, 0, -1);
    expect(dronEnFrustum(new THREE.Vector3(0, 0, 10), vistaProyeccion(rig.camara))).toBe(false);
    // Y en la dirección de la mirada, dentro.
    expect(dronEnFrustum(new THREE.Vector3(0, 0, -10), vistaProyeccion(rig.camara))).toBe(true);
  });

  it("el dron lleva halo y la etiqueta UTS-01 dibujada", () => {
    const halo = crearHalo();
    expect(halo.geometry).toBeInstanceOf(THREE.RingGeometry);
    expect(halo.material).toBeInstanceOf(THREE.MeshBasicMaterial);

    // Canvas falso: jsdom no implementa 2d, pero aquí basta con registrar el texto.
    const dibujado: string[] = [];
    const contexto = new Proxy({} as Record<string, unknown>, {
      get: (_destino, prop) =>
        prop === "measureText"
          ? () => ({ width: 40 })
          : (...args: unknown[]) => {
              if (prop === "fillText") dibujado.push(String(args[0]));
            },
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    const lienzo = {
      width: 0,
      height: 0,
      getContext: () => contexto,
    } as unknown as HTMLCanvasElement;

    const etiqueta = crearEtiqueta("UTS-01", () => lienzo);
    expect(etiqueta).toBeInstanceOf(THREE.Sprite);
    expect(etiqueta.material.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(etiqueta.position.y).toBeGreaterThan(1);
    expect(dibujado).toContain("UTS-01");
  });
});

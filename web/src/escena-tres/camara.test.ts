// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { crearEtiqueta, crearHalo } from "./camara";

describe("cámara: halo y etiqueta del dron", () => {
  it("el dron lleva halo y la etiqueta UTS-01 dibujada", () => {
    const halo = crearHalo();
    expect(halo.geometry.type).toBe("RingGeometry");
    const material = halo.material as THREE.MeshBasicMaterial;
    expect(material.depthTest).toBe(false);

    const etiqueta = crearEtiqueta("UTS-01", () => {
      // jsdom no implementa canvas 2d: contexto mínimo para el dibujo.
      const ctx = {
        fillStyle: "",
        fillRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        font: "",
        textAlign: "",
        textBaseline: "",
        fillText: () => {},
      };
      const lienzo = {
        width: 0,
        height: 0,
        getContext: () => ctx,
      };
      return lienzo as unknown as HTMLCanvasElement;
    });
    expect(etiqueta).toBeInstanceOf(THREE.Sprite);
    expect((etiqueta.material as THREE.SpriteMaterial).map).not.toBeNull();
  });
});

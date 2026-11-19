import * as THREE from "three";
import { COLORS } from "./constants";

/** Halo pulsante sobre el dron; se orienta a cámara cada frame. */
export const crearHalo = (): THREE.Mesh =>
  new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.15, 48),
    new THREE.MeshBasicMaterial({
      color: COLORS.accent,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );

/**
 * Etiqueta "UTS-01" como sprite con CanvasTexture (sin CSS2DRenderer). El
 * lienzo se inyecta para poder probarla sin DOM.
 */
export const crearEtiqueta = (
  texto: string,
  crearLienzo: () => HTMLCanvasElement = () => document.createElement("canvas"),
): THREE.Sprite => {
  const lienzo = crearLienzo();
  lienzo.width = 256;
  lienzo.height = 72;
  const ctx = lienzo.getContext("2d")!;
  ctx.fillStyle = "rgba(12,21,38,0.86)";
  ctx.fillRect(0, 0, 256, 72);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(0, 68, 256, 4);
  ctx.beginPath();
  ctx.arc(24, 36, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "bold 34px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(texto, 44, 38);

  // El lienzo es sRGB: sin la etiqueta de espacio de color el fondo oscuro
  // se lava contra el cielo.
  const textura = new THREE.CanvasTexture(lienzo);
  textura.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: textura, depthTest: false }),
  );
  sprite.scale.set(3.2, 0.9, 1);
  return sprite;
};

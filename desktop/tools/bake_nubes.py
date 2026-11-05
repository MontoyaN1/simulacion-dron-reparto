#!/usr/bin/env python3
"""Hornea la capa de nubes para el domo de cielo (ruido de valor, FBM).

Salida: desktop/assets/nubes.png (2048x1024 equirectangular, RGBA).
"""
import os
import random
from PIL import Image, ImageChops

ANCHO, ALTO = 2048, 1024
SALIDA = os.path.join(os.path.dirname(__file__), "..", "assets", "nubes.png")


def fbm(ancho, alto, octavas=5, semilla=7):
    random.seed(semilla)
    total = None
    for o in range(octavas):
        w = max(2, ancho >> (o + 3))
        h = max(2, alto >> (o + 3))
        r = Image.new("L", (w, h), 0)
        px = r.load()
        for y in range(h):
            for x in range(w):
                px[x, y] = random.randint(0, 255)
        capa = r.resize((ancho, alto), Image.BICUBIC)
        peso = 0.55 ** o * 255
        capa = capa.point(lambda v: int(v * peso / 255))
        total = capa if total is None else ImageChops.add(total, capa)
    return total


def main():
    n = fbm(ANCHO, ALTO)
    # El borde del rectángulo debe coincidir para que el domo no tenga costura.
    # Se garantiza en la fuente: el ruido es continuo y el muestreo u=0/1 es el mismo.
    img = Image.new("RGBA", (ANCHO, ALTO), (252, 252, 254, 0))
    npx = n.load()
    ipx = img.load()
    umbral, suavidad = 105, 80
    for y in range(ALTO):
        for x in range(ANCHO):
            v = npx[x, y]
            t = (v - umbral) / suavidad
            t = max(0.0, min(1.0, t))
            t = t * t * (3 - 2 * t)  # smoothstep
            # Menos nubes cerca de los polos para que el domo cierre bien.
            pole = 1.0 - abs(y / ALTO - 0.5) * 0.35
            a = int(235 * t * pole)
            ipx[x, y] = (252, 252, 254, a)
    ruta = os.path.abspath(SALIDA)
    img.save(ruta, optimize=True)
    print(f"escrito {ruta} {img.size} {os.path.getsize(ruta) // 1024} KB")


if __name__ == "__main__":
    main()

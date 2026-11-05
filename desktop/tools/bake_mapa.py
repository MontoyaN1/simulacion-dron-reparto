#!/usr/bin/env python3
"""Hornea un mosaico satelital Esri en el marco del corredor.

Por defecto: el área amplia (z16, ±8 km) → assets/mapa-amplio.jpg.
Con --nivel/--along-*/--lateral/--salida/--caja se hornea cualquier capa
(p. ej. la media a z17 para que no se vea pixelada a media distancia).

Escribe además una caja geodésica (lon/lat min/max) para las UV en Rust.
"""
import argparse
import json
import math
import os
import time
import urllib.request
from PIL import Image

LON_UTS, LAT_UTS = -73.123524, 7.1051164
LON_UIS, LAT_UIS = -73.1198652, 7.1409311
TILE = 256
AQUI = os.path.join(os.path.dirname(__file__), "..", "assets")


def ecef(lat, lon):
    a, f = 6378137.0, 1 / 298.257223563
    e2 = f * (2 - f)
    la, lo = math.radians(lat), math.radians(lon)
    n = a / math.sqrt(1 - e2 * math.sin(la) ** 2)
    return (n * math.cos(la) * math.cos(lo), n * math.cos(la) * math.sin(lo), n * (1 - e2) * math.sin(la))


def enu_de(lat, lon):
    o = ecef(LAT_UTS, LON_UTS)
    p = ecef(lat, lon)
    dx, dy, dz = p[0] - o[0], p[1] - o[1], p[2] - o[2]
    la0, lo0 = math.radians(LAT_UTS), math.radians(LON_UTS)
    return (
        -math.sin(lo0) * dx + math.cos(lo0) * dy,
        -math.sin(la0) * math.cos(lo0) * dx - math.sin(la0) * math.sin(lo0) * dy + math.cos(la0) * dz,
    )


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


def px_xy(lat, lon, z):
    n = 2 ** z
    return ((lon + 180.0) / 360.0 * n * TILE, (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n * TILE)


def descargar(url, destino):
    if os.path.exists(destino) and os.path.getsize(destino) > 0:
        return
    for intento in range(5):
        try:
            urllib.request.urlretrieve(url, destino)
            return
        except Exception as e:
            print(f"  reintento {intento + 1}: {e}")
            time.sleep(1.5 * (intento + 1))
    raise RuntimeError(f"no se pudo descargar {url}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nivel", type=int, default=16)
    ap.add_argument("--along-min", type=float, default=-8000.0)
    ap.add_argument("--along-max", type=float, default=9000.0)
    ap.add_argument("--lateral", type=float, default=8000.0)
    ap.add_argument("--salida", default="mapa-amplio.jpg")
    ap.add_argument("--caja", default="mapa-amplio-caja.json")
    args = ap.parse_args()

    largo = math.dist(enu_de(LAT_UIS, LON_UIS), (0.0, 0.0))
    dir_ = [v / largo for v in enu_de(LAT_UIS, LON_UIS)]
    lado = [-dir_[1], dir_[0]]

    def a_lonlat(along, lateral):
        este = dir_[0] * along + lado[0] * lateral
        norte = dir_[1] * along + lado[1] * lateral
        return (LAT_UTS + norte / 111320.0, LON_UTS + este / (111320.0 * math.cos(math.radians(LAT_UTS))))

    esquinas = [
        a_lonlat(args.along_min, -args.lateral),
        a_lonlat(args.along_min, args.lateral),
        a_lonlat(args.along_max, -args.lateral),
        a_lonlat(args.along_max, args.lateral),
    ]
    lat_min = min(c[0] for c in esquinas)
    lat_max = max(c[0] for c in esquinas)
    lon_min = min(c[1] for c in esquinas)
    lon_max = max(c[1] for c in esquinas)
    print(f"bbox lat {lat_min:.5f}..{lat_max:.5f}  lon {lon_min:.5f}..{lon_max:.5f}")

    x0, y0 = tile_xy(lat_max, lon_min, args.nivel)
    x1, y1 = tile_xy(lat_min, lon_max, args.nivel)
    print(f"teselas {x0}..{x1} x {y0}..{y1}  ({(x1 - x0 + 1) * (y1 - y0 + 1)} descargas)")

    ancho = (x1 - x0 + 1) * TILE
    alto = (y1 - y0 + 1) * TILE
    mosaico = Image.new("RGB", (ancho, alto))
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            ruta = f"/tmp/opencode/esri_{args.nivel}_{x}_{y}.jpg"
            descargar(
                f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{args.nivel}/{y}/{x}",
                ruta,
            )
            mosaico.paste(Image.open(ruta).convert("RGB"), ((x - x0) * TILE, (y - y0) * TILE))
        print(f"  columna {x} lista", flush=True)

    px0, py0 = px_xy(lat_max, lon_min, args.nivel)
    px1, py1 = px_xy(lat_min, lon_max, args.nivel)
    recorte = mosaico.crop((int(px0 - x0 * TILE), int(py0 - y0 * TILE), int(px1 - x0 * TILE), int(py1 - y0 * TILE)))
    ruta_salida = os.path.abspath(os.path.join(AQUI, args.salida))
    recorte.save(ruta_salida, quality=86, optimize=True)
    print(f"escrito {ruta_salida}  {recorte.size}  {os.path.getsize(ruta_salida) // 1024} KB")
    with open(os.path.abspath(os.path.join(AQUI, args.caja)), "w") as f:
        json.dump(
            {"lon_min": lon_min, "lon_max": lon_max, "lat_min": lat_min, "lat_max": lat_max, "nivel": args.nivel},
            f,
            indent=2,
        )


if __name__ == "__main__":
    main()

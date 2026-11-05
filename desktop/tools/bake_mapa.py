#!/usr/bin/env python3
"""Hornea un mosaico satelital amplio del área de Bucaramanga.

Usa las teselas públicas de Esri World Imagery (mismo origen que el bake del
corredor) y recorta el rectángulo geodésico pedido.

Salida: desktop/assets/mapa-amplio.jpg
"""
import io
import math
import os
import urllib.request
from PIL import Image

ANCLA_MSNM = 938.5
LON_UTS, LAT_UTS = -73.123524, 7.1051164
LON_UIS, LAT_UIS = -73.1198652, 7.1409311
NIVEL = 16
TILE = 256
SALIDA = os.path.join(os.path.dirname(__file__), "..", "assets", "mapa-amplio.jpg")

# Área en el marco del corredor: desde antes de la UTS hasta pasar la UIS.
ALONG_MIN, ALONG_MAX = -3000.0, 7000.0
LATERAL_MAX = 5000.0


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
    if os.path.exists(destino):
        return
    for intento in range(4):
        try:
            urllib.request.urlretrieve(url, destino)
            return
        except Exception as e:
            print(f"  reintento {intento + 1}: {e}")
            time.sleep(1.5 * (intento + 1))
    raise RuntimeError(f"no se pudo descargar {url}")


import time  # noqa: E402  (usado por descargar)


def main():
    largo = math.dist(enu_de(LAT_UIS, LON_UIS), (0.0, 0.0))
    dir_ = [v / largo for v in enu_de(LAT_UIS, LON_UIS)]
    lado = [-dir_[1], dir_[0]]

    def enu(along, lateral):
        return (dir_[0] * along + lado[0] * lateral, dir_[1] * along + lado[1] * lateral)

    def a_lonlat(along, lateral):
        este, norte = enu(along, lateral)
        return (LAT_UTS + norte / 111320.0, LON_UTS + este / (111320.0 * math.cos(math.radians(LAT_UTS))))

    esquinas = [
        a_lonlat(ALONG_MIN, -LATERAL_MAX),
        a_lonlat(ALONG_MIN, LATERAL_MAX),
        a_lonlat(ALONG_MAX, -LATERAL_MAX),
        a_lonlat(ALONG_MAX, LATERAL_MAX),
    ]
    lat_min = min(c[0] for c in esquinas)
    lat_max = max(c[0] for c in esquinas)
    lon_min = min(c[1] for c in esquinas)
    lon_max = max(c[1] for c in esquinas)
    print(f"bbox lat {lat_min:.5f}..{lat_max:.5f}  lon {lon_min:.5f}..{lon_max:.5f}")

    x0, y0 = tile_xy(lat_max, lon_min, NIVEL)
    x1, y1 = tile_xy(lat_min, lon_max, NIVEL)
    print(f"teselas {x0}..{x1} x {y0}..{y1}  ({(x1 - x0 + 1) * (y1 - y0 + 1)} descargas)")

    ancho = (x1 - x0 + 1) * TILE
    alto = (y1 - y0 + 1) * TILE
    mosaico = Image.new("RGB", (ancho, alto))
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            ruta = f"/tmp/opencode/esri_{NIVEL}_{x}_{y}.jpg"
            descargar(f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{NIVEL}/{y}/{x}", ruta)
            mosaico.paste(Image.open(ruta).convert("RGB"), ((x - x0) * TILE, (y - y0) * TILE))
        print(f"  columna {x} lista")

    px0, py0 = px_xy(lat_max, lon_min, NIVEL)
    px1, py1 = px_xy(lat_min, lon_max, NIVEL)
    recorte = mosaico.crop((int(px0 - x0 * TILE), int(py0 - y0 * TILE), int(px1 - x0 * TILE), int(py1 - y0 * TILE)))
    ruta_salida = os.path.abspath(SALIDA)
    recorte.save(ruta_salida, quality=86, optimize=True)
    print(f"escrito {ruta_salida}  {recorte.size}  {os.path.getsize(ruta_salida) // 1024} KB")

    # Caja del recorte en lon/lat, para las UV en Rust.
    with open(os.path.join(os.path.dirname(SALIDA), "mapa-amplio-caja.json"), "w") as f:
        json.dump({"lon_min": lon_min, "lon_max": lon_max, "lat_min": lat_min, "lat_max": lat_max,
                   "nivel": NIVEL}, f, indent=2)


if __name__ == "__main__":
    import json  # noqa: E402
    main()

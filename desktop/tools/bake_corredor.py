#!/usr/bin/env python3
"""Hornea la ortofoto del corredor (franja) a máxima resolución.

Usa las teselas públicas de Esri World Imagery y recorta SOLO la franja del
corredor (±ancho), de modo que cada texel cubra ~0,6 m y el mapa no se vea
pixelado de cerca.

Salida: desktop/assets/corredor-satelital.jpg
Caja:  desktop/assets/corredor-caja.json  (lon_min/max, lat_min/max)
"""
import json
import math
import os
import time
import urllib.request
from PIL import Image

LON_UTS, LAT_UTS = -73.123524, 7.1051164
LON_UIS, LAT_UIS = -73.1198652, 7.1409311
NIVEL = 18
TILE = 256
SALIDA = os.path.join(os.path.dirname(__file__), "..", "assets", "corredor-satelital.jpg")
CAJA = os.path.join(os.path.dirname(__file__), "..", "assets", "corredor-caja.json")
ALONG_MIN, ALONG_MAX = -120.0, 4100.0
ANCHO = 340.0


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
    return (int((lon + 180.0) / 360.0 * n),
            int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n))


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


def main():
    largo = math.dist(enu_de(LAT_UIS, LON_UIS), (0.0, 0.0))
    dir_ = [v / largo for v in enu_de(LAT_UIS, LON_UIS)]
    lado = [-dir_[1], dir_[0]]

    def a_lonlat(along, lateral):
        este = dir_[0] * along + lado[0] * lateral
        norte = dir_[1] * along + lado[1] * lateral
        return (LAT_UTS + norte / 111320.0, LON_UTS + este / (111320.0 * math.cos(math.radians(LAT_UTS))))

    esquinas = [a_lonlat(ALONG_MIN, -ANCHO), a_lonlat(ALONG_MIN, ANCHO),
                a_lonlat(ALONG_MAX, -ANCHO), a_lonlat(ALONG_MAX, ANCHO)]
    lat_min = min(c[0] for c in esquinas)
    lat_max = max(c[0] for c in esquinas)
    lon_min = min(c[1] for c in esquinas)
    lon_max = max(c[1] for c in esquinas)

    x0, y0 = tile_xy(lat_max, lon_min, NIVEL)
    x1, y1 = tile_xy(lat_min, lon_max, NIVEL)
    print(f"bbox lat {lat_min:.6f}..{lat_max:.6f} lon {lon_min:.6f}..{lon_max:.6f}")
    print(f"teselas {x0}..{x1} x {y0}..{y1} ({(x1 - x0 + 1) * (y1 - y0 + 1)})")

    ancho = (x1 - x0 + 1) * TILE
    alto = (y1 - y0 + 1) * TILE
    mosaico = Image.new("RGB", (ancho, alto))
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            ruta = f"/tmp/opencode/esri18_{x}_{y}.jpg"
            descargar(f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{NIVEL}/{y}/{x}", ruta)
            mosaico.paste(Image.open(ruta).convert("RGB"), ((x - x0) * TILE, (y - y0) * TILE))
        print(f"  columna {x} lista", flush=True)

    px0, py0 = px_xy(lat_max, lon_min, NIVEL)
    px1, py1 = px_xy(lat_min, lon_max, NIVEL)
    recorte = mosaico.crop((int(px0 - x0 * TILE), int(py0 - y0 * TILE), int(px1 - x0 * TILE), int(py1 - y0 * TILE)))
    ruta_salida = os.path.abspath(SALIDA)
    recorte.save(ruta_salida, quality=88, optimize=True)
    print(f"escrito {ruta_salida} {recorte.size} {os.path.getsize(ruta_salida) // 1024} KB")
    with open(os.path.abspath(CAJA), "w") as f:
        json.dump({"lon_min": lon_min, "lon_max": lon_max, "lat_min": lat_min, "lat_max": lat_max,
                   "nivel": NIVEL}, f, indent=2)


if __name__ == "__main__":
    main()

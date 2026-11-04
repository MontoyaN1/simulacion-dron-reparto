#!/usr/bin/env python3
"""Hornea la malla de alturas del corredor con SRTM real (OpenTopoData).

Fuente pública: https://api.opentopodata.org/v1/srtm30m (sin clave, 1 req/s,
100 puntos por petición). Las alturas vienen en msnm y se guardan relativas
al ancla de la UTS (938.5 msnm).

Salida por defecto: desktop/assets/alturas-terreno.json
  {"v":3,"paso_m":25,"margen_along_m":200,"margen_lateral_m":450,
   "filas":N,"columnas":M,"datos":[[i,j,h_rel], ...]}

El eje `along` corre sobre la ruta UTS→UIS y `lateral` es perpendicular a ella.
Con --paso/--margen-* se hornea también el área amplia (municipios y veredas).
"""
import argparse
import json
import math
import os
import time
import urllib.parse
import urllib.request

ANCLA_MSNM = 938.5
LON_UTS, LAT_UTS = -73.123524, 7.1051164
LON_UIS, LAT_UIS = -73.1198652, 7.1409311
LOTE = 100
API = "https://api.opentopodata.org/v1/srtm30m"


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


def pedir(ubicaciones, intentos=4):
    espera = 1.4
    for intento in range(intentos):
        url = API + "?locations=" + urllib.parse.quote("|".join(ubicaciones))
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                datos = json.load(r)
            return [x.get("elevation") for x in datos["results"]]
        except Exception as e:  # red lenta o límite de tasa
            print(f"  reintento {intento + 1}/{intentos}: {e}")
            time.sleep(espera * (intento + 2))
    raise RuntimeError("OpenTopoData no respondió")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--paso", type=float, default=25.0)
    ap.add_argument("--margen-along", type=float, default=200.0)
    ap.add_argument("--margen-lateral", type=float, default=450.0)
    ap.add_argument("--salida", default="alturas-terreno.json")
    args = ap.parse_args()

    largo = math.dist(enu_de(LAT_UIS, LON_UIS), (0.0, 0.0))
    dir_ = [v / largo for v in enu_de(LAT_UIS, LON_UIS)]
    lado = [-dir_[1], dir_[0]]

    filas = int((largo + 2 * args.margen_along) / args.paso) + 1
    columnas = int((2 * args.margen_lateral) / args.paso) + 1
    total = filas * columnas

    puntos = []
    for i in range(filas):
        along = -args.margen_along + i * args.paso
        for j in range(columnas):
            lateral = -args.margen_lateral + j * args.paso
            este = dir_[0] * along + lado[0] * lateral
            norte = dir_[1] * along + lado[1] * lateral
            lat = LAT_UTS + norte / 111320.0
            lon = LON_UTS + este / (111320.0 * math.cos(math.radians(LAT_UTS)))
            puntos.append((i, j, f"{lat:.6f},{lon:.6f}"))

    alturas = []
    for inicio in range(0, total, LOTE):
        trozo = puntos[inicio:inicio + LOTE]
        alturas.extend(pedir([p[2] for p in trozo]))
        print(f"  {len(alturas)}/{total}", flush=True)

    datos = [[i, j, round((h if h is not None else ANCLA_MSNM) - ANCLA_MSNM, 2)]
             for (i, j, _), h in zip(puntos, alturas)]
    salida = {
        "v": 3,
        "paso_m": args.paso,
        "margen_along_m": args.margen_along,
        "margen_lateral_m": args.margen_lateral,
        "filas": filas,
        "columnas": columnas,
        "datos": datos,
    }
    ruta = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "assets", args.salida))
    with open(ruta, "w") as f:
        json.dump(salida, f, separators=(",", ":"))
    valores = [d[2] for d in datos]
    print(f"escrito {ruta}  filas={filas} columnas={columnas}  min={min(valores)} max={max(valores)}")


if __name__ == "__main__":
    main()

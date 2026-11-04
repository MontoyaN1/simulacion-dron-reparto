# Simulación del corredor UTS → UIS (cliente nativo Bevy)

Versión de escritorio, **autónoma**: no depende de `web/`, `shared/` ni `server/`.
Lee los datos horneados de `assets/` y calcula todo en Rust.

## Ejecutar

```bash
source ~/.cargo/env
cargo run --release      # la app
```

Requiere el directorio `assets/` junto al binario (en `cargo run` se resuelve
solo; para empaquetar, copiar `assets/` a la carpeta del ejecutable).

Con `CAPTURA=1` se guardan tres fotogramas del vuelo en `capturas/`
(presentación, despegue y crucero) para revisar la escena sin tocar nada.

## Rendimiento

La app va limitada por el refresco del monitor (aquí 47,96 Hz → 48 fps). No
hay cuello de botella de CPU ni de GPU: el terreno son dos mallas (franja de
25 m + fondo de 120 m) y los 718 edificios una sola malla con colisión en
`parry3d`.

## Qué hay dentro

| Pieza | Dónde | Origen |
|---|---|---|
| Ortofoto de la franja del corredor | `assets/corredor-satelital.jpg` | teselas Esri World Imagery z18 (`tools/bake_corredor.py`) |
| Ortofoto amplia (municipios y veredas) | `assets/mapa-amplio.jpg` | teselas Esri z16 (`tools/bake_mapa.py`) |
| Relieve fino del corredor (25 m) | `assets/alturas-terreno.json` | SRTM 30 m vía OpenTopoData (`tools/bake_terreno.py`) |
| Relieve amplio (±3 km, 50 m) | `assets/alturas-terreno-amplio.json` | ídem, área extendida |
| Edificios OSM (718) | `assets/edificios.geojson` | OpenStreetMap |
| Altura de suelo por edificio | `assets/alturas-edificios.json` | Cesium ion |
| Dron (fuselaje + rotores animados) | `assets/corredor-dron.glb` | generado para el proyecto |
| Icono de la ventana | `assets/icono.png` | generado con ImageMagick |

Las cajas geodésicas de las ortofotos (`*-caja.json`) las usan las UV del
terreno: si se re-hornea una imagen hay que volver a generarlas.

## Re-horneado

```bash
python3 tools/bake_terreno.py --paso 50 --margen-along 1500 --margen-lateral 3000 \
        --salida alturas-terreno-amplio.json
python3 tools/bake_mapa.py        # mosaico amplio + caja
python3 tools/bake_corredor.py    # franja z18 + caja
```

`bake_terreno.py` usa OpenTopoData (sin clave, 1 petición/s, 100 puntos por
petición). `bake_mapa.py` y `bake_corredor.py` usan las teselas públicas de
Esri World Imagery.

## Decisiones

- **Alturas**: todo el mundo 3D es relativo al ancla de la UTS (938.5 msnm).
- **Cámara**: persecución con suavizado exponencial y cinco encuadres
  candidatos; el raycast contra la malla de edificios (parry3d) descarta los
  que quedan pegados a una fachada.
- **Temblor**: el motor de vuelo avanza a paso fijo de 30 Hz y el render
  interpola entre el paso anterior y el actual, así que la imagen nunca da
  tirones aunque el cuadro no cuadre con los 30 Hz.
- **Iluminación**: sol direccional inclinado + relleno de ambiente. En Bevy
  0.16 el `AmbientLight` es un recurso (o componente de cámara), no una entidad.
- **HUD**: egui (panel superior con estado y controles, panel inferior con
  telemetría y progreso del corredor).

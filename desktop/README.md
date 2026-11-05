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
| Ortofoto de la franja del corredor | `assets/corredor-satelital.jpg` | teselas Esri World Imagery z19, 0,3 m/px (`tools/bake_corredor.py`) |
| Ortofoto media (±4 km, z17) | `assets/mapa-medio.jpg` | teselas Esri z17 (`tools/bake_mapa.py --nivel 17 ...`) |
| Ortofoto amplia (±8 km, z16) | `assets/mapa-amplio.jpg` | teselas Esri z16 (`tools/bake_mapa.py`) |
| Relieve fino del corredor (25 m) | `assets/alturas-terreno.json` | SRTM 30 m vía OpenTopoData (`tools/bake_terreno.py`) |
| Relieve amplio (±8 km, 50 m) | `assets/alturas-terreno-amplio.json` | ídem, área extendida |
| Edificios OSM (718) | `assets/edificios.geojson` | OpenStreetMap |
| Altura de suelo por edificio | `assets/alturas-edificios.json` | Cesium ion |
| Dron (fuselaje + carga + gimbal + rotores) | `assets/corredor-dron.glb` | generado para el proyecto |
| Capa de nubes del domo de cielo | `assets/nubes.png` | ruido de valor FBM (`tools/bake_nubes.py`) |
| Icono de la ventana | `assets/icono.png` | generado con ImageMagick |

Las cajas geodésicas de las ortofotos (`*-caja.json`) las usan las UV del
terreno: si se re-hornea una imagen hay que volver a generarlas.

## Re-horneado

```bash
python3 tools/bake_terreno.py --paso 50 --margen-along 8000 --margen-lateral 8000 \
        --salida alturas-terreno-amplio.json
python3 tools/bake_mapa.py --nivel 17 --along-min -4000 --along-max 5000 --lateral 4000 \
        --salida mapa-medio.jpg --caja mapa-medio-caja.json
python3 tools/bake_mapa.py        # mosaico amplio (z16, ±8 km) + caja
python3 tools/bake_corredor.py    # franja z19 + caja
python3 tools/bake_nubes.py       # nubes del cielo (offline)
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
- **Cielo**: `Atmosphere` (Bruneton) sobre la cámara con `hdr: true` (en 0.16
  el campo vive en la componente base `Camera`); el sol lo toma de la
  `DirectionalLight` y una cúpula de 20 km con `nubes.png` aporta las nubes.
- **Cámara**: persecución automática; arrastrar orbita libre alrededor del
  dron, la rueda hace zoom y `R` vuelve a seguirlo. Siempre con recorte por
  raycast contra los edificios.
- **Terreno por capas**: franja (25 m, z19) sobre media (60 m, z17, ±4 km)
  sobre amplia (100 m, z16, ±8 km); cada capa se hunde un poco para no pelear
  por profundidad, y `agl()` nunca baja del DEM amplio.
- **Ruta**: no es una regla: despegue, crucero con dos etapas de altitud
  (±8 m) y una curva S de ±20 m laterales, y descenso final. La ruta se pinta
  en escena (cinta de 1,8 m) y hay anillos pulsantes en UTS y UIS con haz
  vertical.
- **Dron con vida**: la rotación del fuselaje se calcula cada frame con las
  mismas convenciones que el cliente de referencia (euler XYZ sobre la base
  -π/2/π): rumbo real, cabeceo proporcional a la velocidad y al ascenso,
  alabeo en las curvas y vaiven de hover; los rotores giran a 4× el ciclo del
  glTF (~25 rad/s).
- **Texturas**: anisotropía 16 en el sampler por defecto; sin ella la
  ortofoto se ve en bloques al verla de canto.
- **Iluminación**: sol direccional inclinado + relleno de ambiente. En Bevy
  0.16 el `AmbientLight` es un recurso (o componente de cámara), no una entidad.
- **HUD**: egui (panel superior con estado, controles y velocidad de la
  simulación 1×–16×, panel inferior con telemetría y progreso del corredor).
  La rueda y el arrastre sobre cualquier zona del HUD no mueven la cámara
  (el panel lateral se desplaza sin hacer zoom).
- **Modelo matemático**: panel lateral colapsable (`M` o botón `MODELO`) que
  replica la sección de la versión web con los mismos datos en vivo:
  `Ruta real` (distancia, rumbo, escala académica, destino académico, edificios
  OSM que llegan a la franja de crucero, waypoints y desvío), `Matriz ENU`
  (R 3×3 con det, rango y ker) y `Parámetros importantes` (los 11 temas de
  álgebra del proyecto, con los valores de la telemetría). El módulo
  `src/matematica.rs` es el port clean-room de `liveAlgebra` de la referencia,
  con pruebas de paridad.

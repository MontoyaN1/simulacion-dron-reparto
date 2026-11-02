# Simulación de reparto con dron · UTS → UIS

Simulación 3D en tiempo real de un dron que transporta un paquete desde las Unidades
Tecnológicas de Santander (UTS) hasta la Universidad Industrial de Santander (UIS), en
Bucaramanga, con telemetría en vivo y el cálculo de los temas de Álgebra Lineal del
documento de la propuesta.

**Estado actual: fase 4 completada.** El repositorio trae el monorepo, el marco de coordenadas
reales UTS-UIS, la librería de álgebra lineal con pruebas, un motor de simulación determinista,
telemetría en vivo por WebSocket, una escena 3D con CesiumJS (terreno real 3D, edificios OSM
extruidos, dron glTF animado, estela y cuatro cámaras con transiciones suaves), la ciudad con
edificios de OpenStreetMap a partir de huellas y alturas reales, y ruta planificada con A*
sobre una rejilla de 10 m, y el panel de álgebra en vivo: los 11 temas del documento con sus
valores calculados en cada muestra y una tabla de datos a 1 Hz.

## Stack

| Capa | Tecnología |
| --- | --- |
| Motor y API | Node 22 · TypeScript · Fastify · `ws` |
| Cliente | Vite · React 19 · CesiumJS 1.146 |
| Matemática | `shared/` sin dependencias, probada con `node:test` |
| Historial | `node:sqlite` (fase 6, sin binarios nativos) |

## Estructura

```
shared/   vectores, matrices, geometría, coordenadas, ruta y planeación A*
server/   API HTTP, motor de simulación y carga de edificios
web/      interfaz React + Vite; la escena Cesium vive en web/src/cesium
scripts/  descarga y recorte de edificios desde Overpass
data/     buildings.geojson versionado (718 edificios del corredor)
docs/     modelo matemático y trazabilidad con el documento
```

## Requisitos

- Node.js 22 o superior (probado con 22.23.3)
- npm 10 o superior

## Comandos

```bash
npm install      # instala los tres workspaces
npm run dev      # API en :3100 y web en :5173 (copia antes los assets de Cesium)
npm run check        # typecheck + pruebas
npm test             # pruebas de la librería y del motor
npm run sim -w server # vuelo headless con tabla de telemetría
npm run fetch:buildings # actualiza data/buildings.geojson desde Overpass
npm run build        # build de producción del cliente
```

La API queda en `http://localhost:3100` y el cliente en `http://localhost:5173`. El puerto
de la API se puede cambiar con `PORT=otro npm run dev`. Los assets de Cesium (`Workers`,
`Assets`, `Widgets`, `ThirdParty`) se copian a `web/public/cesium` con
`web/scripts/copy-cesium.mjs` antes de `dev` y `build`; esa carpeta está ignorada por git.

La primera conexión abre el vuelo automáticamente. En la escena se puede pausar/reanudar,
reiniciar, cambiar la velocidad (1×, 2×, 4×) y alternar entre las cámaras Persecución, Órbita,
Cenital y Libre. La ciudad se carga con **Cesium World Terrain** (3D real, token público de
Cesium ion) sobre imagen satelital de Esri; los edificios se añaden como extrusiones opacas a
partir de las huellas y alturas reales de OSM (`data/buildings.geojson`). Si el terreno de ion
no está disponible, la escena cae a un plano local `z = 0` con las mismas huellas.

El marco ENU se ancla a la cota real de la UTS (`CITY_GROUND_HEIGHT = 938,5 m`). Para que el
dron no quede enterrado cuando el terreno sube hacia la UIS, la escena suma una malla de
elevación relativa muestreada con Open-Elevation (`web/src/cesium/terrain-grid.ts`). La
telemetría y el modelo académico siguen en un plano ENU con `z = 0` en el suelo; solo la
visualización aplica esa malla. El dron es un modelo **glTF procedural** propio
(`scripts/build-drone-model.mjs` → `web/public/models/dron-reparto.glb`) con rotores
animados, tren de aterrizaje, gimbal, paquete y luces navegacionales; la telemetría se
interpola a fotograma en `TelemetryBuffer` y la cámara usa un rig con transiciones suaves y
desplazamientos fijos por modo (`web/src/cesium/camera-rig.ts`). En crucero la altitud oscila
suavemente (±5 m) para que el vuelo muestre subidas y bajadas reales.

Endpoints disponibles:

- `GET /api/health`
- `GET /api/frame` — campus, límites de operación y marco de la ruta
- `GET /api/sim` — estado, telemetría y ruta actual
- `GET /api/route` — polilínea planificada, estadísticas de A* y número de edificios
- `GET /api/buildings` — GeoJSON de edificios del corredor
- `POST /api/sim/action` — `start`, `pause`, `resume`, `reset`, `speed`
- `WS /ws` — init, telemetría a 15 Hz, eventos y estado

## Coordenadas

| Punto | Latitud | Longitud | Fuente |
| --- | --- | --- | --- |
| UTS | 7.1051164 | -73.1235240 | OpenStreetMap `way/240015108` |
| UIS | 7.1409311 | -73.1198652 | OpenStreetMap `way/312645690` |

Distancia en línea recta: **3.981 km**, rumbo inicial **5.83°**. El marco local ENU se ancla
en la UTS (este, norte, arriba); el modelo académico del documento se obtiene con un escalado
uniforme de **890.3 m por unidad**, de modo que la norma del desplazamiento sigue siendo
`√20` sin deformar el rumbo. Ver [docs/modelo-matematico.md](docs/modelo-matematico.md).

## Hoja de ruta

| Fase | Alcance | Estado |
| --- | --- | --- |
| 0 | Monorepo, marco de coordenadas, librería matemática | completada |
| 1 | Motor determinista, telemetría y WebSocket | completada |
| 2 | Escena CesiumJS, dron procedural y cámaras | completada |
| 3 | Edificios OSM, rejilla y A* con altura | completada |
| 4 | Panel en vivo con los 11 temas y tabla de datos | completada |
| 5 | Decisiones por viento, zonas restringidas y batería | pendiente |
| 6 | SQLite, replay y exportación CSV | pendiente |
| 7 | Pulido, informe y guion de exposición | pendiente |

## Datos y atribución

Las coordenadas de los campus provienen de OpenStreetMap (© colaboradores de OpenStreetMap,
ODbL 1.0) y se verificaron con Nominatim. Las huellas de los edificios se descargan una sola vez
con `npm run fetch:buildings` desde Overpass, se recortan a 450 m de la recta UTS-UIS y se
versionan en `data/buildings.geojson` (718 edificios); así el motor y la escena funcionan sin
volver a consultar Overpass. El terreno 3D usa Cesium World Terrain mediante el token público
de Cesium ion y se atribuye en la esquina de la escena; la imagen base es Esri World Imagery y
el perfil de elevación se generó con Open-Elevation.

## Contexto académico

Proyecto de Álgebra Lineal — Tecnología en Desarrollo de Sistemas Informáticos, UTS,
Bucaramanga. Autores: Gustavo Adolfo Idarraga Gutierrez, Andrés Felipe Rangel Ochoa y
Juan Pablo Montoya Valencia.

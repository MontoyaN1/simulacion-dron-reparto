# Simulación de reparto con dron · UTS → UIS

Simulación 3D en tiempo real de un dron que transporta un paquete desde las Unidades
Tecnológicas de Santander (UTS) hasta la Universidad Industrial de Santander (UIS), en
Bucaramanga, con telemetría en vivo y el cálculo de los temas de Álgebra Lineal del
documento de la propuesta.

**Estado actual: fase 0 completada.** El repositorio ya trae el monorepo, el marco de
coordenadas reales UTS-UIS, la librería de álgebra lineal con pruebas y una página de
verificación que consume la API. La escena 3D con CesiumJS entra en la fase 2.

## Stack

| Capa | Tecnología |
| --- | --- |
| Motor y API | Node 22 · TypeScript · Fastify · `ws` (fase 1) |
| Cliente | Vite · React 19 · CesiumJS (fase 2) |
| Matemática | `shared/` sin dependencias, probada con `node:test` |
| Historial | `node:sqlite` (fase 6, sin binarios nativos) |

## Estructura

```
shared/   vectores, matrices, geometría, coordenadas y marco de la ruta
server/   API HTTP (y más adelante el motor de simulación por WebSocket)
web/      interfaz React + Vite
docs/     modelo matemático y trazabilidad con el documento
```

## Requisitos

- Node.js 22 o superior (probado con 22.23.3)
- npm 10 o superior

## Comandos

```bash
npm install      # instala los tres workspaces
npm run dev      # API en :3100 y web en :5173
npm run check    # typecheck + pruebas
npm test         # solo pruebas de la librería matemática
npm run build    # build de producción del cliente
```

La API queda en `http://localhost:3100` y el cliente en `http://localhost:5173`. El puerto
de la API se puede cambiar con `PORT=otro npm run dev`.

Endpoints disponibles en fase 0:

- `GET /api/health`
- `GET /api/frame` — campus, límites de operación y marco de la ruta

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
| 1 | Motor determinista, telemetría y WebSocket | pendiente |
| 2 | Escena CesiumJS, dron procedural y cámaras | pendiente |
| 3 | Edificios OSM, rejilla y A* con altura | pendiente |
| 4 | Panel en vivo con los 11 temas y tabla de datos | pendiente |
| 5 | Decisiones por viento, zonas restringidas y batería | pendiente |
| 6 | SQLite, replay y exportación CSV | pendiente |
| 7 | Pulido, informe y guion de exposición | pendiente |

## Datos y atribución

Las coordenadas de los campus provienen de OpenStreetMap (© colaboradores de OpenStreetMap,
ODbL 1.0) y se verificaron con Nominatim. En la fase 3 las huellas de edificios se descargan
una sola vez y se recortan al corredor de vuelo; el archivo resultante se versiona para que la
demo funcione sin conexión.

## Contexto académico

Proyecto de Álgebra Lineal — Tecnología en Desarrollo de Sistemas Informáticos, UTS,
Bucaramanga. Autores: Gustavo Adolfo Idarraga Gutierrez, Andrés Felipe Rangel Ochoa y
Juan Pablo Montoya Valencia.

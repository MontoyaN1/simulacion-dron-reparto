# Diseño: modelo y animaciones del dron (estilizado/cartoon)

Fecha: 2026-11-05 · Ronda pedida por el usuario: el modelo está "muy soso", la forma confunde, quiere animaciones más fluidas.

## Decisiones tomadas (brainstorming)

- **Enfoque A**: mejorar el generador procedural (`scripts/build-drone-model.mjs`) y afinar las animaciones en `desktop/src/escena.rs`. No se descarga ningún modelo (licencias, peso, coherencia con el anclaje del paquete y con Bevy).
- **Dolor principal**: "forma muy genérica" (caja + elipsoide, sin carácter).
- **Estilo**: estilizado/cartoon — silueta legible a distancia, formas redondeadas y exageradas, colores vivos con bloqueo fuerte.

## Restricciones inamovibles

- **Clean-room**: el generador vive en `scripts/` (fuera de `desktop/`). `node scripts/build-drone-model.mjs` escribe `web/public/models/dron-reparto.glb` y `desktop/assets/corredor-dron.glb` (misma generación, byte-identical; sin copia manual ni dependencia de compilación/runtime con la web).
- **48 fps en iGPU**: el dron son 3 mallas (`Estructura`, `Aspas`, `Estrobo`); los detalles nuevos son primitivos extra dentro de esas mallas, no draw calls nuevos. Edificios, terreno, cámara y HUD no se tocan.
- **Contrato de nodos (desktop)**: la escena glTF lleva nodos nombrados `Rotor1..4` y `Strobe` — el escritorio gira rotores y parpadea el estrobo por código (Bevy 0.16 no evalúa animaciones de glTF embebidas; ver ruling en Animaciones). La animación embebida "Rotores" se conserva como contrato de la web (Cesium la reproduce nativa).
- **Convenciones de actitud**: mismas que la web (euler XYZ, base −π/2 / π) para conservar paridad.

## Modelo (generador)

Convención del generador: x derecha, y adelante, z arriba; frente = +y.

1. **Cuerpo tipo pod**: casco elipsoide achatado + cúpula superior redondeada; franja acento azul en el lomo; panza en tono contrastado. Se va la caja cruda.
2. **Frente legible** (raíz de la confusión actual): visor frontal oscuro tipo "cara" con dos focos blancos emisivos; nariz redondeada; el cardán queda integrado bajo el visor.
3. **Brazos**: tubos carenados con tapering, cápsulas de motor redondeadas ("píldora") en color carcasa con anillo acento.
4. **Tren**: dos patines longitudinales con pies esféricos y leve splayed, color metal con punta acento.
5. **Batería trasera visible**: caja naranja arriba-atrás con correas y LED blanco — lee "dron de reparto" de un vistazo.
6. **Luces de navegación**: se conservan rojo (izquierda) / verde (derecha) en los motores; foco blanco trasero en nodo propio `Strobe` (parpadea por código).
7. **Aspas**: más grandes y gruesas, con punta en acento (primitivo extra dentro de la malla `Aspas`).
8. **Acotación**: span ≈ 0.68 m y altura de tren similares a las actuales; el anclaje inferior del paquete (z ≈ −0.2) se conserva. El `scale 3.0` del spawn no cambia.

Descartado: disco de blur semitransparente (aliasing + sorting de transparencia en iGPU; en cartoon las aspas con punta acento se leen mejor).

## Animaciones (`escena.rs`) — todas code-driven

**Ruling (2026-11-05, depuración sistemática)**: Bevy 0.16 no evalúa animaciones embebidas de glTF en escenas spawneadas — el loader inserta `AnimationPlayer` sin `AnimationGraphHandle` y `animate_targets` las ignora (traza: "graph was missing"; 4604 trazas en 27 s con el binario real). En la web sí funcionan (Cesium las reproduce nativa). Por eso el escritorio gira rotores y estrobo por código; la animación embebida se conserva en el GLB solo como contrato de la web.

Matemática extraída como funciones puras (testeables con TDD):

- `rpm_objetivo(fase, vel_h) -> f32`: 0 en tierra; en aire `min(14.0, 4.5 + 1.4·vel_h)` rev/s (paridad con `web/src/cesium/drone.ts`). `animar_rotores` gira los nodos `Rotor1..4` (query por `Name`, eje Z local — el loader no re-basis nodos, el padre hace la conversión) con rampa τ ≈ 0.4 s: spin-up en despegue, crucero rápido, spin-down al aterrizar; giro alternado por motor (configuración X).
- `estrobo_visible(phase) -> bool`: doble destello por segundo en el nodo `Strobe` (`parpadear_estrobo` alterna `Visibility`).
- `pitch_objetivo(vel_h, vel_z)`: igual que hoy (morro abajo con velocidad, ± en ascenso/descenso).
- `roll_objetivo(lat_accel) -> f32`: `clamp(lat_accel·0.12, ±0.32)` — aceleración lateral, no velocidad (más físico, paridad web).
- `wobble_amp(vel_h) -> f32`: `1 − min(1, vel_h/8)` — el vaivén es fenómeno de hover, no de crucero (hoy está encendido en todo el vuelo).
- Suavizado: se mantiene `1 − exp(−6·dt)`.

Descartado: paquete colgante con péndulo (en desktop no existe la entidad paquete; es web-only vía MissionDirector).

## Verificación

- **TDD Rust**: tests unitarios de las funciones puras (rpm=0 en tierra, monotonía con velocidad, techo 14, roll simétrico y acotado, wobble máx en hover y →0 a 8 m/s, patrón de destello del estrobo).
- **Regresión del defecto de rotores**: `rotores_giran_y_estrobo_parpadea_en_la_escena_real` carga el GLB real en una App mínima de Bevy y afirma que Rotor1..4 giran, el cuerpo no, y el estrobo alterna visibilidad (reproduce el síntoma "las hélices no giran").
- **TDD generador**: `scripts/check-drone-model.mjs` — parsea el GLB generado y afirma el contrato: 1 escena, 6 nodos (cuerpo + 4 rotores nombrados + Strobe), 3 mallas, animación "Rotores" con 4 canales a los nodos rotor (contrato web), estrobo con material Blanco, bbox coherente. La ronda del modelo cartoon extiende el chequeo con materiales (Acento en `Aspas`) y frente = +y (visor en y>0).
- **Visual**: corrida headless con capturas en despegue/crucero/hover/entrega; el usuario confirma.

## Riesgos

- Proporciones cartoon vs tono académico → capturas intermedias y ajuste antes de cerrar.
- Rotura silenciosa del contrato de animación (índice/nombres de nodo) → cubierta por `check-drone-model.mjs`.
- Rampa de régimen y parpadeo code-driven: estado por frame en `Local`, patrón ya probado en `animar_dron` y `animar_rotores`.

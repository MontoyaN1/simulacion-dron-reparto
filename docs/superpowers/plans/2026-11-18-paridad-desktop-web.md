# Paridad desktop → web: cámaras, controles y sentido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la web sea una copia del comportamiento de la app Bevy de escritorio: 3 cámaras (persecución por defecto, cine, libre automática al arrastrar), sin el tambaleo heredado de la versión legacy, FPS junto a los controles de cámara, sin el chip "Paquete cargado", velocidades 1×–16× y botón de sentido UTS↔UIS.

**Architecture:** El sistema de cámaras de web (RigCamara con offsets por rumbo/fase) se reemplaza por el port literal de desktop: candidatos fijos sobre los ejes del corredor + órbita libre con adopción de encuadre + cine orbital. El sentido se implementa servidor (la ruta vive allí): invertir la polilínea (como desktop, sin re-A*) + reconstruir el runtime.

**Tech Stack:** Three.js 0.187/WebGPU, React 19, Fastify + ws (server), vitest.

**Spec:** desktop/src/escena.rs (fuente de verdad: `Camara` L499, `offset_cine` L525, `entrada_camara` L533, `seguir_dron` L2186, `aplicar_sentido` L594, `perfil_ruta` L107) y desktop/src/main.rs (HUD).

## Análisis exhaustivo (desktop vs web)

| Área | Desktop (fuente de verdad) | Web hoy | Brecha |
|---|---|---|---|
| Cámaras | 3: persecución (default), cine (C), libre (auto al arrastrar o rueda) | 4 botones: chase/orbit/top/free; sin auto-switch, sin cine | Reemplazar por 3 modos |
| Tambaleo | Candidatos FIJOS sobre ejes del corredor (no rotan con el rumbo), 45–95 m del dron, histéresis de línea de visión, lerp −6·dt | Offsets rotan con `rumboActual` (oscila en la curva S y waypoints) + distancia variable <25 m AGL + agl escalonado → **tambaleo heredado del legacy** | Port de `seguir_dron` |
| Arrastre | Drag izq = órbita; **adopta el encuadre actual** como inicio (dist=clamp(h,12,900), elev=asin(rel.y/h), azim=atan2) | Solo rueda = zoom | Port de `entrada_camara` |
| Cine | `offset_cine`: órbita lenta (0.55+0.22·sin(0.18t)), dist 10+2·sin(0.11t), altura 4.25+0.75·sin(0.23t+1); lerp −4·dt; suelo+2 | No existe | Port |
| Libre | azim/elev/dist; lerp −10·dt; suelo+4; lookAt +1.5 | parcial | Port |
| Establecimiento | `t < 2.4 s` → `vista_amplia` (plano general del corredor) | plano propio 2.4 s | igual comportamiento, mantener |
| HUD cámara | Sin botones en persecución; chip CINE/LIBRE + "SEGUIR DRON" cuando no sigue | 4 botones siempre | Espejo desktop + botones compactos |
| FPS | En la barra superior | Chip flotante "THREE 48 fps" | **Al lado de los controles de cámara** |
| "Paquete cargado" | No existe | Chip HTML sobre el dron | **Quitar** |
| Velocidades | 1×–16× | 1×/2×/4× (server clamp 8) | Hasta 16× (server clamp 0.25..16) |
| Sentido | Botón + T: invierte la MISMA polilínea (sin re-A*), reconstruye vuelo, rumbo +180°, destino académico → (0,0), zonas intercambiadas | No existe | Server: route.reverse() + Runtime nuevo; protocol `sentido`; botón + tarjeta |
| Teclas | R seguir · C cine · T sentido · M panel | Ninguna | R/C (+T con sentido) |
| Progreso | Barra en barra inferior | Línea fina bajo el canvas | Ya paridad |

## Causa raíz del tambaleo (con evidencia)

`seguir_dron` de desktop (escena.rs:2264-2300) arma candidatos **constantes** respecto a los ejes del corredor (`atras = −dir`, `lateral = lado` — vectores fijos de la ruta recta) a 30–95 m del dron, elige el primero con línea de visión libre contra los edificios (acepta pared solo si queda lejos: toi ≥ 0.6·distancia) y suaviza posición con `lerp(elegido, 1−e^(−6·dt))`. La cámara web en cambio calcula su offset desde `rumboActual` (que oscila por la curva S y el control de velocidad en cada waypoint), acorta la distancia bajo 25 m AGL y suma la altura del terreno escalonado → el offset rota/salta cada frame → tambaleo. **El arreglo es sustituir la matemática, no amortiguar más.**

## Global Constraints

- Desktop es la fuente de verdad: los números (45/62, 60/45, 50/40, 30/78, 95; −6·dt; −10·dt; −4·dt; suelos +6/+4/+2; dist 12–900; elev 0.06–1.45) se copian verbatim.
- Los 11 temas del panel, la tarjeta puente y el mapa satelital NO se tocan.
- 45–60 FPS siguen siendo la puerta de aceptación.
- Español en la UI.

## Fases

### Fase 1 — Sistema de cámaras (arregla el tambaleo)
Port de `Camara`/`entrada_camara`/`seguir_dron`: 3 modos (seguir/cine/libre), R/C, drag→libre con adopción de encuadre, rueda=zoom→libre, candidatos desktop con raycast (regla 0.6), offset_cine, suelos +6/+4/+2. `RigCamara` se retira de escena.ts (los tests de encuadre por fase se adaptan al nuevo modo único). Establecimiento 2.4 s se mantiene.
- [ ] Implementar y verificar: sin tambaleo en crucero (captura), drag cambia a libre, C cine, R seguir.

### Fase 2 — HUD
- [ ] 3 botones compactos (Seguir/Cine/Libre) + **chip FPS a su derecha**; quitar chip "Paquete cargado" (SimulationStage).
- [ ] Atajos R/C activos; ayuda de teclas actualizada.

### Fase 3 — Velocidades 1×–16×
- [ ] Botones 1×/2×/4×/8×/16×; server clamp 0.25..16 (runtime.ts:134).

### Fase 4 — Sentido UTS↔UIS
- [ ] Protocol: `{ type: "sentido" }` (shared/sim/protocol.ts).
- [ ] Server index.ts: al recibirlo, `route = route.slice().reverse()` + `runtime = new SimulationRuntime(route)` + difundir; `/api/route` devuelve la ruta vigente.
- [ ] Client: botón "Sentido: UTS → UIS / UIS → UTS" + tecla T; tarjeta "Ruta real" voltea (rumbo +180°, destino académico (0,0), ĥ ya se voltea solo por telemetría).
- [ ] Verificar: vuelo UIS→UTS completo, tarjeta con rumbo 185.83°.

## Review Focus
- El tambaleo: si persiste tras Fase 1, la causa está en `displayDron` (interpolación buffer), no en la cámara.
- La adopción de encuadre al arrastrar no debe pegar la cámara dentro de un edificio (raycast de adopción).
- El sentido no debe romper la fase "Entregado" ni la batería (Runtime nuevo = estado fresco).

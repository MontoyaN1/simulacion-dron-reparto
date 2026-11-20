# Port de la escena 3D a Three.js + WebGPU sobre `web/` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar CesiumJS por una escena Three.js sobre `web/` (sin carpeta nueva) que reproduzca el aspecto y comportamiento de `desktop/` (terreno, 718 edificios, dron GLB con shader toon, ruta, cielo/nubes, sombras, Bloom, cámaras) a **45–60 FPS estables**, dejando la simulación 3D coherente con el documento PIERA.

**Architecture:** Trabajo sobre `web/` en cima de `web/src/escena-tres/` (port parcial ya existente: terreno horneado, edificios OSM fusionados en una malla, dron GLB, ruta, niebla, cámara con zoom). Se retira Cesium (flag `?motor=` y fallback), se sube el renderer a `WebGPURenderer` y se añade por capas el acabado visual que hoy solo vive en `desktop/` (toon, sombras, Bloom, cielo/nubes). El HUD (React) recoge los 11 temas del modelo matemático y la tarjeta puente doc↔real, ya verificados numéricamente contra el PDF.

**Tech Stack:** Three.js 0.187 (`WebGPURenderer`), React 19, Vite 6, TypeScript 5.7, `@dron/shared` (álgebra verificada). Sin CesiumJS al final del plan.

**Spec:** `docs/modelo-matematico.md` (trazabilidad fórmula→código) + `.analisis/doc_dron.txt` (texto del PDF PIERA, ya verificado numéricamente). Los valores exactos del documento están en **Global Constraints**.

## Global Constraints

- **Superficie de trabajo:** solo `web/`. No crear carpetas nuevas fuera de `web/`; no tocar `desktop/` salvo para comparar referencias visuales.
- **Rendimiento objetivo:** **45–60 FPS sostenidos** en la escena 3D, medidos en el medidor ya existente (`SimulationStage.tsx`, `fps` state) y verificables con `?debug`. Si una capa visual rompe el objetivo, se recorta esa capa, no el framerate.
- **Sin CesiumJS** al terminar el plan: sin import de `cesium`, sin `web/src/cesium/` en el grafo de render, sin flag `?motor=`, sin `copy-cesium.mjs` en prebuild. (Los helpers de datos de `web/src/cesium/` tipo `route-ground.ts`/`world.ts` pueden conservarse si `escena-tres` los consume como geometría, pero el motor de render Cesium desaparece.)
- **Renderer:** `THREE.WebGPURenderer` (no `WebGLRenderer`). Cae a WebGL solo si WebGPU no está disponible, con aviso en consola.
- **Coherencia con el PDF (valores ya verificados numéricamente, NO inventar):**
  - Destino académico `A = (2, 4, 0)` u · rumbo del modelo `N 26.57° E` (`atan2(2,4) = 26.565051°`).
  - Ruta del modelo `r⃗(t) = (2t, 4t, 1)`, cartesiano `x/2 = y/4`, `z = 1`.
  - Corredor de altura `z ∈ [0.8, 1.2]` u, holgura `0.2` u sobre techo `z = 0.8`.
  - Plano de la ruta `2x − y = 0`.
  - Zona sensible `Z = (3, 2, 0)` u, radio `1` u, paso de la ruta a `1.79` u (`proj` de `(3,2,0)` sobre `(2,4,0)` = `(1.4,2.8,0)`, perpendicular `‖(1.6,−0.8,0)‖ = 1.7889` u).
  - Viento `w⃗ = (−1, −1, 0)` m/s · `1.34` m/s en contra · deriva `0.45` m/s.
  - Plan de vuelo `1 + 2√5 + 1 ≈ 6.47` u · desplazamiento `2√5 ≈ 4.47` u.
  - Escala académica `890.3 m/u` · rumbo real `5.83°` · destino académico real `(0.454, 4.449, 0)`.
  - La app vuela la ruta **real** UTS→UIS (rumbo 5.83°, 17 waypoints, desvío 2.58 %, 3.98 km); el modelo del documento es una **reexpresión** escalada. La UI debe mostrar ambos y explicar el mapeo (nunca presentar 5.83° como si fuera N 26.57° E).
- **Idioma de la UI:** español (coherente con el resto del proyecto).
- **Verificación visual obligatoria:** cada tarea de escena se verifica con screenshot en el navegador (Playwright) a 45–60 FPS; no cerrar una tarea de render sin una captura que la respalde.

## Review Focus

- **Formatos/uso de texturas que WebGPU restringe más que WebGL** (el `Bloom` de Bevy falló en `Rg11b10Ufloat`): si un post-procesado o textura HDR no compila en WebGPU, debe degradar limpio (sin capa) en vez de romper el render. → Task 3 test de fallback.
- **Regresión de FPS por capa visual:** cada capa (sombras, Bloom, nubes) puede tirar de 60 a <45 en iGPU. Cada tarea mide FPS antes/después y se compromete el umbral 45. → test de FPS en Tasks 3–5.
- **Coherencia doc↔real mal presentada:** el bug clásico es que la UI muestre el rumbo real 5.83° sin el puente al modelo 26.57°, o que invente números del documento. Todo valor del documento sale de Global Constraints, nada de memoria. → Task 6 test de valores del documento.
- **Dron no visible / perdido en el encuadre** (hallazgo P1 en desktop): la cámara debe mantener el dron en cuadro en las 4 fases, con halo/etiqueta. → Task 4 test de encuadre.
- **Fallo de carga de assets** (GLB, ortofotos, geojson): si un asset no carga, la escena debe seguir funcionando con placeholder y avisar, no dejar pantalla negra. → Task 2 test de asset faltante.

---

### Task 1: Retirar CesiumJS y anclar `escena-tres` como motor único

**Files:**
- Modify: `web/src/components/SimulationStage.tsx:34,58-71` (flag `?motor=`, fallback a `DroneScene`)
- Modify: `web/package.json` (quitar `cesium`, `@types` huérfanos; quitar `copy-cesium.mjs` de predev/prebuild)
- Modify: `web/vite.config.ts` (quitar config de assets Cesium si la hay)
- Delete: `web/scripts/copy-cesium.mjs`, `web/src/cesium/scene.ts` (motor `DroneScene`), y todo el grafo de render Cesium
- Keep: `web/src/cesium/route-ground.ts`, `web/src/cesium/world.ts`, `web/src/cesium/ground-footprints.json`, `web/src/cesium/buildings.ts` si `escena-tres/ciudad.ts` los consume como geometría (moverlos a `web/src/escena-tres/` si se prefiere)
- Test: `web/src/components/SimulationStage.test.tsx` (nuevo; runner `vitest` que hay que añadir a devDeps si no está)

**Interfaces:**
- Consumes: `EscenaTres` de `web/src/escena-tres/escena.ts` (constructor `new EscenaTres(host, { corredor })`).
- Produces: `SimulationStage` renderiza siempre `EscenaTres`; sin parámetro `motor`; sin import de `DroneScene`/`cesium/scene`.

- [ ] **Step 1: Write the failing test** — en `SimulationStage.test.tsx`, montar `SimulationStage` con un host dummy y un `TelemetryBuffer` de prueba, y asertar que el `sceneRef` queda como `EscenaTres` y que `window.location.search` sin `motor` no cambia nada:

```ts
test("usa EscenaTres como motor único, sin flag motor", async () => {
  render(<SimulationStage {...propsDePrueba} />);
  await waitFor(() => expect(sceneRefActual()).toBeInstanceOf(EscenaTres));
});
```

- [ ] **Step 2: Run test to verify it fails** — `cd web && npx vitest run src/components/SimulationStage.test.tsx` → FAIL (hoy alterna por `?motor=` y cae a `DroneScene`).

- [ ] **Step 3: Implement** — en `SimulationStage.tsx` eliminar el flag `motor`, el import de `DroneScene`/`cesium/scene`, el `try/catch` que cae a Cesium y la unión de tipos `DroneScene | EscenaTres`; dejar `new EscenaTres(host, { corredor })` como única ruta. En `package.json` quitar `cesium` y el `predev`/`prebuild` de `copy-cesium.mjs`.

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run src/components/SimulationStage.test.tsx` → PASS. Y `npx tsc --noEmit` → sin errores de tipos de Cesium.

- [ ] **Step 5: Verificación visual** — `npm run dev`, abrir `http://localhost:5173`, screenshot con Playwright: la escena carga sin Cesium y el dron/terreno se ven. Guardar en `.analisis/web/01-motor-tres.png`.

- [ ] **Step 6: Commit** — `git add -A web && git commit -m "refactor(web): retira CesiumJS, escena-tres como motor único"`.

---

### Task 2: Robustez de assets y render placeholder

**Files:**
- Modify: `web/src/escena-tres/escena.ts:220-236` (carga GLB), `web/src/escena-tres/ciudad.ts:158-276` (fetch de edificios, terreno)
- Test: `web/src/escena-tres/escena.test.ts` (nuevo)

**Interfaces:**
- Consumes: `EscenaTres`, `construirCiudad(corredor)`.
- Produces: `EscenaTres` tolera GLB/geojson/ortofotos ausentes sin pantalla negra; expose `estado(): "ok" | "degradado"` para el HUD.

- [ ] **Step 1: Write the failing test** — asertar que con el GLB inexistente y el fetch de edificios fallando, `construirCiudad` devuelve una escena con terreno (placeholder si falta la imagen) y `estado() === "degradado"`, y que la app sigue corriendo:

```ts
test("asset ausente degrada sin romper la escena", async () => {
  const ciudad = await construirCiudad(corredorDePrueba); // fetch y GLB rotos
  expect(ciudad.terreno).toBeDefined();
  expect(estadoEscena()).toBe("degradado");
});
```

- [ ] **Step 2: Run test to verify it fails** — hoy un fetch/GLB fallido deja `undefined` y rompe o deja pantalla negra.

- [ ] **Step 3: Implement** — envolver cargas en `try/catch` con placeholder (`MeshBasicMaterial` gris para terreno, cubo para dron), `console.warn` claro, y flag `estado` que el HUD muestra.

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run web/src/escena-tres/escena.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add -A web && git commit -m "feat(web): escena tolera assets ausentes con placeholder y estado degradado"`.

---

### Task 3: `WebGPURenderer` + presupuesto de píxeles para 45–60 FPS

**Files:**
- Modify: `web/src/escena-tres/escena.ts:73-75` (hoy `WebGLRenderer` con `setPixelRatio(min(dpr,1))`)
- Modify: `web/src/components/SimulationStage.tsx:31,38` (medidor de FPS ya existente)
- Test: `web/src/escena-tres/renderer.test.ts` (nuevo)

**Interfaces:**
- Consumes: `EscenaTres`.
- Produces: `EscenaTres` usa `WebGPURenderer` (fallback WebGL con aviso); expose `fps(): number` y `backend(): "webgpu" | "webgl"`.

- [ ] **Step 1: Write the failing test** — asertar que `backend()` reporta el backend real y que `fps()` devuelve un número tras N frames; y que sin WebGPU cae a WebGL con aviso (no excepción):

```ts
test("WebGPU con fallback WebGL sin romper", async () => {
  const e = await crearEscenaSinWebGPU();
  expect(["webgpu", "webgl"]).toContain(e.backend());
  expect(e.fps()).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails** — hoy es `WebGLRenderer` fijo; `backend()`/`fps()` no existen.

- [ ] **Step 3: Implement** — `await THREE.WebGPURenderer.init()` (o `new WebGPURenderer()` con `await .init()`), `try/catch` que cae a `WebGLRenderer` con `console.warn`; mantener el tope de píxel ratio bajo (`min(dpr, 1.25)`) porque en iGPU el dpr alto costaba la mitad del rendimiento; exponer `fps()` promediado.

- [ ] **Step 4: Run test to verify it passes** — PASS. Y en navegador: `?debug`, FPS ≥ 45 en idle y en vuelo.

- [ ] **Step 5: Verificación visual + FPS** — screenshot `.analisis/web/03-webgpu.png` con el overlay de FPS ≥ 45.

- [ ] **Step 6: Commit** — `git add -A web && git commit -m "perf(web): WebGPURenderer con fallback WebGL y medidor de fps"`.

---

### Task 4: Cámaras por fase + dron siempre en cuadro (halo/etiqueta)

**Files:**
- Modify: `web/src/escena-tres/escena.ts` (rig de cámara, hoy posición fija + zoom por rueda)
- Test: `web/src/escena-tres/camara.test.ts` (nuevo)

**Interfaces:**
- Consumes: telemetría de fase (`Fase`: Despegue/Crucero/Descenso/Entregado) de `@dron/shared` o `web/src/mision/`.
- Produces: `EscenaTres.setFase(fase)` cambia el encuadre; el dron tiene halo + etiqueta "UTS-01" siempre visible.

- [ ] **Step 1: Write the failing test** — para cada fase, asertar que la cámara mantiene el dron dentro del frustum (proyecta la posición del dron y comprueba que cae en el rectángulo visible con margen):

```ts
test("el dron queda en cuadro en las 4 fases", () => {
  for (const f of ["Despegue","Crucero","Descenso","Entregado"] as const) {
    escena.setFase(f);
    expect(dronEnFrustum(escena)).toBe(true);
  }
});
```

- [ ] **Step 2: Run test to verify it fails** — hoy la cámara es genérica y en las capturas de desktop el dron quedaba fuera de cuadro.

- [ ] **Step 3: Implement** — rig con offsets por fase (persecución en despegue/crucero, plano bajo en ascenso, aproximación en descenso), transición suave (lerp), halo pulsante + `CSS2DRenderer`/sprite con "UTS-01".

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Verificación visual** — 4 screenshots (una por fase) `.analisis/web/04-camara-{fase}.png`, dron visible en las 4.

- [ ] **Step 6: Commit** — `git add -A web && git commit -m "feat(web): camaras por fase con dron siempre en cuadro y halo"`.

---

### Task 5: Acabado visual — sombras + shader toon + Bloom + cielo/nubes

**Files:**
- Modify: `web/src/escena-tres/escena.ts` (iluminación, post-procesado), `web/src/escena-tres/ciudad.ts` (materiales de edificios/terreno)
- Create: `web/src/escena-tres/toon.ts` (material toon; port del `toon.wgsl`/matcap de desktop)
- Test: `web/src/escena-tres/visual.test.ts` (nuevo)

**Interfaces:**
- Consumes: geometría de `construirCiudad`, dron GLB, `WebGPURenderer` de Task 3.
- Produces: sombras suaves, edificios/dron con shading toon, Bloom moderado en emisivos, cielo + capa de nubes; todo con guarda de FPS ≥ 45.

- [ ] **Step 1: Write the failing test** — asertar que el material del dron/edificios usa el shader toon (no `MeshStandard` por defecto), que las sombras están activas y que el composer de Bloom está montado; y que con FPS < 45 se puede desactivar Bloom sin romper:

```ts
test("toon + sombras + bloom con guarda de fps", () => {
  expect(materialToon(escena)).toBe(true);
  expect(escena.sombrasActivas()).toBe(true);
  expect(escena.bloomActivo()).toBe(true);
  escena.degradarBloom(); // ante fps < 45
  expect(escena.bloomActivo()).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails** — hoy `escena-tres` usa materiales básicos/estándar sin toon, sin sombras ni Bloom (medición: 2 features de iluminación vs 49 en desktop).

- [ ] **Step 3: Implement** — `DirectionalLight` con `shadowMap`, material toon (port del matcap/toon de `desktop/assets/toon.wgsl` a un `ShaderMaterial`/`MeshToonMaterial` de Three), `EffectComposer` + `BloomPass` con umbral alto (solo emisivos), domo de nubes + gradiente de cielo; **guarda de FPS**: si el promedio baja de 45, desactivar Bloom automáticamente y bajar resolución de sombras.

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Verificación visual + FPS** — screenshot `.analisis/web/05-visual.png` con FPS ≥ 45 **con el acabado activo** (si no llega, la guarda degrada y el screenshot lo muestra).

- [ ] **Step 6: Commit** — `git add -A web && git commit -m "feat(web): sombras, shader toon, bloom y cielo con guarda de fps 45+"`.

---

### Task 6: HUD de coherencia doc↔real (11 temas + tarjeta puente)

**Files:**
- Modify: `web/src/components/DetailsSection.tsx:399` (sección "Parámetros importantes"), `web/src/components/TelemetryPanel.tsx`
- Create: `web/src/components/ModeloDocumentoCard.tsx` (tarjeta puente)
- Test: `web/src/components/coherencia-doc.test.ts` (nuevo)

**Interfaces:**
- Consumes: valores de Global Constraints (ya verificados contra el PDF) y `algebra_en_vivo`/`datos_ruta` de `@dron/shared`.
- Produces: panel que muestra los 11 temas con valores vivos y la tarjeta puente doc↔real.

- [ ] **Step 1: Write the failing test** — asertar que la tarjeta puente muestra exactamente los valores del documento (nada inventado) y que los 11 temas están presentes:

```ts
test("la tarjeta puente refleja los valores exactos del PDF", () => {
  render(<ModeloDocumentoCard rumboReal={5.8263} />);
  expect(screen.getByText("N 26.57° E")).toBeInTheDocument();
  expect(screen.getByText(/2x − y = 0/)).toBeInTheDocument();
  expect(screen.getByText(/1 \+ 2√5 \+ 1 ≈ 6.47 u/)).toBeInTheDocument();
  expect(screen.getByText(/5.83/)).toBeInTheDocument(); // puente al rumbo real
});
```

- [ ] **Step 2: Run test to verify it fails** — hoy `DetailsSection` tiene "Parámetros importantes" pero sin la tarjeta puente ni todos los valores del documento.

- [ ] **Step 3: Implement** — `ModeloDocumentoCard` con las filas de Global Constraints (destino (2,4,0), N 26.57° E, corredor 0.8–1.2, plano 2x−y=0, zona Z (3,2,0) r=1 paso 1.79 u, viento (−1,−1,0) 1.34 en contra, plan 6.47 u) + nota de mapeo real↔modelo (escala 890.3 m/u, rumbo real 5.83°). Los 11 temas en `DetailsSection` con valores vivos.

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run web/src/components/coherencia-doc.test.ts` → PASS.

- [ ] **Step 5: Verificación visual** — screenshot `.analisis/web/06-hud-doc.png` con el panel completo (11 temas visibles, tarjeta puente legible).

- [ ] **Step 6: Commit** — `git add -A web && git commit -m "feat(web): tarjeta puente doc-real y 11 temas del modelo matematico"`.

---

### Task 7: Medición final de FPS y capturas por fase (gate de aceptación)

**Files:**
- Modify: `web/src/components/SimulationStage.tsx` (medidor de FPS, ya existe)
- Test: manual + Playwright

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: evidencia de 45–60 FPS y las 4 capturas por fase, para el informe/doc.

- [ ] **Step 1: Run FPS measurement** — `npm run dev`, `?debug`, vuelo completo a 1×: registrar FPS idle, en despegue, en crucero (sobre la ciudad densa, el peor caso) y en descenso. Objetivo: **≥ 45 en todos, ideal 60**. Anotar números.

- [ ] **Step 2: Si algún escenario < 45 FPS** — volver a Task 5 y recortar la capa culpable (Bloom → resolución de sombras → nubes) hasta cumplir. No tocar el framerate objetivo.

- [ ] **Step 3: Capturas por fase** — Playwright: 4 screenshots (`01-presentacion`, `02-despegue`, `03-crucero`, `04-uis`) disparadas por transición de fase real (como el fix de desktop), guardadas en `.analisis/web/`.

- [ ] **Step 4: Verificación de coherencia doc** — revisar las capturas: título sin tofu, chip de progreso sin cortes, tarjeta puente visible y correcta, 11 temas legibles.

- [ ] **Step 5: Commit** — `git add -A web .analisis && git commit -m "test(web): gate de aceptacion 45-60 fps y capturas por fase"`.

---

## Auto-revisión (self-review)

1. **Cobertura del spec:** Task 1-2 = retirar Cesium + robustez; Task 3 = WebGPU + 45-60 FPS (el objetivo duro del usuario); Task 4-5 = acabado visual de desktop (cámaras, toon, sombras, Bloom, cielo); Task 6 = coherencia con el PDF (11 temas + puente); Task 7 = gate de aceptación con medición de FPS y capturas. Cubierto.
2. **Granularidad:** cada tarea termina en un deliverable testeable + screenshot. OK.
3. **Consistencia de tipos:** `EscenaTres` (Task 1) → `backend()/fps()/estado()` (Task 2-3) → `setFase()` (Task 4) → `sombrasActivas()/bloomActivo()/degradarBloom()` (Task 5). Nombres consistentes; el executor debe mantenerlos.
4. **Review Focus:** formato de texturas WebGPU (Task 3), regresión de FPS por capa (Tasks 3-5 con guarda), coherencia doc↔real (Task 6), dron en cuadro (Task 4), asset faltante (Task 2). Cada uno tiene test. OK.
5. **Proporción:** el plan es de alcance medido (7 tareas); no transcribe el código, deja los cuerpos al executor con firmas y tests. OK.

**Punto que el executor debe respetar y el plan no puede decidir por él:** el port exacto del shader toon de `desktop/assets/toon.wgsl` a Three (matcap vs `MeshToonMaterial`) es la decisión visual de mayor riesgo; si en Task 5 el FPS no llega a 45 con toon+Bloom, **degradar Bloom primero, toon después** (el toon es la identidad visual, el Bloom es prescindible).

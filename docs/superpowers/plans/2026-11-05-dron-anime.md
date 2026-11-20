# Dron profesional anime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mejorar el dron existente con geometría profesional, cel-shading, reflejos metálicos estilizados, estelas ligeras de rotor y una cámara cinematográfica opcional sin romper la simulación ni las cámaras actuales.

**Architecture:** Se hornea un GLB procedural compatible con web y desktop. El desktop sustituye los materiales del dron por un `Material` WGSL toon, anima rotores/estelas por código y añade una rama `C` a la cámara existente; HDR/Bloom y gradación de color unifican el acabado con la ciudad actual.

**Tech Stack:** Rust, Bevy 0.16, WGSL, JavaScript Node sin dependencias, glTF 2.0/GLB.

**Spec:** `docs/superpowers/specs/2026-11-05-dron-modelo-design.md`

## Global Constraints

- Objetivo de rendimiento: 48 fps en Intel iGPU; sin TAA, SSAO ni motion blur temporal.
- No añadir dependencias Rust, JavaScript o Python.
- Mantener `DronReparto`, `Rotor1..4`, `Strobe`, la animación web `Rotores`, la escala `3.0`, la ruta y las cámaras libre/persecución.
- Las estelas nacen invisibles en el GLB para no alterar la web.
- No ejecutar `git add`, `git commit` ni `git push`; tampoco revertir cambios ajenos ya presentes en el árbol.

## Review Focus

- Shader inválido o dron negro: Task 2 exige compilación en el binario real y captura, además de los tests de conversión.
- Estelas visibles en tierra o como disco opaco: Task 3 fija `rpm < 1.5 ⇒ invisible` y alfa máximo `0.20`.
- Cámara `C` atravesando edificios o cambiando las vistas previas: Task 4 reutiliza `golpe_de`, altura de suelo y prueba que `Camara::default().cine == false`.
- Regresión del contrato web: Task 1 exige la animación `Rotores` intacta y alfa inicial 0 de `Estela`.
- Pérdida de fps por Bloom/geometría: Task 5 mide la corrida release completa y exige 0 errores y promedio cercano a 48 fps.

---

### Task 1: Modelo procedural profesional y contrato GLB

**Files:**
- Modify: `scripts/build-drone-model.mjs`
- Modify: `scripts/check-drone-model.mjs`
- Generate: `web/public/models/dron-reparto.glb`, `desktop/assets/corredor-dron.glb`

**Interfaces:**
- Produces: nodos `DronReparto`, `Rotor1..4`, `Strobe`, `Estela1..4`; mallas `Estructura`, `Aspas`, `Estrobo`, `Estela`; material transparente `Estela` con `COLOR_0`; animación `Rotores` en los nodos 1–4.
- Consumes: ninguno.

- [ ] **Step 1: Endurecer primero el checker y verlo fallar**

Actualizar `check-drone-model.mjs` para exigir 10 nodos, 4 mallas, `Estela1..4`, `Estela` en modo BLEND con alfa 0 y colores por vértice, animación `Rotores` intacta, materiales `Cian`/`Estela`, emisivos HDR y una densidad mínima de vértices acorde con el modelo refinado.

Run: `node scripts/check-drone-model.mjs desktop/assets/corredor-dron.glb`
Expected: FAIL por faltar `Estela1..4` y la malla `Estela`.

- [ ] **Step 2: Implementar las primitivas y el modelo refinado**

Añadir `superellipsoid`, `taperedCylinder`, `torusZ`, `pala` y `estelaGeometry`; aumentar segmentación, reemplazar la caja del fuselaje, construir paneles/visor/brazos/motores/tren/batería y aspas taperizadas con punta cyan. Añadir `Geometry.colors` y escritura de `COLOR_0` solo cuando haya un color por vértice.

- [ ] **Step 3: Regenerar y verificar ambos GLB**

Run:
```bash
node scripts/build-drone-model.mjs
node scripts/check-drone-model.mjs
node scripts/check-drone-model.mjs desktop/assets/corredor-dron.glb
md5sum web/public/models/dron-reparto.glb desktop/assets/corredor-dron.glb
```
Expected: ambos checks OK y MD5 idénticos.

### Task 2: Material toon con reflejo matcap

**Files:**
- Create: `desktop/assets/toon.wgsl`
- Modify: `desktop/src/escena.rs`

**Interfaces:**
- Consumes: `GltfMaterialName`, `StandardMaterial` y los GLB de Task 1.
- Produces: `ToonMaterial`, `ToonUniform`, `MatcapDron(Handle<Image>)`, `textura_matcap() -> Image`, `convertir_materiales_dron`; plugin `MaterialPlugin::<ToonMaterial>`.

- [ ] **Step 1: Escribir tests rojos de matcap y conversión**

Añadir tests que comprueben: matcap 128×128 RGBA con píxeles opacos y rango de iluminación; un material `Metal` se convierte a `ToonMaterial` conservando color/metallic/roughness/emisivo; `Estela` permanece `StandardMaterial`.

Run: `cargo test materiales_toon -- --nocapture`
Expected: FAIL porque los tipos/funciones no existen.

- [ ] **Step 2: Implementar el material y la conversión**

Definir:
```rust
struct ToonUniform { color: Vec4, emissive: Vec4, params: Vec4 }
struct ToonMaterial { uniform: ToonUniform, matcap: Handle<Image>, alpha_mode: AlphaMode }
struct MatcapDron(Handle<Image>);
```
`params = (metallic, perceptual_roughness, unlit, 0)`. Convertir por `GltfMaterialName`, excluir `Estela`, retirar el componente estándar e insertar `MeshMaterial3d<ToonMaterial>`.

- [ ] **Step 3: Implementar `toon.wgsl`**

Usar el vertex shader estándar de `Material`; en fragmento importar `forward_io::VertexOutput` y `mesh_view_bindings::{view, lights}`. Aplicar tres bandas antialias de `N·L`, ambiente frío, matcap en espacio de vista, rim cyan y emisivo. Devolver alfa del material.

- [ ] **Step 4: Ejecutar tests y build**

Run: `cargo test && cargo build --release`
Expected: todos los tests verdes y compilación sin errores. La compilación WGSL se valida de nuevo en Task 5 con el binario real.

### Task 3: Estelas code-driven ligadas al régimen

**Files:**
- Modify: `desktop/src/escena.rs`

**Interfaces:**
- Consumes: `Estela1..4` y `StandardMaterial Estela` de Tasks 1–2; `rpm` y ángulos de `animar_rotores`.
- Produces: `estela_visible(rpm: f32) -> bool`, `estela_alfa(rpm: f32) -> f32`.

- [ ] **Step 1: Añadir tests rojos**

Verificar `estela_visible(0) == false`, umbral `1.5`, alfa 0 en tierra, monotonía durante spin-up y máximo `0.20`. Ampliar la integración real para encontrar `Estela1..4`, afirmar que giran con sus rotores y que aparecen al superar el umbral.

Run: `cargo test pruebas_rotores -- --nocapture`
Expected: FAIL por funciones/nodos aún no integrados.

- [ ] **Step 2: Integrar estelas en `animar_rotores`**

Aplicar a cada `EstelaN` el mismo ángulo que `RotorN`, alternar `Visibility` con `estela_visible` y actualizar el alfa del `StandardMaterial` con `estela_alfa`. No crear discos opacos ni cambiar el régimen existente.

- [ ] **Step 3: Ejecutar la suite**

Run: `cargo test`
Expected: todos los tests verdes, incluida la escena GLB real.

### Task 4: Cámara cinematográfica opcional con `C`

**Files:**
- Modify: `desktop/src/escena.rs`
- Modify: `desktop/src/main.rs`

**Interfaces:**
- Consumes: `golpe_de`, `Corredor::agl`, `corredor.dir`, `corredor.lado`, posición interpolada del dron.
- Produces: `Camara.cine: bool`, `offset_cine(t: f32, adelante: Vec3, lateral: Vec3) -> Vec3`; tecla `C` y hint actualizado.

- [ ] **Step 1: Añadir tests rojos del encuadre**

Comprobar `Camara::default().cine == false`; para `t = 0, 4, 8, 12`, distancia horizontal entre 8 y 12 m, altura entre 3.5 y 5 m y encuadres distintos; vectores finitos en todos los casos.

Run: `cargo test camara_cine -- --nocapture`
Expected: FAIL por falta de `cine`/`offset_cine`.

- [ ] **Step 2: Implementar entrada y rama cinematográfica**

`C` alterna cine/persecución; `R` restaura persecución; ratón/rueda salen a libre. Calcular frontal three-quarter con órbita ±0.22 rad, distancia 8–12 m y altura 3.5–5 m; suavizar posición y aplicar raycast/suelo antes de `look_at`. No modificar FOV ni las ramas previas.

- [ ] **Step 3: Actualizar hint y ejecutar tests**

En `main.rs`, añadir `C: cine` al hint existente sin moverlo de zona.

Run: `cargo test`
Expected: todos los tests verdes.

### Task 5: Iluminación anime, documentación y verificación real

**Files:**
- Modify: `desktop/src/escena.rs`
- Modify: `desktop/README.md`
- Modify: `.superpowers/sdd/2026-11-05-dron-modelo/progress.md`

**Interfaces:**
- Consumes: todos los anteriores.
- Produces: Bloom moderado, `ColorGrading`, verificación visual y de rendimiento.

- [ ] **Step 1: Aplicar gradación e iluminación**

Añadir Bloom con threshold `0.9`, softness `0.25`, intensity `0.10` y modo Additive; `post_saturation = 1.12`, contraste de medios `1.05`, sol cálido y ambiente frío. Conservar ortofoto, edificios, nubes y atmósfera.

- [ ] **Step 2: Verificar contrato, tests y release**

Run:
```bash
node scripts/check-drone-model.mjs desktop/assets/corredor-dron.glb
cd desktop && cargo test && cargo build --release
```
Expected: contrato OK, todos los tests verdes, build sin errores.

- [ ] **Step 3: Ejecutar corrida real con capturas**

Matar solo por PID exacto cualquier instancia previa. Desde `desktop/`, ejecutar release con `BEVY_ASSET_ROOT=$PWD SIM_VEL=4 CAPTURA=1 FPS=1` y log en `/tmp/opencode/`. Repetir con activación de `C` por XTest para capturar el encuadre cinematográfico.

Expected: shader compilado, 0 panics/errores, capturas completas, régimen de rotores en log y promedio cercano a 48 fps. Leer las capturas para comprobar paneles, bandas, reflejos, estelas y encuadre.

- [ ] **Step 4: Documentar y revisar el diff sin Git mutations**

Actualizar README con el modelo toon, estelas y tecla `C`; registrar resultados en el ledger. Revisar `git diff` solo como lectura y comprobar que no haya cambios fuera del alcance. No ejecutar `git add`, `git commit` ni `git push`.

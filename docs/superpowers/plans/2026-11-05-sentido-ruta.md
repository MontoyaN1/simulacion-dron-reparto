# Recorrido reversible (sentido UTS↔UIS) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botón en la barra superior que voltea la ruta UTS→UIS a UIS→UTS en caliente, reiniciando el vuelo desde el nuevo origen, con cinta, anillos, rumbo y panel matemático coherentes.

**Architecture:** La ruta sigue siendo una polilínea de waypoints; se parameteriza su generación con un booleano `invertida` (mismos puntos de etapa, orden inverso). Un recurso `Sentido` + un sistema `aplicar_sentido` reconstruyen el `Vuelo` y re-insertan malla de la cinta y materiales de los anillos. El panel matemático deriva lo direccional de los extremos de la ruta.

**Tech Stack:** Rust, Bevy 0.16.1, egui (bevy_egui 0.35), parry3d (intocable).

**Spec:** `docs/superpowers/specs/2026-11-05-sentido-ruta-design.md`

## Global Constraints
- Clean-room: ningún cambio fuera de `desktop/` (ni `web/`, ni `shared/`, ni `server/`).
- Bevy 0.16.1: `Window` componente con `title: String`; insert sobre entidad reemplaza componente; `Local<Option<T>>` para detectar cambios.
- No tocar la malla fusionada de edificios (1 draw call) ni el presupuesto de 48 fps.
- Antes de cada corrida: matar instancias previas (`pgrep -f 'dron-reparto-deskto[p]'`, kill -9 por PID si hace falta; nunca pkill con la ruta literal).
- Verificación headless desde `desktop/`: `BEVY_ASSET_ROOT=$PWD SIM_VEL=4 CAPTURA=1 FPS=1 ./target/release/dron-reparto-desktop`, ~78 s, luego `kill -9`.

## Review Focus
1. Toggle en pleno vuelo o con entrega completada → reinicio limpio en el nuevo origen (fase Inactivo, dron en el suelo del nuevo origen).
2. Doble toggle rápido → aplica el último estado, sin panic por query vacía ni materiales huérfanos.
3. Rumbo del panel ≈ volteado 180° y destino académico ≈ (0,0) en sentido inverso.
4. Cinta y anillos actualizados sin entidades duplicadas (insert reemplaza).
5. Marcas de captura por tiempo de simulación siguen disparando en ambos sentidos.

---

### Task 1: `Sentido` + `perfil_ruta` parameterizado (escena.rs)

**Files:**
- Modify: `desktop/src/escena.rs` (`perfil_ruta` ~línea 71; plugin build ~línea 40)
- Test: `desktop/src/escena.rs` (módulo `pruebas_edificios` o nuevo `pruebas_ruta`)

**Interfaces:**
- Produce: `pub enum Sentido { UtsAUis, UisAuts }` con `Default = UtsAUis`, `fn invertir(self) -> Sentido`, `fn nombre(self) -> &'static str` ("UTS → UIS" / "UIS → UTS").
- Produce: `fn perfil_ruta(corredor: &Corredor, invertida: bool) -> Vec<[f64; 3]>`.
- Consume: `Corredor { largo, desplazamiento, punto(along, lateral), agl(e, n) }`, `ALTITUD_CRUCERO`.

- [ ] **Step 1: Test fallido de extremos**

```rust
#[test]
fn perfil_ruta_voltea_extremos_y_etapas() {
    let c = Corredor::cargar();
    let f = perfil_ruta(&c, false);
    let i = perfil_ruta(&c, true);
    // extremos: origen/destino intercambiados (suelo de cada campus)
    assert!((f[0][0] - 0.0).abs() < 1e-6 && (f[0][1] - 0.0).abs() < 1e-6);
    assert!((i[0][0] - c.desplazamiento[0]).abs() < 1e-6
        && (i[0][1] - c.desplazamiento[1]).abs() < 1e-6);
    assert!((i.last().unwrap()[0] - 0.0).abs() < 1e-6
        && (i.last().unwrap()[1] - 0.0).abs() < 1e-6);
    // las etapas son los mismos puntos geométricos, en orden inverso
    let n = f.len();
    for k in 1..n - 1 {
        for axis in 0..3 {
            assert!((f[k][axis] - i[n - 1 - k][axis]).abs() < 1e-6,
                "etapa {k} eje {axis}: {} vs {}", f[k][axis], i[n - 1 - k][axis]);
        }
    }
    // el perfil vertical se voltea: el segundo punto es el despegue vertical
    assert!(f[1][2] - f[0][2] > 40.0);
    assert!(i[1][2] - i[0][2] > 40.0);
}
```

- [ ] **Step 2: Ejecutar y ver fallar** — `cargo test perfil_ruta` → FAIL (`perfil_ruta` espera 1 argumento).
- [ ] **Step 3: Implementar** — `perfil_ruta(corredor, invertida)`: origen/destino según `invertida`; `along = largo * (si invertida { 1 - k/etapas } else { k/etapas })`; lateral y alta con las mismas fórmulas de `along` absoluto (la S y las etapas ±8 m son geométricamente idénticas); push `[origen…, origen+ALTITUD_CRUCERO]`, etapas, `[destino, suelo_destino]`. Añadir `Sentido` con `invertir`/`nombre`. Registrar `insert_resource(Sentido::default())` en el plugin.
- [ ] **Step 4: `cargo test`** → PASS (7+ tests).
- [ ] **Step 5: Commit** — `git add desktop/src/escena.rs && git commit -m "bevy: perfil_ruta con sentido parametrizado"`

### Task 2: Sistema `aplicar_sentido` — reconstrucción en caliente (escena.rs)

**Files:**
- Modify: `desktop/src/escena.rs` (`construir_escena` ~570-610: cinta y anillos; plugin build)

**Interfaces:**
- Produce: `#[derive(Component)] struct CintaRuta;` (marcador en el spawn de la cinta).
- Produce: `#[derive(Resource, Default)] struct Zonas { pub uts: Option<Entity>, pub uis: Option<Entity> }` (llenado en `construir_escena` tras los dos `spawn_zona`).
- Produce: `fn aplicar_sentido(mut visto: Local<Option<Sentido>>, sentido: Res<Sentido>, mut vuelo: ResMut<Vuelo>, corredor: Res<Corredor>, mut mallas: ResMut<Assets<Mesh>>, mut materiales: ResMut<Assets<StandardMaterial>>, mut commands: Commands, cintas: Query<Entity, With<CintaRuta>>, zonas: Res<Zonas>, mut ventanas: Query<&mut Window>)`.
- Consume: `Vuelo::nuevo(ruta)` (privada, mismo módulo), `cinta_ruta(&[[f64;3]])`, `Sentido::invertir` implícito vía recurso.

- [ ] **Step 1: Marcadores** — añadir `CintaRuta` al spawn de la cinta (~597) y guardar las dos entidades de `spawn_zona` en el recurso `Zonas` (`commands.insert_resource` al final de `construir_escena`). Colores: origen azul `srgb(0.35,0.83,1.0)`, llegada verde `srgb(0.5,0.9,0.6)` — intercambiar al voltear.
- [ ] **Step 2: Sistema** — si `visto` difiere de `sentido.0`: `let ruta = perfil_ruta(&corredor, sentido.0 == Sentido::UisAuts); *vuelo = Vuelo::nuevo(ruta.clone());` re-insertar `Mesh3d(mallas.add(cinta_ruta(&ruta)))` en la entidad de `cintas.single()`, re-insertar materiales en `zonas.uts/uis` según sentido, y poner `ventanas.single().title = format!("Dron {} · Estación de control", sentido.0.nombre())`. Actualizar `visto`.
- [ ] **Step 3: Registro** — `aplicar_sentido` en `Update` (antes de `seguir_dron`), `init_resource::<Zonas>()` en el plugin.
- [ ] **Step 4: `cargo check`** sin warnings nuevos (los `dead_code` existentes no cuentan).
- [ ] **Step 5: Commit** — `git commit -am "bevy: sistema aplicar_sentido reconstruye vuelo, cinta y anillos"`

### Task 3: HUD — botón, etiquetas y panel direccional (main.rs)

**Files:**
- Modify: `desktop/src/main.rs` (`datos_ruta` 138-181, `hud` 183-286, título 51)

**Interfaces:**
- Produce: `fn rumbo_horizontal(a: &[f64; 3], b: &[f64; 3]) -> f64` (atan2(dx, dn) en grados, 0..360).
- Modify: `datos_ruta` calcula `rumbo`, `destino`, `dir_h` y `distancia` desde los extremos de `vuelo.ruta`; caché `Local<Option<([f64;3],[f64;3], DatosRuta)>>` claveada por extremos.
- Consume: `escena::Sentido` (pub), `boton(ui, label, activo)`.

- [ ] **Step 1: Test fallido del rumbo**

```rust
#[test]
fn rumbo_se_voltea_180_al_invertir_extremos() {
    let a = [0.0, 0.0, 0.0];
    let b = [300.0, 400.0, 0.0];
    let ir = rumbo_horizontal(&a, &b);
    let vu = rumbo_horizontal(&b, &a);
    assert!(((ir - vu + 180.0).abs() % 360.0) < 1e-9 || ((vu - ir + 180.0).abs() % 360.0) < 1e-9);
    assert!(ir >= 0.0 && ir < 360.0);
}
```

- [ ] **Step 2: Ejecutar** — `cargo test rumbo` → FAIL (no existe).
- [ ] **Step 3: Implementar** — `rumbo_horizontal`; `datos_ruta` direccional por extremos (destino académico = último punto × ACADEMICO_NORM/dist; en sentido inverso ≈ (0,0)); caché por extremos; botón `Sentido: {nombre}` en el cluster derecho (junto a Reiniciar) que hace `sentido.0 = sentido.0.invertir()`; etiqueta de marca (línea 225) dinámica: `format!("DRON · {}", sentido.0.nombre())`.
- [ ] **Step 4: `cargo test`** → PASS (8 tests).
- [ ] **Step 5: Commit** — `git commit -am "bevy: botón de sentido en el HUD y panel matemático direccional"`

### Task 4: Verificación headless en ambos sentidos y cierre

**Files:** ninguno (verificación + README).

- [ ] **Step 1:** `cargo build --release` (fondo).
- [ ] **Step 2:** Matar instancias (pgrep con truco `[p]`, kill -9 por PID). Correr `SIM_VEL=4 CAPTURA=1 FPS=1`: 0 panics, 48 fps, 4 capturas.
- [ ] **Step 3:** Toggle manual de sentido en corrida aparte (sin CAPTURA, 20 s): log sin panics; verificar en el log/telemetría que el dron reinicia en el extremo opuesto (rumbo ~volteo 180° en la telemetría del panel; posición salta al otro campus).
- [ ] **Step 4:** README: una línea en Decisiones sobre el sentido reversible.
- [ ] **Step 5:** Commit + push a `development`: `bevy: recorrido reversible UTS↔UIS con toggle en caliente`.

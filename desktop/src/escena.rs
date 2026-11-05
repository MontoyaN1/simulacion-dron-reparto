//! Escena 3D del corredor UTS→UIS: ortofoto horneada, 718 edificios OSM,
//! dron y cámara perseguidora con colisión contra los edificios.

use bevy::animation::graph::AnimationNodeIndex;
use bevy::animation::AnimationPlayer;
use bevy::input::mouse::{MouseMotion, MouseWheel};
use bevy::pbr::Atmosphere;
use bevy::prelude::*;
use bevy::render::alpha::AlphaMode;
use bevy::render::mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use bevy::render::render_asset::RenderAssetUsages;
use bevy::render::render_resource::Face;
use bevy::image::{Image, ImageAddressMode, ImageSampler, ImageSamplerDescriptor};
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use bevy::window::PrimaryWindow;
use bevy_egui::EguiContexts;
use parry3d_f64::math::{Isometry, Point, Vector};
use parry3d_f64::query::{Ray, RayCast};
use parry3d_f64::shape::TriMesh;

use crate::nucleo::{Fase, MotorVuelo, VERTICAL_MS, ALTITUD_CRUCERO, ALTURA_ANCLA_MSNM};

pub(crate) const LON_UTS: f64 = -73.123524;
pub(crate) const LAT_UTS: f64 = 7.1051164;
const LON_UIS: f64 = -73.1198652;
const LAT_UIS: f64 = 7.1409311;
const MG_LAT: f64 = 111_320.0;
const PASO_MALLA: f64 = 25.0;
const PASO_FONDO: f64 = 100.0;
const MARGEN_BBOX: f64 = 0.009;
const PASO_MEDIO: f64 = 60.0;
const MEDIO_ALONG_MIN: f64 = -4000.0;
const MEDIO_ALONG_MAX: f64 = 5000.0;
const MEDIO_LATERAL: f64 = 4000.0;

pub struct EscenaPlugin;

impl Plugin for EscenaPlugin {
    fn build(&self, app: &mut App) {
        let corredor = Corredor::cargar();
        let ruta = perfil_ruta(&corredor);
        // Relleno de cielo: sin él las caras a contraluz quedan en negro puro.
        // En Bevy 0.16 el ambiente es un recurso (o componente de cámara).
        app.insert_resource(AmbientLight {
            color: Color::srgb(0.68, 0.73, 0.83),
            brightness: 2_500.0,
            affects_lightmapped_meshes: false,
        })
        .insert_resource(Vuelo::nuevo(ruta))
            .insert_resource(corredor)
            .init_resource::<ColisionEdificios>()
            .init_resource::<Camara>()
            .init_resource::<VelSim>()
            .add_systems(Startup, construir_escena)
            .add_systems(FixedUpdate, avanzar_vuelo)
            .add_systems(
                Update,
                (
                    entrada_camara,
                    seguir_dron,
                    animar_dron,
                    animar_rotores,
                    pulso_marcas,
                    poner_icono,
                ),
            );
    }
}

/** Ruta UTS->UIS con etapas verticales y un leve giro S. */
fn perfil_ruta(corredor: &Corredor) -> Vec<[f64; 3]> {
    let [dx, dn] = corredor.desplazamiento;
    let suelo_uts = corredor.agl(0.0, 0.0);
    let suelo_uis = corredor.agl(dx, dn);
    let mut ruta = vec![
        [0.0, 0.0, suelo_uts],
        [0.0, 0.0, suelo_uts + ALTITUD_CRUCERO],
    ];
    let etapas = 14;
    for k in 1..=etapas {
        let along = corredor.largo * k as f64 / etapas as f64;
        // Curva S suave: hasta ±20 m laterales, cero en los extremos.
        let lateral = 20.0 * (std::f64::consts::TAU * along / corredor.largo).sin();
        // Crucero a 50 m con dos etapas de altitud (±8 m) a lo largo.
        let alt = ALTITUD_CRUCERO + 8.0 * (std::f64::consts::TAU * 2.0 * along / corredor.largo).sin();
        let [este, norte] = corredor.punto(along, lateral);
        ruta.push([este, norte, corredor.agl(este, norte) + alt]);
    }
    ruta.push([dx, dn, suelo_uis]);
    ruta
}

/// Estado del vuelo: el motor avanza a paso fijo y el render interpola.
#[derive(Resource)]
pub struct Vuelo {
    pub motor: MotorVuelo,
    pub anterior: [f64; 3],
    pub actual: [f64; 3],
    pub pausado: bool,
    pub inicio: [f64; 3],
    pub ruta: Vec<[f64; 3]>,
}

impl Vuelo {
    fn nuevo(ruta: Vec<[f64; 3]>) -> Self {
        let inicio = *ruta.first().unwrap_or(&[0.0; 3]);
        Vuelo {
            motor: MotorVuelo::nuevo(ruta.clone()),
            anterior: inicio,
            actual: inicio,
            pausado: false,
            inicio,
            ruta,
        }
    }

    /// Posición visual suavizada entre los dos últimos pasos fijos.
    pub fn posicion_interpolada(&self, alfa: f32) -> Vec3 {
        // ENU (este, norte, arriba) → Bevy (x=este, y=arriba, z=norte).
        let a = Vec3::new(self.anterior[0] as f32, self.anterior[2] as f32, self.anterior[1] as f32);
        let b = Vec3::new(self.actual[0] as f32, self.actual[2] as f32, self.actual[1] as f32);
        a.lerp(b, alfa.clamp(0.0, 1.0))
    }

    pub fn reiniciar(&mut self) {
        self.motor.reiniciar();
        self.anterior = self.inicio;
        self.actual = self.inicio;
        self.pausado = false;
    }
}

/// Multiplicador de velocidad de la simulación (1, 2, 4, 8 o 16).
#[derive(Resource)]
pub struct VelSim(pub u32);

impl Default for VelSim {
    fn default() -> Self {
        // SIM_VEL permite verificar la velocidad sin tocar la UI.
        let v = std::env::var("SIM_VEL")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1);
        VelSim(v.max(1))
    }
}

fn avanzar_vuelo(mut vuelo: ResMut<Vuelo>, vel: Res<VelSim>, tiempo: Res<Time>) {
    if vuelo.pausado {
        // Congela la interpolación: con `anterior` caducado el dron oscila
        // entre los dos últimos pasos mientras el reloj sigue corriendo.
        vuelo.anterior = vuelo.actual;
        return;
    }
    vuelo.motor.iniciar();
    vuelo.anterior = vuelo.actual;
    let dt = tiempo.delta_secs_f64();
    // Subpasos del paso fijo: la trayectoria es idéntica a correr más rápido.
    for _ in 0..vel.0.max(1) {
        vuelo.motor.actualizar(dt);
    }
    vuelo.actual = vuelo.motor.telemetria().posicion;
}

/// Tabla de alturas del corredor y ejes de la ruta.
#[derive(Resource)]
pub struct Corredor {
    terreno: MallaAltura,
    fondo: MallaAltura,
    dir: [f64; 2],
    lado: [f64; 2],
    pub largo: f64,
    pub desplazamiento: [f64; 2],
    bbox_franja: [f64; 4],
    bbox_medio: [f64; 4],
    bbox_fondo: [f64; 4],
    mg_lon: f64,
}

/// Rejilla de alturas en el marco del corredor (relativas al ancla, en metros).
struct MallaAltura {
    paso_along: f64,
    paso_lateral: f64,
    along_min: f64,
    lateral_min: f64,
    filas: usize,
    columnas: usize,
    valores: Vec<f64>,
}

impl MallaAltura {
    /// Altura bilineal interpolada; fuera de la rejilla se recorta al borde.
    fn altura(&self, along: f64, lateral: f64) -> f64 {
        let fa = ((along - self.along_min) / self.paso_along).clamp(0.0, (self.filas - 1) as f64);
        let fb = ((lateral - self.lateral_min) / self.paso_lateral).clamp(0.0, (self.columnas - 1) as f64);
        let (i0, j0) = (fa.floor() as usize, fb.floor() as usize);
        let (i1, j1) = ((i0 + 1).min(self.filas - 1), (j0 + 1).min(self.columnas - 1));
        let (ta, tb) = (fa - i0 as f64, fb - j0 as f64);
        let v = |i: usize, j: usize| self.valores[i * self.columnas + j];
        let abajo = v(i0, j0) + (v(i0, j1) - v(i0, j0)) * tb;
        let arriba = v(i1, j0) + (v(i1, j1) - v(i1, j0)) * tb;
        abajo + (arriba - abajo) * ta
    }

    fn along_max(&self) -> f64 {
        self.along_min + (self.filas - 1) as f64 * self.paso_along
    }

    fn lateral_max(&self) -> f64 {
        self.lateral_min + (self.columnas - 1) as f64 * self.paso_lateral
    }
}

impl Corredor {
    fn cargar() -> Self {
        let terreno = Self::cargar_terreno("assets/alturas-terreno.json");
        // El área amplia (municipios y veredas) es opcional: si no está, el
        // fondo usa la misma rejilla del corredor.
        let fondo = Self::cargar_terreno("assets/alturas-terreno-amplio.json");

        let desplazamiento = enu_de(LAT_UIS, LON_UIS);
        let largo = (desplazamiento[0].powi(2) + desplazamiento[1].powi(2)).sqrt();
        let dir = [desplazamiento[0] / largo, desplazamiento[1] / largo];
        let lado = [-dir[1], dir[0]];

        let bbox_franja = Self::cargar_caja("assets/corredor-caja.json").unwrap_or_else(|| {
            let lon_min = LON_UTS.min(LON_UIS) - MARGEN_BBOX;
            let lon_max = LON_UTS.max(LON_UIS) + MARGEN_BBOX;
            let lat_min = LAT_UTS.min(LAT_UIS) - MARGEN_BBOX;
            let lat_max = LAT_UTS.max(LAT_UIS) + MARGEN_BBOX;
            Self::bbox_mercator(lon_min, lon_max, lat_min, lat_max)
        });
        let bbox_medio = Self::cargar_caja("assets/mapa-medio-caja.json").unwrap_or(bbox_franja);
        let bbox_fondo = Self::cargar_caja("assets/mapa-amplio-caja.json").unwrap_or(bbox_franja);

        Corredor {
            terreno,
            fondo,
            dir,
            lado,
            largo,
            desplazamiento,
            bbox_franja,
            bbox_medio,
            bbox_fondo,
            mg_lon: MG_LAT * LAT_UTS.to_radians().cos(),
        }
    }

    /// Caja geodésica horneada -> recuadro mercator [izq, der, arriba, abajo].
    fn cargar_caja(ruta: &str) -> Option<[f64; 4]> {
        let texto = std::fs::read_to_string(ruta).ok()?;
        let json: serde_json::Value = serde_json::from_str(&texto).ok()?;
        Some(Self::bbox_mercator(
            json["lon_min"].as_f64()?,
            json["lon_max"].as_f64()?,
            json["lat_min"].as_f64()?,
            json["lat_max"].as_f64()?,
        ))
    }

    fn bbox_mercator(lon_min: f64, lon_max: f64, lat_min: f64, lat_max: f64) -> [f64; 4] {
        [
            (lon_min + 180.0) / 360.0,
            (lon_max + 180.0) / 360.0,
            mercator_y(lat_max),
            mercator_y(lat_min),
        ]
    }

    /// DEM horneado (SRTM) si esta; si no, la tabla cerrada del corredor.
    fn cargar_terreno(ruta: &str) -> MallaAltura {
        if let Ok(texto) = std::fs::read_to_string(ruta) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&texto) {
                let paso = json["paso_m"].as_f64().unwrap_or(25.0);
                let filas = json["filas"].as_u64().unwrap_or(1) as usize;
                let columnas = json["columnas"].as_u64().unwrap_or(1) as usize;
                let mut valores = vec![0.0; filas * columnas];
                for dato in json["datos"].as_array().into_iter().flatten() {
                    let (i, j) = (
                        dato[0].as_u64().unwrap_or(0) as usize,
                        dato[1].as_u64().unwrap_or(0) as usize,
                    );
                    if i < filas && j < columnas {
                        valores[i * columnas + j] = dato[2].as_f64().unwrap_or(0.0);
                    }
                }
                return MallaAltura {
                    paso_along: paso,
                    paso_lateral: paso,
                    along_min: -json["margen_along_m"].as_f64().unwrap_or(0.0),
                    lateral_min: -json["margen_lateral_m"].as_f64().unwrap_or(0.0),
                    filas,
                    columnas,
                    valores,
                };
            }
        }

        // Tabla v2: 50 m a lo largo x 75 m lateral, alturas en msnm.
        let texto = std::fs::read_to_string("assets/alturas-corredor.json")
            .expect("falta assets/alturas-corredor.json");
        let json: serde_json::Value = serde_json::from_str(&texto).expect("json de alturas invalido");
        let filas = json["datos"]
            .as_array()
            .map(|d| d.iter().filter_map(|v| v[0].as_u64()).max().unwrap_or(0) as usize + 1)
            .unwrap_or(1);
        let columnas = json["datos"]
            .as_array()
            .map(|d| d.iter().filter_map(|v| v[1].as_u64()).max().unwrap_or(0) as usize + 1)
            .unwrap_or(1);
        let mut valores = vec![0.0; filas * columnas];
        for dato in json["datos"].as_array().into_iter().flatten() {
            let (i, j) = (
                dato[0].as_u64().unwrap_or(0) as usize,
                dato[1].as_u64().unwrap_or(0) as usize,
            );
            if i < filas && j < columnas {
                valores[i * columnas + j] = dato[2].as_f64().unwrap_or(ALTURA_ANCLA_MSNM) - ALTURA_ANCLA_MSNM;
            }
        }
        MallaAltura {
            paso_along: 50.0,
            paso_lateral: 75.0,
            along_min: 0.0,
            lateral_min: -150.0,
            filas,
            columnas,
            valores,
        }
    }

    /// Punto ENU del eje de la ruta (along a lo largo, lateral a la izquierda).
    pub fn punto(&self, along: f64, lateral: f64) -> [f64; 2] {
        [
            self.dir[0] * along + self.lado[0] * lateral,
            self.dir[1] * along + self.lado[1] * lateral,
        ]
    }

    /// Altura relativa al ancla (m) del terreno bajo un punto ENU.
    /// Mezcla el DEM fino del corredor con el amplio de los alrededores.
    pub fn agl(&self, este: f64, norte: f64) -> f64 {
        let (along, lateral) = self.proyectar(este, norte);
        let fino = self.terreno.altura(along, lateral);
        let peso = self.peso_fino(along, lateral);
        let mix = if peso >= 1.0 {
            fino
        } else {
            fino * peso + self.fondo.altura(along, lateral) * (1.0 - peso)
        };
        // Nunca bajo el DEM amplio: asi las capas de malla no se cruzan.
        mix.max(self.fondo.altura(along, lateral))
    }

    /// (along, lateral) del punto ENU en el marco de la ruta.
    pub fn proyectar(&self, este: f64, norte: f64) -> (f64, f64) {
        (
            este * self.dir[0] + norte * self.dir[1],
            este * self.lado[0] + norte * self.lado[1],
        )
    }

    /// Altura del DEM amplio en bruto (para hundir las capas medias).
    pub fn dem(&self, este: f64, norte: f64) -> f64 {
        let (along, lateral) = self.proyectar(este, norte);
        self.fondo.altura(along, lateral)
    }

    /// Rango del DEM amplio: (along_min, along_max, lateral_min, lateral_max).
    pub fn rango_fondo(&self) -> (f64, f64, f64, f64) {
        (
            self.fondo.along_min,
            self.fondo.along_max(),
            self.fondo.lateral_min,
            self.fondo.lateral_max(),
        )
    }

    /// 1 dentro del corredor, 0 fuera; transicion de 250 m en el borde.
    fn peso_fino(&self, along: f64, lateral: f64) -> f64 {
        let t = &self.terreno;
        let d = (along - t.along_min)
            .min(t.along_max() - along)
            .min(lateral - t.lateral_min)
            .min(t.lateral_max() - lateral);
        (d / 250.0).clamp(0.0, 1.0)
    }

    /// Coordenada UV del mosaico para un vertice ENU (v=0 arriba = norte).
    fn uv(&self, este: f64, norte: f64, bbox: &[f64; 4]) -> [f32; 2] {
        let lon = LON_UTS + este / self.mg_lon;
        let lat = LAT_UTS + norte / MG_LAT;
        let mx = (lon + 180.0) / 360.0;
        let my = mercator_y(lat);
        [
            ((mx - bbox[0]) / (bbox[1] - bbox[0])) as f32,
            ((my - bbox[2]) / (bbox[3] - bbox[2])) as f32,
        ]
    }
}
fn mercator_y(lat: f64) -> f64 {
    let la = lat.to_radians();
    (1.0 - (la.tan() + 1.0 / la.cos()).ln() / std::f64::consts::PI) / 2.0
}

/// Proyección geodésica → ENU (este, norte) sobre la UTS.
fn enu_de(lat: f64, lon: f64) -> [f64; 2] {
    const A: f64 = 6_378_137.0;
    const F: f64 = 1.0 / 298.257_223_563;
    const E2: f64 = F * (2.0 - F);
    let ecef = |lat: f64, lon: f64| {
        let (la, lo) = (lat.to_radians(), lon.to_radians());
        let n = A / (1.0 - E2 * la.sin().powi(2)).sqrt();
        [n * la.cos() * lo.cos(), n * la.cos() * lo.sin(), n * (1.0 - E2) * la.sin()]
    };
    let (p, o) = (ecef(lat, lon), ecef(LAT_UTS, LON_UTS));
    let (dx, dy, dz) = (p[0] - o[0], p[1] - o[1], p[2] - o[2]);
    let (la0, lo0) = (LAT_UTS.to_radians(), LON_UTS.to_radians());
    [
        -lo0.sin() * dx + lo0.cos() * dy,
        -la0.sin() * lo0.cos() * dx - la0.sin() * lo0.sin() * dy + la0.cos() * dz,
    ]
}

#[derive(Resource, Default)]
struct ColisionEdificios(Option<TriMesh>);

#[derive(Resource)]
pub struct Camara {
    pos: Vec3,
    /// Orbita libre: el usuario se quedo la camara con el raton.
    pub libre: bool,
    azim: f32,
    elev: f32,
    dist: f32,
}

impl Default for Camara {
    fn default() -> Self {
        Camara { pos: Vec3::new(0.0, 420.0, 2000.0), libre: false, azim: 0.0, elev: 0.6, dist: 75.0 }
    }
}

/** Orbita libre: arrastrar = girar, rueda = zoom, R = volver al dron. */
fn entrada_camara(
    mut camara: ResMut<Camara>,
    drones: Query<&Transform, With<Dron>>,
    mut rueda: EventReader<MouseWheel>,
    mut raton: EventReader<MouseMotion>,
    botones: Res<ButtonInput<MouseButton>>,
    teclado: Res<ButtonInput<KeyCode>>,
    mut egui: EguiContexts,
) {
    if teclado.just_pressed(KeyCode::KeyR) {
        camara.libre = false;
        return;
    }
    // Sobre el panel (o la barra) la rueda y el arrastre son de la UI, no
    // de la cámara: sin esto, hacer scroll en el panel también zoom.
    if egui.ctx_mut().is_ok_and(|c| c.is_pointer_over_area()) {
        return;
    }
    let mut interacto = false;
    while let Some(ev) = rueda.read().next() {
        camara.dist = (camara.dist * (1.0 - ev.y * 0.08)).clamp(12.0, 900.0);
        interacto = true;
    }
    if botones.pressed(MouseButton::Left) {
        while let Some(ev) = raton.read().next() {
            camara.azim -= ev.delta.x * 0.005;
            camara.elev = (camara.elev + ev.delta.y * 0.005).clamp(0.06, 1.45);
            interacto = true;
        }
    }
    if interacto && !camara.libre {
        // Adota el encuadre actual como punto de partida de la orbita.
        if let Ok(dron) = drones.single() {
            let rel = camara.pos - dron.translation;
            let h = rel.length().max(1e-3);
            camara.dist = h.clamp(12.0, 900.0);
            camara.elev = (rel.y / h).asin().clamp(0.06, 1.45);
            camara.azim = rel.z.atan2(rel.x);
        }
        camara.libre = true;
    }
}

/// Pulsacion de los anillos de salida y llegada.
fn pulso_marcas(tiempo: Res<Time>, mut zonas: Query<&mut Transform, With<ZonaMarcada>>) {
    let s = 1.0 + 0.10 * (tiempo.elapsed_secs() * 2.2).sin();
    for mut t in &mut zonas {
        t.scale = Vec3::splat(s);
    }
}

fn construir_escena(
    mut commands: Commands,
    mut mallas: ResMut<Assets<Mesh>>,
    mut imagenes: ResMut<Assets<Image>>,
    mut materiales: ResMut<Assets<StandardMaterial>>,
    server: Res<AssetServer>,
    corredor: Res<Corredor>,
    vuelo: Res<Vuelo>,
    mut colision: ResMut<ColisionEdificios>,
) {
    // Sol: la DirectionalLight brilla según el +Z de su transform, así que hay
    // que inclinarla; con el transform por defecto ilumina de lado y todo queda plano.
    commands.spawn((
        DirectionalLight {
            color: Color::srgb(1.0, 0.97, 0.91),
            illuminance: 22_000.0,
            shadows_enabled: false,
            ..default()
        },
        Transform::from_rotation(Quat::from_euler(EulerRot::YXZ, -2.1, -0.95, 0.0)),
    ));
    commands.spawn((
        Mesh3d(mallas.add(malla_terreno(&corredor))),
        MeshMaterial3d(materiales.add(StandardMaterial {
            base_color_texture: Some(server.load("corredor-satelital.jpg")),
            perceptual_roughness: 0.9,
            cull_mode: None,
            ..default()
        })),
    ));

    // Capa media (z17): sin ella, a media distancia la ortofoto se ve en bloques.
    if std::path::Path::new("assets/mapa-medio.jpg").exists() {
        commands.spawn((
            Mesh3d(mallas.add(malla_relieve(
                &corredor,
                MEDIO_ALONG_MIN,
                MEDIO_ALONG_MAX,
                -MEDIO_LATERAL,
                MEDIO_LATERAL,
                PASO_MEDIO,
                &corredor.bbox_medio,
                0.4,
            ))),
            MeshMaterial3d(materiales.add(StandardMaterial {
                base_color_texture: Some(server.load("mapa-medio.jpg")),
                perceptual_roughness: 0.95,
                cull_mode: None,
                ..default()
            })),
        ));
    }
    if std::path::Path::new("assets/mapa-amplio.jpg").exists() {
        let (along_min, along_max, lateral_min, lateral_max) = corredor.rango_fondo();
        commands.spawn((
            Mesh3d(mallas.add(malla_relieve(
                &corredor,
                along_min,
                along_max,
                lateral_min,
                lateral_max,
                PASO_FONDO,
                &corredor.bbox_fondo,
                1.0,
            ))),
            MeshMaterial3d(materiales.add(StandardMaterial {
                base_color_texture: Some(server.load("mapa-amplio.jpg")),
                perceptual_roughness: 0.95,
                cull_mode: None,
                ..default()
            })),
        ));
    }

    let (malla, trimesh) = malla_edificios(&corredor);
    colision.0 = trimesh;
    if let Some(malla) = malla {
        let fachada = imagenes.add(textura_fachada());
        commands.spawn((
            Mesh3d(mallas.add(malla)),
            MeshMaterial3d(materiales.add(StandardMaterial {
                base_color: Color::WHITE,
                base_color_texture: Some(fachada),
                perceptual_roughness: 0.9,
                cull_mode: None,
                ..default()
            })),
        ));
    }

    // Dron: nodo padre movible + escena glTF (modelo Z-arriba del cliente web).
    let escena: Handle<Scene> = server.load("corredor-dron.glb#Scene0");
    commands
        .spawn((Dron, Transform::default(), Visibility::default()))
        .with_children(|padre| {
            // La rotacion base + actitud dinamica vive en el nodo padre.
            padre.spawn((SceneRoot(escena), Transform::from_scale(Vec3::splat(3.0))));
        });

    // Ruta pintada en escena: el piloto ve el trazado que sigue el dron.
    commands.spawn((
        Mesh3d(mallas.add(cinta_ruta(&vuelo.ruta))),
        MeshMaterial3d(materiales.add(StandardMaterial {
            unlit: true,
            base_color: Color::srgba(0.35, 0.83, 1.0, 0.55),
            alpha_mode: AlphaMode::Blend,
            cull_mode: None,
            ..default()
        })),
    ));

    // Anillos de salida (UTS) y llegada (UIS) con su haz vertical.
    spawn_zona(&mut commands, &mut mallas, &mut materiales, &corredor, [0.0, 0.0], Color::srgb(0.35, 0.83, 1.0));
    spawn_zona(&mut commands, &mut mallas, &mut materiales, &corredor, corredor.desplazamiento, Color::srgb(0.5, 0.9, 0.6));

    // Capa de nubes: domo gigante a 20 km con textura horneada.
    if std::path::Path::new("assets/nubes.png").exists() {
        commands.spawn((
            Mesh3d(mallas.add(domo_nubes(20_000.0, 64, 32))),
            MeshMaterial3d(materiales.add(StandardMaterial {
                unlit: true,
                base_color_texture: Some(server.load("nubes.png")),
                alpha_mode: AlphaMode::Blend,
                cull_mode: Some(Face::Front),
                ..default()
            })),
            Transform::from_translation(Vec3::new(0.0, 0.0, 1_990.0)),
        ));
    }

    let (vista, objetivo) = vista_amplia(&corredor);
    commands.spawn((
        // hdr: vista en buffer Rgba16Float; el cielo procedural (Bruneton)
        // de Bevy 0.16 solo funciona sobre buffer HDR. En 0.16 el campo
        // vive en la componente base Camera, no en Camera3d.
        Camera { hdr: true, ..default() },
        Camera3d::default(),
        Msaa::Off,
        // Cielo procedural con sol (Bruneton): toma la luz de la
        // DirectionalLight de la escena; la bruma fisica hace de bruma.
        Atmosphere::default(),
        Projection::Perspective(PerspectiveProjection { near: 0.5, far: 45_000.0, ..default() }),
        Transform::from_translation(vista).looking_at(objetivo, Vec3::Y),
    ));
    commands.insert_resource(Camara { pos: vista, ..default() });
}

/** Zona de despegue/entrega: anillo en el suelo + haz vertical de 90 m. */
fn spawn_zona(
    commands: &mut Commands,
    mallas: &mut Assets<Mesh>,
    materiales: &mut Assets<StandardMaterial>,
    corredor: &Corredor,
    pos_enu: [f64; 2],
    color: Color,
) {
    let c = color.to_srgba();
    let suelo = corredor.agl(pos_enu[0], pos_enu[1]) as f32;
    let centro = Vec3::new(pos_enu[0] as f32, suelo + 0.3, pos_enu[1] as f32);
    commands.spawn((
        ZonaMarcada,
        Mesh3d(mallas.add(anillo(7.0, 11.0, 48))),
        MeshMaterial3d(materiales.add(StandardMaterial {
            unlit: true,
            base_color: Color::srgba(c.red, c.green, c.blue, 0.55),
            alpha_mode: AlphaMode::Blend,
            cull_mode: None,
            ..default()
        })),
        Transform::from_translation(centro),
    ));
    commands.spawn((
        Mesh3d(mallas.add(haz_luz(centro, 90.0))),
        MeshMaterial3d(materiales.add(StandardMaterial {
            unlit: true,
            base_color: Color::srgba(c.red, c.green, c.blue, 0.22),
            alpha_mode: AlphaMode::Blend,
            cull_mode: None,
            ..default()
        })),
    ));
}

/** Cinta de 1,8 m de ancho sobre la ruta, para verla de lejos. */
fn cinta_ruta(ruta: &[[f64; 3]]) -> Mesh {
    let mut pos: Vec<[f32; 3]> = Vec::with_capacity(ruta.len() * 2);
    let (mut lx, mut lz) = (1.0_f64, 0.0_f64);
    for (i, p) in ruta.iter().enumerate() {
        if let Some(q) = ruta.get(i + 1) {
            let (dx, dz) = (q[0] - p[0], q[1] - p[1]);
            let m = dx.hypot(dz);
            if m > 1e-3 {
                (lx, lz) = (-dz / m, dx / m);
            }
        }
        const W: f64 = 0.9;
        pos.push([(p[0] + lx * W) as f32, p[2] as f32 + 0.4, (p[1] + lz * W) as f32]);
        pos.push([(p[0] - lx * W) as f32, p[2] as f32 + 0.4, (p[1] - lz * W) as f32]);
    }
    let mut indices = Vec::with_capacity(ruta.len().saturating_sub(1) * 6);
    for i in 0..ruta.len().saturating_sub(1) {
        let a = (i * 2) as u32;
        indices.extend_from_slice(&[a, a + 2, a + 1, a + 1, a + 2, a + 3]);
    }
    let mut malla = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    malla.insert_attribute(Mesh::ATTRIBUTE_POSITION, pos);
    malla.insert_indices(Indices::U32(indices));
    malla
}

/** Anillo (anillo = corona) horizontal en el origen, listo para mover. */
fn anillo(interior: f32, exterior: f32, segmentos: u32) -> Mesh {
    let mut pos: Vec<[f32; 3]> = Vec::with_capacity(((segmentos + 1) * 2) as usize);
    let mut indices = Vec::with_capacity(segmentos as usize * 6);
    for i in 0..=segmentos {
        let t = i as f32 / segmentos as f32 * std::f32::consts::TAU;
        let (cx, cz) = (t.cos(), t.sin());
        pos.push([cx * exterior, 0.0, cz * exterior]);
        pos.push([cx * interior, 0.0, cz * interior]);
    }
    for i in 0..segmentos {
        let a = i * 2;
        indices.extend_from_slice(&[a, a + 2, a + 1, a + 1, a + 2, a + 3]);
    }
    let mut malla = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    malla.insert_attribute(Mesh::ATTRIBUTE_POSITION, pos);
    malla.insert_indices(Indices::U32(indices));
    malla
}

/** Haz de luz: dos planos cruzados desde el suelo hasta `alto`. */
fn haz_luz(c: Vec3, alto: f32) -> Mesh {
    let (y0, y1, w) = (c.y - 0.3, c.y + alto, 1.1_f32);
    let pos: [[f32; 3]; 8] = [
        [c.x - w, y0, c.z],
        [c.x + w, y0, c.z],
        [c.x + w, y1, c.z],
        [c.x - w, y1, c.z],
        [c.x, y0, c.z - w],
        [c.x, y0, c.z + w],
        [c.x, y1, c.z + w],
        [c.x, y1, c.z - w],
    ];
    let indices = [0u32, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    let mut malla = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    malla.insert_attribute(Mesh::ATTRIBUTE_POSITION, pos.to_vec());
    malla.insert_indices(Indices::U32(indices.to_vec()));
    malla
}

/** Domo UV para ver el cielo y las nubes por dentro. */
fn domo_nubes(radio: f32, sectores: u32, capas: u32) -> Mesh {
    let mut pos: Vec<[f32; 3]> = Vec::with_capacity((sectores + 1) as usize * (capas + 1) as usize);
    let mut uvs: Vec<[f32; 2]> = Vec::with_capacity((sectores + 1) as usize * (capas + 1) as usize);
    for i in 0..=capas {
        let v = i as f32 / capas as f32;
        let theta = v * std::f32::consts::PI;
        let (st, ct) = (theta.sin(), theta.cos());
        for j in 0..=sectores {
            let u = j as f32 / sectores as f32;
            let phi = u * std::f32::consts::TAU;
            pos.push([st * phi.cos() * radio, ct * radio, st * phi.sin() * radio]);
            uvs.push([u, v]);
        }
    }
    let ancho = (sectores + 1) as u32;
    let mut indices = Vec::with_capacity(sectores as usize * capas as usize * 6);
    for i in 0..capas {
        for j in 0..sectores {
            let a = i * ancho + j;
            let b = a + 1;
            let c = a + ancho;
            let d = c + 1;
            indices.extend_from_slice(&[a, c, b, b, c, d]);
        }
    }
    let mut malla = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    malla.insert_attribute(Mesh::ATTRIBUTE_POSITION, pos);
    malla.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    malla.insert_indices(Indices::U32(indices));
    malla
}

#[derive(Component)]
struct ZonaMarcada;

/// Plano de presentación: el corredor en perspectiva, desde atrás y a la izquierda.
fn vista_amplia(corredor: &Corredor) -> (Vec3, Vec3) {
    let [este, norte] = corredor.punto(-900.0, 220.0);
    let posicion = Vec3::new(este as f32, corredor.agl(este, norte) as f32 + 190.0, norte as f32);
    let [e2, n2] = corredor.punto(1100.0, 0.0);
    (posicion, Vec3::new(e2 as f32, 25.0, n2 as f32))
}

fn malla_terreno(corredor: &Corredor) -> Mesh {
    // Malla densa (25 m) para que el relieve del DEM se note, con normales
    // calculadas: sin ellas la iluminación no tiene contra qué sombrear.
    // Cubre todo el DEM fino; su borde cae justo al valor del DEM amplio.
    let (along_min, along_max) = (corredor.terreno.along_min, corredor.terreno.along_max());
    let (lat_min, lat_max) = (corredor.terreno.lateral_min, corredor.terreno.lateral_max());
    let filas = ((along_max - along_min) / PASO_MALLA).round().max(8.0) as usize;
    let cols = ((lat_max - lat_min) / PASO_MALLA).round().max(4.0) as usize;
    let mut posiciones = Vec::with_capacity((filas + 1) * (cols + 1));
    let mut uvs = Vec::with_capacity((filas + 1) * (cols + 1));
    for fila in 0..=filas {
        let along = along_min + (along_max - along_min) * fila as f64 / filas as f64;
        for col in 0..=cols {
            let lateral = lat_min + (lat_max - lat_min) * col as f64 / cols as f64;
            let [este, norte] = corredor.punto(along, lateral);
            posiciones.push([este as f32, corredor.agl(este, norte) as f32, norte as f32]);
            uvs.push(corredor.uv(este, norte, &corredor.bbox_franja));
        }
    }
    let ancho = cols + 1;
    let mut indices = Vec::with_capacity(filas * cols * 6);
    for fila in 0..filas {
        for col in 0..cols {
            let a = (fila * ancho + col) as u32;
            let b = a + 1;
            let c = a + ancho as u32;
            let d = c + 1;
            indices.extend_from_slice(&[a, b, c, b, d, c]);
        }
    }
    let mut normales = vec![[0.0_f32; 3]; posiciones.len()];
    for tri in indices.chunks_exact(3) {
        let n = normal_de(posiciones[tri[0] as usize], posiciones[tri[1] as usize], posiciones[tri[2] as usize]);
        for &i in tri {
            normales[i as usize] = n;
        }
    }
    let mut malla = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    malla.insert_attribute(Mesh::ATTRIBUTE_POSITION, posiciones);
    malla.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normales);
    malla.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    malla.insert_indices(Indices::U32(indices));
    malla
}

/** Terreno amplio: monta y veredas alrededor del corredor. */
/**
 * Terreno intermedio/lejano sobre el DEM amplio, hundido `hundido` metros
 * para no pelear por profundidad con la capa de arriba.
 */
fn malla_relieve(
    corredor: &Corredor,
    along_min: f64,
    along_max: f64,
    lateral_min: f64,
    lateral_max: f64,
    paso: f64,
    bbox: &[f64; 4],
    hundido: f32,
) -> Mesh {
    let filas = ((along_max - along_min) / paso).round().max(4.0) as usize;
    let cols = ((lateral_max - lateral_min) / paso).round().max(4.0) as usize;
    let mut posiciones = Vec::with_capacity((filas + 1) * (cols + 1));
    let mut uvs = Vec::with_capacity((filas + 1) * (cols + 1));
    for fila in 0..=filas {
        let along = along_min + (along_max - along_min) * fila as f64 / filas as f64;
        for col in 0..=cols {
            let lateral = lateral_min + (lateral_max - lateral_min) * col as f64 / cols as f64;
            let [este, norte] = corredor.punto(along, lateral);
            posiciones.push([
                este as f32,
                corredor.dem(este, norte) as f32 - hundido,
                norte as f32,
            ]);
            uvs.push(corredor.uv(este, norte, bbox));
        }
    }
    let ancho = cols + 1;
    let mut indices = Vec::with_capacity(filas * cols * 6);
    for fila in 0..filas {
        for col in 0..cols {
            let a = (fila * ancho + col) as u32;
            let b = a + 1;
            let c = a + ancho as u32;
            let d = c + 1;
            indices.extend_from_slice(&[a, b, c, b, d, c]);
        }
    }
    let mut normales = vec![[0.0_f32; 3]; posiciones.len()];
    for tri in indices.chunks_exact(3) {
        let n = normal_de(
            posiciones[tri[0] as usize],
            posiciones[tri[1] as usize],
            posiciones[tri[2] as usize],
        );
        for &i in tri {
            normales[i as usize] = n;
        }
    }
    let mut malla = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    malla.insert_attribute(Mesh::ATTRIBUTE_POSITION, posiciones);
    malla.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normales);
    malla.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    malla.insert_indices(Indices::U32(indices));
    malla
}

const TINTES: [[f32; 3]; 6] = [
    [0.722, 0.690, 0.639],
    [0.659, 0.584, 0.514],
    [0.714, 0.749, 0.765],
    [0.753, 0.702, 0.608],
    [0.624, 0.663, 0.678],
    [0.725, 0.604, 0.525],
];
const BASE: [f32; 3] = [0.702, 0.667, 0.620];

/// Altura de piso para el ritmo de ventanas de la fachada (metros).
const PISO_M: f32 = 3.3;
/// UV que cae en muro liso de la textura de fachada (techos y cúpulas).
const UV_MURO: [f32; 2] = [0.15, 0.5];

// Paleta institucional de los campus (sRGB).
const SRGB_OCRE: [f32; 3] = [0.78, 0.58, 0.36]; // Ciencias Humanas: concreto ocre
const SRGB_GRIS: [f32; 3] = [0.55, 0.56, 0.58]; // núcleos y cajas de azotea
const SRGB_LADRILLO: [f32; 3] = [0.64, 0.46, 0.36]; // Biblioteca (patrimonio)
const SRGB_INSTITUCIONAL: [f32; 3] = [0.78, 0.79, 0.81]; // bloques de la UIS
const SRGB_CREMA: [f32; 3] = [0.84, 0.80, 0.72]; // Casona La Perla
const SRGB_TERRACOTA: [f32; 3] = [0.60, 0.34, 0.24]; // teja de la casona
const SRGB_CAMPUS_UTS: [f32; 3] = [0.75, 0.76, 0.79]; // bloques del campus UTS
const SRGB_CORONA_UTS: [f32; 3] = [0.30, 0.48, 0.72]; // corona de las torres UTS
const SRGB_CUPULA: [f32; 3] = [0.60, 0.63, 0.68]; // cúpula del planetario
const SRGB_CILINDRO: [f32; 3] = [0.85, 0.85, 0.87]; // tambor del planetario

struct Acumulador {
    posiciones: Vec<[f32; 3]>,
    normales: Vec<[f32; 3]>,
    colores: Vec<[f32; 4]>,
    uvs: Vec<[f32; 2]>,
    indices: Vec<u32>,
    colision_vertices: Vec<Point<f64>>,
    colision_indices: Vec<[u32; 3]>,
}

impl Acumulador {
    fn new() -> Self {
        Self {
            posiciones: Vec::new(),
            normales: Vec::new(),
            colores: Vec::new(),
            uvs: Vec::new(),
            indices: Vec::new(),
            colision_vertices: Vec::new(),
            colision_indices: Vec::new(),
        }
    }

    fn vertice(
        &mut self,
        p: [f32; 3],
        normal: [f32; 3],
        color: [f32; 4],
        uv: [f32; 2],
    ) -> u32 {
        let indice = self.posiciones.len() as u32;
        self.posiciones.push(p);
        self.normales.push(normal);
        self.colores.push(color);
        self.uvs.push(uv);
        indice
    }

    fn triangulo(&mut self, a: u32, b: u32, c: u32) {
        self.indices.extend_from_slice(&[a, b, c]);
    }
}

/// (total de edificios OSM, los que llegan a la franja de crucero).
/// Mismo criterio que la planificación de referencia: techo sobre
/// ALTITUD_CRUCERO - 12 m, medido desde el ancla.
pub fn contar_edificios(corredor: &Corredor) -> (u32, u32) {
    let texto = std::fs::read_to_string("assets/edificios.geojson").unwrap_or_default();
    let json: serde_json::Value = serde_json::from_str(&texto).unwrap_or_default();
    let umbral = ALTITUD_CRUCERO - 12.0;
    let mut total = 0u32;
    let mut bloquean = 0u32;
    for feature in json["features"].as_array().into_iter().flatten() {
        if feature["geometry"]["type"] != "Polygon" {
            continue;
        }
        let anillo = feature["geometry"]["coordinates"][0]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if anillo.len() < 4 {
            continue;
        }
        let plano: Vec<[f64; 2]> = anillo
            .iter()
            .map(|p| enu_de(p[1].as_f64().unwrap_or(0.0), p[0].as_f64().unwrap_or(0.0)))
            .collect();
        let centro = [
            plano.iter().map(|p| p[0]).sum::<f64>() / plano.len() as f64,
            plano.iter().map(|p| p[1]).sum::<f64>() / plano.len() as f64,
        ];
        let alto = feature["properties"]["height"]
            .as_f64()
            .filter(|h| *h > 1.0)
            .or_else(|| {
                feature["properties"]["levels"]
                    .as_f64()
                    .filter(|n| *n > 0.0)
                    .map(|n| n * 3.2 + 1.5)
            })
            .unwrap_or(9.0);
        total += 1;
        if corredor.agl(centro[0], centro[1]) + alto >= umbral {
            bloquean += 1;
        }
    }
    (total, bloquean)
}

/// Textura de fachada procedural: módulo de 128×128 px = 1 bahía × 1 piso,
/// sin costuras en ninguno de los dos ejes (la banda de losa es idéntica en
/// el borde superior e inferior del módulo). Se muestrea con UV métricos.
fn textura_fachada() -> Image {
    const M: usize = 128;
    let muro = [242u8, 239u8, 232u8];
    let losa = [212u8, 208u8, 198u8];
    let vidrio = [74u8, 88u8, 108u8];
    let marco = [228u8, 225u8, 216u8];
    let antepecho = [221u8, 217u8, 207u8];
    let mut px = vec![0u8; M * M * 4];
    for y in 0..M {
        for x in 0..M {
            let c = if y < 8 || y >= M - 8 {
                losa
            } else if !(30..=97).contains(&x) {
                muro
            } else if y < 12 {
                antepecho
            } else if y >= M - 12 {
                marco
            } else if x == 30 || x == 31 || x == 96 || x == 97 || x == 63 || x == 64 {
                marco
            } else {
                vidrio
            };
            let i = (y * M + x) * 4;
            px[i] = c[0];
            px[i + 1] = c[1];
            px[i + 2] = c[2];
            px[i + 3] = 255;
        }
    }
    // Cadena de mipmaps (promedio 2×2) para que las fachadas lejanas no
    // sufran aliasing; el sampler lineal los muestrea al minificar.
    let mut niveles: Vec<Vec<u8>> = vec![px];
    let (mut w, mut h) = (M, M);
    while w > 1 && h > 1 {
        let prev = niveles.last().unwrap();
        let (w2, h2) = (w / 2, h / 2);
        let mut nv = vec![0u8; w2 * h2 * 4];
        for y in 0..h2 {
            for x in 0..w2 {
                for k in 0..4 {
                    let s = prev[((2 * y) * w + 2 * x) * 4 + k] as u32
                        + prev[((2 * y) * w + 2 * x + 1) * 4 + k] as u32
                        + prev[((2 * y + 1) * w + 2 * x) * 4 + k] as u32
                        + prev[((2 * y + 1) * w + 2 * x + 1) * 4 + k] as u32;
                    nv[(y * w2 + x) * 4 + k] = (s / 4) as u8;
                }
            }
        }
        niveles.push(nv);
        (w, h) = (w2, h2);
    }
    let mut datos = Vec::with_capacity(niveles.iter().map(|n| n.len()).sum());
    for n in &niveles {
        datos.extend_from_slice(n);
    }
    let mut img = Image::new_uninit(
        Extent3d {
            width: M as u32,
            height: M as u32,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::default(),
    );
    img.texture_descriptor.mip_level_count = niveles.len() as u32;
    img.data = Some(datos);
    img.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor {
        address_mode_u: ImageAddressMode::Repeat,
        address_mode_v: ImageAddressMode::Repeat,
        anisotropy_clamp: 8,
        ..ImageSamplerDescriptor::linear()
    });
    img
}

/// Color sRGB → lineal con alfa 1 (el material ya está en sRGB).
fn srgb(c: [f32; 3]) -> [f32; 4] {
    [c[0].powf(2.2), c[1].powf(2.2), c[2].powf(2.2), 1.0]
}

fn oscurecer(c: [f32; 4], f: f32) -> [f32; 4] {
    [c[0] * f, c[1] * f, c[2] * f, c[3]]
}

fn centroide(plano: &[[f64; 2]]) -> [f64; 2] {
    [
        plano.iter().map(|p| p[0]).sum::<f64>() / plano.len() as f64,
        plano.iter().map(|p| p[1]).sum::<f64>() / plano.len() as f64,
    ]
}

/// Eje dominante de la huella (promedio de los bordes ponderado por longitud):
/// centro, dirección unitaria, semilargo y semiancho.
fn eje_largo(plano: &[[f64; 2]]) -> ([f64; 2], [f64; 2], f64, f64) {
    let c = centroide(plano);
    let (mut ex, mut ey) = (0.0, 0.0);
    for i in 0..plano.len() {
        let j = (i + 1) % plano.len();
        let dx = plano[j][0] - plano[i][0];
        let dy = plano[j][1] - plano[i][1];
        let l = dx.hypot(dy);
        if l < 1e-9 {
            continue;
        }
        let (ux, uy) = if dx < 0.0 { (-dx / l, -dy / l) } else { (dx / l, dy / l) };
        ex += ux * l;
        ey += uy * l;
    }
    let m = ex.hypot(ey);
    let dir = if m < 1e-9 { [1.0, 0.0] } else { [ex / m, ey / m] };
    let (mut largo, mut ancho) = (0.0f64, 0.0f64);
    for p in plano {
        let dx = p[0] - c[0];
        let dy = p[1] - c[1];
        largo = largo.max((dx * dir[0] + dy * dir[1]).abs());
        ancho = ancho.max((dx * -dir[1] + dy * dir[0]).abs());
    }
    (c, dir, largo, ancho)
}

/// Huella escalada alrededor de su centroide y corrida `off` m por el eje largo.
fn escalar(plano: &[[f64; 2]], centro: &[f64; 2], dir: &[f64; 2], s: f64, off: f64) -> Vec<[f64; 2]> {
    plano
        .iter()
        .map(|p| {
            [
                centro[0] + (p[0] - centro[0]) * s + dir[0] * off,
                centro[1] + (p[1] - centro[1]) * s + dir[1] * off,
            ]
        })
        .collect()
}

/// Rectángulo centrado en `c` con eje `dir` (largo × ancho, en metros).
fn rect(c: [f64; 2], dir: [f64; 2], largo: f64, ancho: f64) -> Vec<[f64; 2]> {
    let perp = [-dir[1], dir[0]];
    let (hl, ha) = (largo / 2.0, ancho / 2.0);
    [[-hl, -ha], [hl, -ha], [hl, ha], [-hl, ha]]
        .iter()
        .map(|[u, v]| [c[0] + dir[0] * u + perp[0] * v, c[1] + dir[1] * u + perp[1] * v])
        .collect()
}

/// Voltea la normal si apunta al lado contrario de `hacia`: el winding de los
/// tambores y pendientes puede dar hacia adentro (cull_mode None lo tolera).
fn orientar(n: [f32; 3], hacia: [f32; 3]) -> [f32; 3] {
    if n[0] * hacia[0] + n[1] * hacia[1] + n[2] * hacia[2] < 0.0 {
        [-n[0], -n[1], -n[2]]
    } else {
        n
    }
}

fn cuad_colision(malla: &mut Acumulador, vertices: &[[f32; 3]; 4]) {
    let inicio = malla.colision_vertices.len() as u32;
    for p in vertices {
        malla.colision_vertices.push(Point::new(p[0] as f64, p[1] as f64, p[2] as f64));
    }
    malla.colision_indices.push([inicio, inicio + 1, inicio + 2]);
    malla.colision_indices.push([inicio, inicio + 2, inicio + 3]);
}

fn tri_colision(malla: &mut Acumulador, vertices: &[[f32; 3]; 3]) {
    let inicio = malla.colision_vertices.len() as u32;
    for p in vertices {
        malla.colision_vertices.push(Point::new(p[0] as f64, p[1] as f64, p[2] as f64));
    }
    malla.colision_indices.push([inicio, inicio + 1, inicio + 2]);
}

/// Prisma con fachada texturizada (UV métricos: u = largo del borde / bahía,
/// v = altura / piso), colisión y techo plano opcional (UV de muro liso,
/// color propio para que se lea como azotea).
fn emitir_edificio(
    malla: &mut Acumulador,
    earcut: &mut earcut::Earcut<f64>,
    triangulos: &mut Vec<u32>,
    plano: &[[f64; 2]],
    base: f32,
    alto: f32,
    color: [f32; 4],
    techo_color: [f32; 4],
    bay: f32,
    con_techo: bool,
) {
    for i in 0..plano.len() {
        let j = (i + 1) % plano.len();
        let a = [plano[i][0] as f32, base, plano[i][1] as f32];
        let b = [plano[j][0] as f32, base, plano[j][1] as f32];
        let at = [a[0], base + alto, a[2]];
        let bt = [b[0], base + alto, b[2]];
        let normal = normal_de(a, b, bt);
        let u1 = ((b[0] - a[0]).hypot(b[2] - a[2])).max(1e-3) / bay;
        let v1 = alto / PISO_M;
        let a0 = malla.vertice(a, normal, color, [0.0, 0.0]);
        let b0 = malla.vertice(b, normal, color, [u1, 0.0]);
        let bt0 = malla.vertice(bt, normal, color, [u1, v1]);
        let at0 = malla.vertice(at, normal, color, [0.0, v1]);
        malla.triangulo(a0, b0, bt0);
        malla.triangulo(a0, bt0, at0);
        cuad_colision(malla, &[a, b, bt, at]);
    }
    if con_techo {
        earcut.earcut_slice(plano, &[] as &[u32], triangulos);
        for tri in triangulos.chunks_exact(3) {
            let puntos = [
                [plano[tri[0] as usize][0] as f32, base + alto, plano[tri[0] as usize][1] as f32],
                [plano[tri[1] as usize][0] as f32, base + alto, plano[tri[1] as usize][1] as f32],
                [plano[tri[2] as usize][0] as f32, base + alto, plano[tri[2] as usize][1] as f32],
            ];
            let ids = [
                malla.vertice(puntos[0], [0.0, 1.0, 0.0], techo_color, UV_MURO),
                malla.vertice(puntos[1], [0.0, 1.0, 0.0], techo_color, UV_MURO),
                malla.vertice(puntos[2], [0.0, 1.0, 0.0], techo_color, UV_MURO),
            ];
            malla.triangulo(ids[0], ids[1], ids[2]);
            tri_colision(malla, &puntos);
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Clase {
    Normal,
    Uts,
    TorreUts,
    Ocre,
    Planetario,
    Casona,
    Herencia,
    Institucional,
}

/// Tipo de edificio. Los landmarks de campus llevan puerta de distancia:
/// la UIS está a ~4 km del ancla UTS (origen ENU) y viceversa.
fn clasificar(nombre: Option<&str>, centro: &[f64; 2], alto: f64, destino: &[f64; 2]) -> Clase {
    let d_uis = (centro[0] - destino[0]).hypot(centro[1] - destino[1]);
    let d_uts = centro[0].hypot(centro[1]);
    let n = nombre.unwrap_or("");
    if d_uis < 500.0 {
        if n.contains("Ciencias Humanas 2") {
            return Clase::Ocre;
        }
        if n.contains("Planetario") {
            return Clase::Planetario;
        }
        if n.contains("Casona") {
            return Clase::Casona;
        }
        if n.contains("Biblioteca") {
            return Clase::Herencia;
        }
        if n.contains("UIS") || n.contains("USI") {
            return Clase::Institucional;
        }
    }
    if d_uts < 350.0 {
        if alto >= 24.0 {
            return Clase::TorreUts;
        }
        if alto >= 10.0 {
            return Clase::Uts;
        }
    }
    Clase::Normal
}

/// Facultad de Ciencias Humanas 2 (UIS): tres placas de concreto ocre
/// escalonadas con núcleos grises en los extremos (Taller de Arquitectura de
/// Bogotá, premio BAQ 2024 / ArchDaily 2026).
fn torre_ocre(
    malla: &mut Acumulador,
    earcut: &mut earcut::Earcut<f64>,
    triangulos: &mut Vec<u32>,
    plano: &[[f64; 2]],
    base: f32,
    alto: f32,
) {
    let (c, dir, largo, _ancho) = eje_largo(plano);
    let ocre = srgb(SRGB_OCRE);
    let gris = srgb(SRGB_GRIS);
    let escalas = [1.0f64, 0.93, 0.86];
    let offs = [0.0f64, 1.8, -1.8];
    let h = alto / 3.0;
    for k in 0..3 {
        let huella = escalar(plano, &c, &dir, escalas[k], offs[k]);
        emitir_edificio(
            malla,
            earcut,
            triangulos,
            &huella,
            base + k as f32 * h,
            h,
            ocre,
            gris,
            3.0,
            true,
        );
    }
    // Núcleos grises de servicio en ambos extremos, altura completa.
    for s in [-1.0f64, 1.0] {
        let nucleo = rect(
            [
                c[0] + dir[0] * s * (largo / 2.0 - 4.0),
                c[1] + dir[1] * s * (largo / 2.0 - 4.0),
            ],
            dir,
            6.0,
            3.5,
        );
        emitir_edificio(malla, earcut, triangulos, &nucleo, base, alto, gris, gris, 3.0, true);
    }
    // Caja de azotea.
    let caja = rect(c, dir, 8.0, 5.0);
    emitir_edificio(
        malla,
        earcut,
        triangulos,
        &caja,
        base + alto,
        2.0,
        gris,
        gris,
        3.0,
        true,
    );
}

/// Planetario UIS: bar institucional + tambor cilíndrico acristalado +
/// cúpula semiesférica.
fn planeta(
    malla: &mut Acumulador,
    earcut: &mut earcut::Earcut<f64>,
    triangulos: &mut Vec<u32>,
    plano: &[[f64; 2]],
    base: f32,
) {
    let inst = srgb(SRGB_INSTITUCIONAL);
    let tambor = srgb(SRGB_CILINDRO);
    let cupula = srgb(SRGB_CUPULA);
    let (c, _dir, _largo, _ancho) = eje_largo(plano);
    emitir_edificio(
        malla,
        earcut,
        triangulos,
        plano,
        base,
        3.0,
        inst,
        srgb(SRGB_GRIS),
        3.2,
        true,
    );
    // Tambor: cilindro de 16 segmentos, r 3.5 m, ventanas por arco.
    let r = 3.5f32;
    let y0 = base + 3.0;
    let y1 = base + 6.5;
    let seg = 16usize;
    let (cx, cz) = (c[0] as f32, c[1] as f32);
    for i in 0..seg {
        let t0 = std::f32::consts::TAU * i as f32 / seg as f32;
        let t1 = std::f32::consts::TAU * (i + 1) as f32 / seg as f32;
        let tm = (t0 + t1) / 2.0;
        let n = [tm.cos(), 0.0, tm.sin()];
        let p = |t: f32, y: f32| [cx + r * t.cos(), y, cz + r * t.sin()];
        let (a, b, at, bt) = (p(t0, y0), p(t1, y0), p(t0, y1), p(t1, y1));
        let (u0, u1, v1) = (t0 * r / 3.0, t1 * r / 3.0, (y1 - y0) / PISO_M);
        let a0 = malla.vertice(a, n, tambor, [u0, 0.0]);
        let b0 = malla.vertice(b, n, tambor, [u1, 0.0]);
        let bt0 = malla.vertice(bt, n, tambor, [u1, v1]);
        let at0 = malla.vertice(at, n, tambor, [u0, v1]);
        malla.triangulo(a0, b0, bt0);
        malla.triangulo(a0, bt0, at0);
        cuad_colision(malla, &[a, b, bt, at]);
    }
    // Cúpula semiesférica: abanico del ápice + 4 bandas, normales radiales.
    let anillos = 5usize;
    let phi = |k: usize| (k as f32 / anillos as f32) * std::f32::consts::FRAC_PI_2;
    let q = |t: f32, rr: f32, yy: f32| [cx + rr * t.cos(), yy, cz + rr * t.sin()];
    let n_radial = |t: f32, ph: f32| [ph.sin() * t.cos(), ph.cos(), ph.sin() * t.sin()];
    let apex = [cx, y1 + r, cz];
    let na = [0.0, 1.0, 0.0];
    for i in 0..seg {
        let t0 = std::f32::consts::TAU * i as f32 / seg as f32;
        let t1 = std::f32::consts::TAU * (i + 1) as f32 / seg as f32;
        let ph = phi(1);
        let rr = r * ph.sin();
        let yy = y1 + r * ph.cos();
        let p0 = q(t0, rr, yy);
        let p1 = q(t1, rr, yy);
        let ia = malla.vertice(apex, na, cupula, UV_MURO);
        let ib = malla.vertice(p0, n_radial(t0, ph), cupula, UV_MURO);
        let ic = malla.vertice(p1, n_radial(t1, ph), cupula, UV_MURO);
        malla.triangulo(ia, ib, ic);
        tri_colision(malla, &[apex, p0, p1]);
    }
    for k in 1..anillos {
        let (ph0, ph1) = (phi(k), phi(k + 1));
        let (r0, r1) = (r * ph0.sin(), r * ph1.sin());
        let (ya, yb) = (y1 + r * ph0.cos(), y1 + r * ph1.cos());
        for i in 0..seg {
            let t0 = std::f32::consts::TAU * i as f32 / seg as f32;
            let t1 = std::f32::consts::TAU * (i + 1) as f32 / seg as f32;
            let (a, b, at, bt) = (q(t0, r0, ya), q(t1, r0, ya), q(t0, r1, yb), q(t1, r1, yb));
            let ia = malla.vertice(a, n_radial(t0, ph0), cupula, UV_MURO);
            let ib = malla.vertice(b, n_radial(t1, ph0), cupula, UV_MURO);
            let ibt = malla.vertice(bt, n_radial(t1, ph1), cupula, UV_MURO);
            let iat = malla.vertice(at, n_radial(t0, ph1), cupula, UV_MURO);
            malla.triangulo(ia, ib, ibt);
            malla.triangulo(ia, ibt, iat);
            cuad_colision(malla, &[a, b, bt, at]);
        }
    }
}

/// Casona La Perla (UIS): muros crema + cubierta a dos aguas de teja con
/// caballete a +1.7 m sobre las correas (aproximación por bbox).
fn casona(
    malla: &mut Acumulador,
    earcut: &mut earcut::Earcut<f64>,
    triangulos: &mut Vec<u32>,
    plano: &[[f64; 2]],
    base: f32,
    alto: f32,
) {
    let crema = srgb(SRGB_CREMA);
    let teja = srgb(SRGB_TERRACOTA);
    let (c, dir, largo, ancho) = eje_largo(plano);
    emitir_edificio(
        malla,
        earcut,
        triangulos,
        plano,
        base,
        alto,
        crema,
        crema,
        3.0,
        false,
    );
    let alero = base + alto;
    let cab = alero + 1.7;
    let perp = [-dir[1], dir[0]];
    let (hl, ha) = (largo / 2.0, ancho / 2.0);
    for s in [-1.0f64, 1.0] {
        // Pendiente: cuad desde el alero (lado s) hasta el caballete.
        let e0 = [
            c[0] + dir[0] * hl + perp[0] * s * ha,
            c[1] + dir[1] * hl + perp[1] * s * ha,
        ];
        let e1 = [
            c[0] - dir[0] * hl + perp[0] * s * ha,
            c[1] - dir[1] * hl + perp[1] * s * ha,
        ];
        let r0 = [c[0] + dir[0] * hl, c[1] + dir[1] * hl];
        let r1 = [c[0] - dir[0] * hl, c[1] - dir[1] * hl];
        let a = [e0[0] as f32, alero, e0[1] as f32];
        let b = [e1[0] as f32, alero, e1[1] as f32];
        let at = [r0[0] as f32, cab, r0[1] as f32];
        let bt = [r1[0] as f32, cab, r1[1] as f32];
        let hacia = [perp[0] as f32 * s as f32, 0.4, perp[1] as f32 * s as f32];
        let n = orientar(normal_de(a, b, bt), hacia);
        let ia = malla.vertice(a, n, teja, UV_MURO);
        let ib = malla.vertice(b, n, teja, UV_MURO);
        let ibt = malla.vertice(bt, n, teja, UV_MURO);
        let iat = malla.vertice(at, n, teja, UV_MURO);
        malla.triangulo(ia, ib, ibt);
        malla.triangulo(ia, ibt, iat);
        cuad_colision(malla, &[a, b, bt, at]);
    }
    // Caballetes: triángulos crema en los extremos del eje largo.
    for s in [-1.0f64, 1.0] {
        let g0 = [
            c[0] + dir[0] * s * hl + perp[0] * ha,
            c[1] + dir[1] * s * hl + perp[1] * ha,
        ];
        let g1 = [
            c[0] + dir[0] * s * hl - perp[0] * ha,
            c[1] + dir[1] * s * hl - perp[1] * ha,
        ];
        let rg = [c[0] + dir[0] * s * hl, c[1] + dir[1] * s * hl];
        let p0 = [g0[0] as f32, alero, g0[1] as f32];
        let p1 = [g1[0] as f32, alero, g1[1] as f32];
        let p2 = [rg[0] as f32, cab, rg[1] as f32];
        let hacia = [dir[0] as f32 * s as f32, 0.0, dir[1] as f32 * s as f32];
        let n = orientar(normal_de(p0, p1, p2), hacia);
        let i0 = malla.vertice(p0, n, crema, UV_MURO);
        let i1 = malla.vertice(p1, n, crema, UV_MURO);
        let i2 = malla.vertice(p2, n, crema, UV_MURO);
        malla.triangulo(i0, i1, i2);
        tri_colision(malla, &[p0, p1, p2]);
    }
}

fn malla_edificios(corredor: &Corredor) -> (Option<Mesh>, Option<TriMesh>) {
    let texto = std::fs::read_to_string("assets/edificios.geojson").unwrap_or_default();
    let json: serde_json::Value = serde_json::from_str(&texto).unwrap_or_default();
    let mut malla = Acumulador::new();
    let mut earcut = earcut::Earcut::<f64>::new();
    let mut triangulos: Vec<u32> = Vec::new();
    for (orden, feature) in json["features"].as_array().into_iter().flatten().enumerate() {
        let geom = &feature["geometry"];
        if geom["type"] != "Polygon" {
            continue;
        }
        let anillo = geom["coordinates"][0].as_array().cloned().unwrap_or_default();
        if anillo.len() < 4 {
            continue;
        }
        let plano: Vec<[f64; 2]> = anillo
            .iter()
            .map(|p| enu_de(p[1].as_f64().unwrap_or(0.0), p[0].as_f64().unwrap_or(0.0)))
            .collect();
        let centro = centroide(&plano);
        let en_extremo = |p: &[f64; 2]| (p[0] - centro[0]).hypot(p[1] - centro[1]) < 20.0;
        if punto_dentro(&[0.0, 0.0], &plano)
            || punto_dentro(&corredor.desplazamiento, &plano)
            || en_extremo(&[0.0, 0.0])
            || en_extremo(&corredor.desplazamiento)
        {
            continue;
        }

        // La base se apoya en el DEM visible (misma malla que el terreno);
        // la altura puntual de ion sirve de respaldo.
        let suelo_rel = corredor.agl(centro[0], centro[1]);
        let base = suelo_rel as f32 + 0.12;
        let alto_f64 = feature["properties"]["height"]
            .as_f64()
            .filter(|h| *h > 1.0)
            .or_else(|| {
                feature["properties"]["levels"]
                    .as_f64()
                    .filter(|n| *n > 0.0)
                    .map(|n| n * 3.2 + 1.5)
            })
            .unwrap_or(9.0);
        let alto = alto_f64 as f32;
        let nombre = feature["properties"]["name"].as_str();

        match clasificar(nombre, &centro, alto_f64, &corredor.desplazamiento) {
            Clase::Normal => {
                let tinte = TINTES[orden % TINTES.len()];
                let color = [
                    (BASE[0] * tinte[0]).powf(2.2),
                    (BASE[1] * tinte[1]).powf(2.2),
                    (BASE[2] * tinte[2]).powf(2.2),
                    1.0,
                ];
                emitir_edificio(
                    &mut malla,
                    &mut earcut,
                    &mut triangulos,
                    &plano,
                    base,
                    alto,
                    color,
                    oscurecer(color, 0.72),
                    3.6,
                    true,
                );
            }
            Clase::Uts => {
                let campus = srgb(SRGB_CAMPUS_UTS);
                emitir_edificio(
                    &mut malla,
                    &mut earcut,
                    &mut triangulos,
                    &plano,
                    base,
                    alto,
                    campus,
                    oscurecer(campus, 0.8),
                    3.2,
                    true,
                );
            }
            Clase::TorreUts => {
                let (c, dir, largo, ancho) = eje_largo(&plano);
                let campus = srgb(SRGB_CAMPUS_UTS);
                let corona = srgb(SRGB_CORONA_UTS);
                let gris = srgb(SRGB_GRIS);
                emitir_edificio(
                    &mut malla,
                    &mut earcut,
                    &mut triangulos,
                    &plano,
                    base,
                    alto - 1.4,
                    campus,
                    oscurecer(campus, 0.8),
                    3.2,
                    true,
                );
                let banda = escalar(&plano, &c, &dir, 1.02, 0.0);
                emitir_edificio(
                    &mut malla,
                    &mut earcut,
                    &mut triangulos,
                    &banda,
                    base + alto - 1.4,
                    1.4,
                    corona,
                    corona,
                    3.2,
                    true,
                );
                let caja = rect(c, dir, largo * 0.7, ancho * 0.7);
                emitir_edificio(
                    &mut malla,
                    &mut earcut,
                    &mut triangulos,
                    &caja,
                    base + alto,
                    2.0,
                    gris,
                    gris,
                    3.2,
                    true,
                );
            }
            Clase::Herencia => {
                let (c, dir, _l, _a) = eje_largo(&plano);
                let ladrillo = srgb(SRGB_LADRILLO);
                let osc = oscurecer(ladrillo, 0.8);
                emitir_edificio(
                    &mut malla,
                    &mut earcut,
                    &mut triangulos,
                    &plano,
                    base,
                    alto - 0.7,
                    ladrillo,
                    osc,
                    2.4,
                    true,
                );
                let banda = escalar(&plano, &c, &dir, 1.03, 0.0);
                emitir_edificio(
                    &mut malla,
                    &mut earcut,
                    &mut triangulos,
                    &banda,
                    base + alto - 0.7,
                    0.7,
                    osc,
                    osc,
                    2.4,
                    true,
                );
            }
            Clase::Institucional => {
                let (c, dir, _l, _a) = eje_largo(&plano);
                let inst = srgb(SRGB_INSTITUCIONAL);
                let gris = srgb(SRGB_GRIS);
                emitir_edificio(
                    &mut malla,
                    &mut earcut,
                    &mut triangulos,
                    &plano,
                    base,
                    alto - 0.7,
                    inst,
                    oscurecer(inst, 0.8),
                    3.2,
                    true,
                );
                let banda = escalar(&plano, &c, &dir, 1.015, 0.0);
                emitir_edificio(
                    &mut malla,
                    &mut earcut,
                    &mut triangulos,
                    &banda,
                    base + alto - 0.7,
                    0.7,
                    gris,
                    gris,
                    3.2,
                    true,
                );
            }
            Clase::Ocre => torre_ocre(
                &mut malla,
                &mut earcut,
                &mut triangulos,
                &plano,
                base,
                alto,
            ),
            Clase::Planetario => planeta(
                &mut malla,
                &mut earcut,
                &mut triangulos,
                &plano,
                base,
            ),
            Clase::Casona => casona(
                &mut malla,
                &mut earcut,
                &mut triangulos,
                &plano,
                base,
                alto,
            ),
        }
    }

    if malla.posiciones.is_empty() || malla.colision_indices.is_empty() {
        return (None, None);
    }
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, malla.posiciones);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, malla.normales);
    mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, malla.colores);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, malla.uvs);
    mesh.insert_indices(Indices::U32(malla.indices));
    let trimesh = TriMesh::new(malla.colision_vertices, malla.colision_indices);
    (Some(mesh), Some(trimesh))
}

fn normal_de(a: [f32; 3], b: [f32; 3], c: [f32; 3]) -> [f32; 3] {
    let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    let m = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
    if m < 1e-6 {
        [0.0, 1.0, 0.0]
    } else {
        [n[0] / m, n[1] / m, n[2] / m]
    }
}

/// Ray casting 2D para descartar la huella de los campus.
fn punto_dentro(p: &[f64; 2], anillo: &[[f64; 2]]) -> bool {
    let mut dentro = false;
    let mut j = anillo.len() - 1;
    for i in 0..anillo.len() {
        let (a, b) = (anillo[i], anillo[j]);
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            dentro = !dentro;
        }
        j = i;
    }
    dentro
}

#[derive(Component)]
struct Dron;

/// Sigue al dron con suavizado exponencial y recorta contra los edificios.
fn seguir_dron(
    tiempo: Res<Time>,
    fijo: Res<Time<Fixed>>,
    vuelo: Res<Vuelo>,
    corredor: Res<Corredor>,
    colision: Res<ColisionEdificios>,
    mut camara: ResMut<Camara>,
    mut drones: Query<&mut Transform, With<Dron>>,
    mut camaras: Query<&mut Transform, (With<Camera3d>, Without<Dron>)>,
) {
    let pos = vuelo.posicion_interpolada(fijo.overstep_fraction());
    for mut trasform in &mut drones {
        trasform.translation = pos;
    }
    let Ok(mut trasform_camara) = camaras.single_mut() else {
        return;
    };

    if camara.libre {
        // Orbita libre alrededor del dron, con el mismo recorte de colision.
        let offset = Vec3::new(
            camara.azim.sin() * camara.elev.cos(),
            camara.elev.sin(),
            camara.azim.cos() * camara.elev.cos(),
        ) * camara.dist;
        let desde = pos + Vec3::Y * 1.2;
        let candidato = pos + offset;
        let mut elegido = candidato;
        if let Some(toi) = golpe_de(&colision.0, desde, candidato) {
            elegido = desde + (candidato - desde).normalize() * ((toi as f32 - 2.0).max(1.5));
        }
        let suavizado = 1.0 - (-10.0 * tiempo.delta_secs()).exp();
        camara.pos = camara.pos.lerp(elegido, suavizado);
        let suelo = corredor.agl(camara.pos.x as f64, camara.pos.z as f64) as f32;
        camara.pos.y = camara.pos.y.max(suelo + 4.0);
        trasform_camara.translation = camara.pos;
        trasform_camara.look_at(pos + Vec3::Y * 1.5, Vec3::Y);
        return;
    }

    let t = vuelo.motor.telemetria().t;
    if t < 2.4 {
        let (vista, objetivo) = vista_amplia(&corredor);
        camara.pos = vista;
        trasform_camara.translation = camara.pos;
        trasform_camara.look_at(objetivo, Vec3::Y);
        return;
    }

    let atras = Vec3::new(-corredor.dir[0] as f32, 0.0, -corredor.dir[1] as f32);
    let desde = pos + Vec3::Y * 1.2;

    // Candidatos de encuadre, de más cercano a más alto: se usa el primero
    // con línea de visión libre (si no, el primero con al menos 8 m de hueco).
    let lateral = Vec3::new(corredor.lado[0] as f32, 0.0, corredor.lado[1] as f32);
    // Candidatos de más "aérea" a más pegada al dron: cuanto más alto, más
    // se ve la ciudad y menos fachadas de fondo.
    let candidatos = [
        pos + atras * 45.0 + Vec3::Y * 62.0,
        pos + atras * 60.0 + Vec3::Y * 45.0,
        pos + lateral * 50.0 + Vec3::Y * 40.0,
        pos + atras * 30.0 + Vec3::Y * 78.0,
        pos + Vec3::Y * 95.0,
    ];
    let mut elegido = candidatos[0];
    for candidato in candidatos {
        match golpe_de(&colision.0, desde, candidato) {
            None => {
                elegido = candidato;
                break;
            }
            // Solo se acepta si la pared queda lejos: si no, la cámara
            // acabaría pegada a una fachada y no se ve nada.
            Some(toi) if toi as f32 >= 0.6 * (candidato - desde).length() => {
                elegido = desde + (candidato - desde).normalize() * (toi as f32 - 2.0);
                break;
            }
            Some(_) => continue,
        }
    }
    if elegido == candidatos[0] {
        if let Some(toi) = golpe_de(&colision.0, desde, elegido) {
            elegido = desde + (elegido - desde).normalize() * ((toi as f32 - 1.0).max(1.5));
        }
    }

    let suavizado = 1.0 - (-6.0 * tiempo.delta_secs()).exp();
    camara.pos = camara.pos.lerp(elegido, suavizado);

    let mut hasta = camara.pos;
    let suelo = corredor.agl(hasta.x as f64, hasta.z as f64) as f32;
    hasta.y = hasta.y.max(suelo + 6.0);
    camara.pos = hasta;
    trasform_camara.translation = hasta;
    trasform_camara.look_at(pos + Vec3::Y * 1.5, Vec3::Y);
}

/// Distancia al primer edificio que corta la línea `desde` → `objetivo`.
fn golpe_de(malla: &Option<TriMesh>, desde: Vec3, objetivo: Vec3) -> Option<f64> {
    let malla = malla.as_ref()?;
    let delta = objetivo - desde;
    let distancia = delta.length();
    if distancia < 1e-3 {
        return None;
    }
    let rayo = Ray::new(
        Point::new(desde.x as f64, desde.y as f64, desde.z as f64),
        Vector::new(
            (delta.x / distancia) as f64,
            (delta.y / distancia) as f64,
            (delta.z / distancia) as f64,
        ),
    );
    malla.cast_ray(&Isometry::identity(), &rayo, distancia as f64, true)
}

/**
 * Actitud del fuselaje: rumbo, cabeceo por velocidad y ascenso, alabeo en
 * las curvas y vaiven de hover. Mismas convenciones que el cliente de
 * referencia (euler XYZ, base -pi/2 / pi).
 */
fn animar_dron(
    tiempo: Res<Time>,
    vuelo: Res<Vuelo>,
    mut drones: Query<&mut Transform, With<Dron>>,
    mut estado: Local<(f32, f32, f32)>,
) {
    let m = vuelo.motor.telemetria();
    let rumbo = m.rumbo_grados.to_radians();
    let vel_h = (m.vel[0].powi(2) + m.vel[1].powi(2)).sqrt();
    let vel_z = m.vel[2];
    // Velocidad lateral respecto al rumbo (izquierda positiva): alabeo.
    let v_lat = m.vel[0] * rumbo.cos() - m.vel[1] * rumbo.sin();
    // Cabeceo: morro abajo con velocidad (referencia) + leve morro arriba al
    // ascender y abajo al descender.
    let objetivo_pitch = -(vel_h * 0.009).min(0.2)
        + (vel_z / VERTICAL_MS).clamp(-1.0, 1.0) * 0.15;
    let objetivo_roll = (v_lat * 0.35).clamp(-0.30, 0.30);
    let en_aire = matches!(m.fase, Fase::Despegue | Fase::Crucero | Fase::Descenso);
    let mezcla = (1.0 - (-6.0 * tiempo.delta_secs_f64()).exp()) as f32;
    let (mut pitch_f, mut roll_f, mut amp) = *estado;
    pitch_f += (objetivo_pitch as f32 - pitch_f) * mezcla;
    roll_f += (objetivo_roll as f32 - roll_f) * mezcla;
    amp += ((if en_aire { 1.0 } else { 0.0 }) - amp) * mezcla;
    *estado = (pitch_f, roll_f, amp);
    let t = tiempo.elapsed_secs();
    let vaiven = amp * (0.12 * (1.8 * t).sin() + 0.07 * (2.9 * t + 1.3).sin());
    for mut tras in &mut drones {
        tras.translation.y += vaiven as f32;
        tras.rotation = Quat::from_euler(
            EulerRot::XYZ,
            -std::f32::consts::FRAC_PI_2 + pitch_f,
            std::f32::consts::PI + rumbo as f32,
            roll_f,
        );
    }
}

fn animar_rotores(mut jugadores: Query<&mut AnimationPlayer>, mut iniciado: Local<bool>) {
    if *iniciado {
        return;
    }
    if let Some(mut jugador) = jugadores.iter_mut().next() {
        jugador.play(AnimationNodeIndex::new(0)).repeat().set_speed(4.0);
        *iniciado = true;
    }
}

/// Icono de la ventana X11/Wayland (Bevy 0.16 ya no expone `Window::icon`).
fn poner_icono(
    winit: NonSend<bevy::winit::WinitWindows>,
    ventanas: Query<Entity, With<PrimaryWindow>>,
    server: Res<AssetServer>,
    imagenes: Res<Assets<Image>>,
    mut hecho: Local<bool>,
) {
    if *hecho {
        return;
    }
    let Some(imagen) = imagenes.get(&server.load::<Image>("icono.png")) else {
        return;
    };
    let Ok(icono) =
        winit::window::Icon::from_rgba(imagen.data.clone().unwrap_or_default(), imagen.width(), imagen.height())
    else {
        return;
    };
    let Some(ventana) = ventanas.single().ok().and_then(|e| winit.get_window(e)) else {
        return;
    };
    ventana.set_window_icon(Some(icono));
    *hecho = true;
}

#[cfg(test)]
mod pruebas_edificios {
    use super::*;

    #[test]
    fn fachada_es_modular_sin_costuras() {
        let img = textura_fachada();
        assert_eq!(img.texture_descriptor.size.width, 128);
        assert_eq!(img.texture_descriptor.size.height, 128);
        assert!(img.texture_descriptor.mip_level_count > 1, "cadena de mipmaps");
        let d = img.data.as_ref().unwrap();
        let px = |x: usize, y: usize| -> [u8; 3] {
            let i = (y * 128 + x) * 4;
            [d[i], d[i + 1], d[i + 2]]
        };
        // Sin costuras: los bordes opuestos del módulo son iguales (banda de
        // losa arriba y abajo; muro a los lados de la ventana).
        for k in 0..128 {
            assert_eq!(px(k, 0), px(k, 127), "costura horizontal en x={k}");
            assert_eq!(px(0, k), px(127, k), "costura vertical en y={k}");
        }
        let (mut vidrio, mut muro) = (0usize, 0usize);
        for y in 0..128 {
            for x in 0..128 {
                let [r, g, b] = px(x, y);
                if b > r + 8 && r < 120 {
                    vidrio += 1;
                }
                if r > 230 && g > 225 && b > 215 {
                    muro += 1;
                }
            }
        }
        assert!(vidrio > 2000, "ventanas en la textura: {vidrio}");
        assert!(muro > 3000, "muro en la textura: {muro}");
    }

    #[test]
    fn clasifica_landmarks_y_gatea_por_distancia() {
        let destino = [100.0, 200.0]; // ancla UIS en ENU (la UTS es el origen)
        assert_eq!(
            clasificar(Some("(UIS 9) Facultad de Ciencias Humanas 2"), &[102.0, 201.0], 27.0, &destino),
            Clase::Ocre
        );
        // mismo nombre, pero a 1.6 km de la UIS: no es landmark
        assert_eq!(
            clasificar(Some("(UIS 9) Facultad de Ciencias Humanas 2"), &[1600.0, 200.0], 27.0, &destino),
            Clase::Normal
        );
        assert_eq!(clasificar(Some("Planetario UIS"), &[110.0, 205.0], 8.0, &destino), Clase::Planetario);
        assert_eq!(clasificar(Some("(UIS 8) Casona La Perla"), &[105.0, 195.0], 3.0, &destino), Clase::Casona);
        assert_eq!(clasificar(Some("(UIS 12) Biblioteca"), &[103.0, 202.0], 15.0, &destino), Clase::Herencia);
        // la Biblioteca Pública Gabriel Turbay (1.6 km) no es campus
        assert_eq!(
            clasificar(Some("Biblioteca Pública Gabriel Turbay"), &[1500.0, 200.0], 20.7, &destino),
            Clase::Normal
        );
        assert_eq!(clasificar(None, &[40.0, 10.0], 33.5, &destino), Clase::TorreUts);
        assert_eq!(clasificar(None, &[100.0, 30.0], 17.5, &destino), Clase::Uts);
        assert_eq!(clasificar(None, &[2000.0, 2000.0], 65.0, &destino), Clase::Normal);
        assert_eq!(clasificar(Some("(UIS 35) EDIC"), &[120.0, 210.0], 20.7, &destino), Clase::Institucional);
    }

    #[test]
    fn malla_de_ciudad_lleva_uvs_y_landmarks() {
        let corredor = Corredor::cargar();
        let (malla_opt, colision) = malla_edificios(&corredor);
        let malla = malla_opt.expect("malla de edificios");
        assert!(colision.is_some(), "colisión TriMesh");
        let n_pos = match malla.attribute(Mesh::ATTRIBUTE_POSITION) {
            Some(VertexAttributeValues::Float32x3(v)) => v.len(),
            _ => panic!("sin posiciones"),
        };
        let uvs = match malla.attribute(Mesh::ATTRIBUTE_UV_0) {
            Some(VertexAttributeValues::Float32x2(v)) => v.clone(),
            _ => panic!("sin UVs"),
        };
        assert_eq!(uvs.len(), n_pos, "un UV por vértice");
        let (u_max, v_max) = uvs
            .iter()
            .fold((0.0f32, 0.0f32), |(mu, mv), &[u, v]| (mu.max(u), mv.max(v)));
        assert!(u_max > 4.0, "fachadas anchas repiten bahías (u_max={u_max})");
        assert!(v_max > 1.0, "edificios altos repiten pisos (v_max={v_max})");

        // Los landmarks dejaron su color lineal en los vértices de la malla.
        let cols = match malla.attribute(Mesh::ATTRIBUTE_COLOR) {
            Some(VertexAttributeValues::Float32x4(v)) => v.clone(),
            _ => panic!("sin colores"),
        };
        assert_eq!(cols.len(), n_pos);
        let lin = |s: f32| s.powf(2.2);
        let cuenta = |r: f32, g: f32, b: f32| -> usize {
            cols.iter()
                .filter(|c| (c[0] - r).abs() < 0.02 && (c[1] - g).abs() < 0.02 && (c[2] - b).abs() < 0.02)
                .count()
        };
        assert!(cuenta(lin(0.78), lin(0.58), lin(0.36)) >= 24, "torre ocre UIS");
        assert!(cuenta(lin(0.64), lin(0.46), lin(0.36)) >= 24, "biblioteca en ladrillo");
        assert!(cuenta(lin(0.84), lin(0.80), lin(0.72)) >= 12, "casona crema");
        assert!(cuenta(lin(0.60), lin(0.34), lin(0.24)) >= 6, "teja terracota");
        assert!(cuenta(lin(0.60), lin(0.63), lin(0.68)) >= 100, "cúpula del planetario");
        assert!(cuenta(lin(0.30), lin(0.48), lin(0.72)) >= 16, "coronas azules UTS");
    }
}

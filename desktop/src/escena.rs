//! Escena 3D del corredor UTS→UIS: ortofoto horneada, 718 edificios OSM,
//! dron y cámara perseguidora con colisión contra los edificios.

use bevy::animation::graph::AnimationNodeIndex;
use bevy::animation::AnimationPlayer;
use bevy::pbr::{DistanceFog, FogFalloff};
use bevy::prelude::*;
use bevy::render::mesh::{Indices, PrimitiveTopology};
use bevy::render::render_asset::RenderAssetUsages;
use bevy::window::PrimaryWindow;
use parry3d_f64::math::{Isometry, Point, Vector};
use parry3d_f64::query::{Ray, RayCast};
use parry3d_f64::shape::TriMesh;

use crate::nucleo::{MotorVuelo, ALTITUD_CRUCERO, ALTURA_ANCLA_MSNM};

const LON_UTS: f64 = -73.123524;
const LAT_UTS: f64 = 7.1051164;
const LON_UIS: f64 = -73.1198652;
const LAT_UIS: f64 = 7.1409311;
const MG_LAT: f64 = 111_320.0;
const PASO_MALLA: f64 = 25.0;
const PASO_FONDO: f64 = 120.0;
const MARGEN_BBOX: f64 = 0.009;
const ANCHO_LATERAL: f64 = 300.0;

pub struct EscenaPlugin;

impl Plugin for EscenaPlugin {
    fn build(&self, app: &mut App) {
        let corredor = Corredor::cargar();
        // Ruta con alturas referidas al suelo: con relieve real, un altitud de
        // 50 m sobre el ancla dejaría al dron enterrado al llegar a la UIS.
        let destino = corredor.desplazamiento;
        let suelo_uts = corredor.agl(0.0, 0.0);
        let suelo_uis = corredor.agl(destino[0], destino[1]);
        let ruta = vec![
            [0.0, 0.0, suelo_uts],
            [0.0, 0.0, suelo_uts + ALTITUD_CRUCERO],
            [destino[0], destino[1], suelo_uis + ALTITUD_CRUCERO],
            [destino[0], destino[1], suelo_uis],
        ];
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
            .add_systems(Startup, construir_escena)
            .add_systems(FixedUpdate, avanzar_vuelo)
            .add_systems(Update, (seguir_dron, animar_rotores, poner_icono));
    }
}

/// Estado del vuelo: el motor avanza a paso fijo y el render interpola.
#[derive(Resource)]
pub struct Vuelo {
    pub motor: MotorVuelo,
    pub anterior: [f64; 3],
    pub actual: [f64; 3],
    pub pausado: bool,
}

impl Vuelo {
    fn nuevo(ruta: Vec<[f64; 3]>) -> Self {
        Vuelo {
            motor: MotorVuelo::nuevo(ruta),
            anterior: [0.0; 3],
            actual: [0.0; 3],
            pausado: false,
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
        self.anterior = [0.0; 3];
        self.actual = [0.0; 3];
        self.pausado = false;
    }
}

fn avanzar_vuelo(mut vuelo: ResMut<Vuelo>, tiempo: Res<Time>) {
    if vuelo.pausado {
        return;
    }
    vuelo.motor.iniciar();
    vuelo.anterior = vuelo.actual;
    vuelo.motor.actualizar(tiempo.delta_secs_f64());
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
        let bbox_fondo = Self::cargar_caja("assets/mapa-amplio-caja.json").unwrap_or(bbox_franja);

        Corredor {
            terreno,
            fondo,
            dir,
            lado,
            largo,
            desplazamiento,
            bbox_franja,
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
        let along = este * self.dir[0] + norte * self.dir[1];
        let lateral = este * self.lado[0] + norte * self.lado[1];
        let fino = self.terreno.altura(along, lateral);
        let peso = self.peso_fino(along, lateral);
        if peso >= 1.0 {
            fino
        } else {
            fino * peso + self.fondo.altura(along, lateral) * (1.0 - peso)
        }
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
struct Camara {
    pos: Vec3,
}

impl Default for Camara {
    fn default() -> Self {
        Camara { pos: Vec3::new(0.0, 420.0, 2000.0) }
    }
}

fn construir_escena(
    mut commands: Commands,
    mut mallas: ResMut<Assets<Mesh>>,
    mut materiales: ResMut<Assets<StandardMaterial>>,
    server: Res<AssetServer>,
    corredor: Res<Corredor>,
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

    if std::path::Path::new("assets/mapa-amplio.jpg").exists() {
        commands.spawn((
            Mesh3d(mallas.add(malla_fondo(&corredor))),
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
        commands.spawn((
            Mesh3d(mallas.add(malla)),
            MeshMaterial3d(materiales.add(StandardMaterial {
                base_color: Color::WHITE,
                perceptual_roughness: 0.95,
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
            padre.spawn((
                SceneRoot(escena),
                Transform::from_scale(Vec3::splat(3.0)).with_rotation(Quat::from_euler(
                    EulerRot::XYZ,
                    -std::f32::consts::FRAC_PI_2,
                    std::f32::consts::PI,
                    0.0,
                )),
            ));
        });

    let (vista, objetivo) = vista_amplia(&corredor);
    commands.spawn((
        Camera3d::default(),
        Msaa::Off,
        // Bruma de distancia: da profundidad al corredor de 4 km.
        DistanceFog {
            color: Color::srgb(0.72, 0.78, 0.87),
            falloff: FogFalloff::Linear { start: 900.0, end: 5_500.0 },
            ..default()
        },
        Projection::Perspective(PerspectiveProjection { far: 15_000.0, ..default() }),
        Transform::from_translation(vista).looking_at(objetivo, Vec3::Y),
    ));
    commands.insert_resource(Camara { pos: vista });
}

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
    let filas = (corredor.largo / PASO_MALLA).round().max(8.0) as usize;
    let cols = (2.0 * ANCHO_LATERAL / PASO_MALLA).round().max(4.0) as usize;
    let mut posiciones = Vec::with_capacity((filas + 1) * (cols + 1));
    let mut uvs = Vec::with_capacity((filas + 1) * (cols + 1));
    for fila in 0..=filas {
        let along = corredor.largo * fila as f64 / filas as f64;
        for col in 0..=cols {
            let lateral = -ANCHO_LATERAL + 2.0 * ANCHO_LATERAL * col as f64 / cols as f64;
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
fn malla_fondo(corredor: &Corredor) -> Mesh {
    let (along_min, along_max, lateral_min, lateral_max) = corredor.rango_fondo();
    let filas = ((along_max - along_min) / PASO_FONDO).round().max(4.0) as usize;
    let cols = ((lateral_max - lateral_min) / PASO_FONDO).round().max(4.0) as usize;
    let mut posiciones = Vec::with_capacity((filas + 1) * (cols + 1));
    let mut uvs = Vec::with_capacity((filas + 1) * (cols + 1));
    for fila in 0..=filas {
        let along = along_min + (along_max - along_min) * fila as f64 / filas as f64;
        for col in 0..=cols {
            let lateral = lateral_min + (lateral_max - lateral_min) * col as f64 / cols as f64;
            let [este, norte] = corredor.punto(along, lateral);
            // Un centimetro bajo la franja para que no pelen por la profundidad.
            posiciones.push([
                este as f32,
                corredor.agl(este, norte) as f32 - 0.6,
                norte as f32,
            ]);
            uvs.push(corredor.uv(este, norte, &corredor.bbox_fondo));
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

struct Acumulador {
    posiciones: Vec<[f32; 3]>,
    normales: Vec<[f32; 3]>,
    colores: Vec<[f32; 4]>,
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
            indices: Vec::new(),
            colision_vertices: Vec::new(),
            colision_indices: Vec::new(),
        }
    }

    fn vertice(&mut self, p: [f32; 3], normal: [f32; 3], color: [f32; 4]) -> u32 {
        let indice = self.posiciones.len() as u32;
        self.posiciones.push(p);
        self.normales.push(normal);
        self.colores.push(color);
        indice
    }

    fn triangulo(&mut self, a: u32, b: u32, c: u32) {
        self.indices.extend_from_slice(&[a, b, c]);
    }

    /// Triángulo del techo: además de la malla visual, alimenta la de colisión.
    fn techo(&mut self, puntos: [[f32; 3]; 3], color: [f32; 4]) {
        let inicio = self.colision_vertices.len() as u32;
        let mut ids = [0u32; 3];
        for (k, p) in puntos.iter().enumerate() {
            ids[k] = self.vertice(*p, [0.0, 1.0, 0.0], color);
            self.colision_vertices.push(Point::new(p[0] as f64, p[1] as f64, p[2] as f64));
        }
        self.triangulo(ids[0], ids[1], ids[2]);
        self.colision_indices.push([inicio, inicio + 1, inicio + 2]);
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
        let centro = [
            plano.iter().map(|p| p[0]).sum::<f64>() / plano.len() as f64,
            plano.iter().map(|p| p[1]).sum::<f64>() / plano.len() as f64,
        ];
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
        let alto = feature["properties"]["height"]
            .as_f64()
            .filter(|h| *h > 1.0)
            .or_else(|| {
                feature["properties"]["levels"]
                    .as_f64()
                    .filter(|n| *n > 0.0)
                    .map(|n| n * 3.2 + 1.5)
            })
            .unwrap_or(9.0) as f32;

        let tinte = TINTES[orden % TINTES.len()];
        let color = [
            (BASE[0] * tinte[0]).powf(2.2),
            (BASE[1] * tinte[1]).powf(2.2),
            (BASE[2] * tinte[2]).powf(2.2),
            1.0,
        ];

        for i in 0..plano.len() {
            let j = (i + 1) % plano.len();
            let a = [plano[i][0] as f32, base, plano[i][1] as f32];
            let b = [plano[j][0] as f32, base, plano[j][1] as f32];
            let at = [a[0], base + alto, a[2]];
            let bt = [b[0], base + alto, b[2]];
            let normal = normal_de(a, b, bt);
            let a0 = malla.vertice(a, normal, color);
            let b0 = malla.vertice(b, normal, color);
            let bt0 = malla.vertice(bt, normal, color);
            let at0 = malla.vertice(at, normal, color);
            malla.triangulo(a0, b0, bt0);
            malla.triangulo(a0, bt0, at0);

            let inicio = malla.colision_vertices.len() as u32;
            for p in [a, b, bt, at] {
                malla.colision_vertices.push(Point::new(p[0] as f64, p[1] as f64, p[2] as f64));
            }
            malla.colision_indices.push([inicio, inicio + 1, inicio + 2]);
            malla.colision_indices.push([inicio, inicio + 2, inicio + 3]);
        }

        earcut.earcut_slice(&plano, &[] as &[u32], &mut triangulos);
        for tri in triangulos.chunks_exact(3) {
            let puntos = [
                [plano[tri[0] as usize][0] as f32, base + alto, plano[tri[0] as usize][1] as f32],
                [plano[tri[1] as usize][0] as f32, base + alto, plano[tri[1] as usize][1] as f32],
                [plano[tri[2] as usize][0] as f32, base + alto, plano[tri[2] as usize][1] as f32],
            ];
            malla.techo(puntos, color);
        }
    }

    if malla.posiciones.is_empty() || malla.colision_indices.is_empty() {
        return (None, None);
    }
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, malla.posiciones);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, malla.normales);
    mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, malla.colores);
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

fn animar_rotores(mut jugadores: Query<&mut AnimationPlayer>, mut iniciado: Local<bool>) {
    if *iniciado {
        return;
    }
    if let Some(mut jugador) = jugadores.iter_mut().next() {
        jugador.play(AnimationNodeIndex::new(0)).repeat();
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

//! Simulación del corredor UTS→UIS en Bevy (cliente nativo autónomo).
use bevy::prelude::*;
use bevy_egui::{EguiContexts, EguiPlugin};
use bevy::render::mesh::{Indices, PrimitiveTopology};


mod nucleo;
use nucleo::{ALTURA_ANCLA_MSNM, MotorVuelo};

const ANCHO_CORREDOR: f64 = 4070.0;
const FILAS: usize = 84;
const COLS: usize = 9;
const DIR_E: f64 = 0.0995;
const DIR_N: f64 = 0.9950;

#[derive(Resource)]
struct Vuelo {
    motor: MotorVuelo,
}

fn malla_corredor() -> Mesh {
    let texto = std::fs::read_to_string("assets/alturas-corredor.json")
        .expect("falta assets/alturas-corredor.json");
    let valores = serde_json::from_str::<serde_json::Value>(&texto).expect("json de alturas invalido");
    let datos = valores["datos"].as_array().expect("sin datos");
    let alto_ij = |i: usize, j: usize| -> f64 {
        for d in datos {
            if d[0].as_u64() == Some(i as u64) && d[1].as_u64() == Some(j as u64) {
                if let Some(h) = d[2].as_f64() {
                    return h;
                }
            }
        }
        ALTURA_ANCLA_MSNM
    };

    let mut posiciones: Vec<[f32; 3]> = vec![];
    let mut uvs: Vec<[f32; 2]> = vec![];
    let mut indices: Vec<u32> = vec![];
    for fila in 0..FILAS {
        for col in 0..COLS {
            let along = ANCHO_CORREDOR * fila as f64 / (FILAS - 1) as f64;
            let lateral = -300.0 + 600.0 * col as f64 / (COLS - 1) as f64;
            let este = DIR_E * along - DIR_N * lateral;
            let norte = DIR_N * along + DIR_E * lateral;
            let i_idx = (along / 50.0).round() as usize;
            let j_idx = ((lateral + 150.0) / 75.0).round() as usize;
            let j_idx = j_idx.min(4);
            let y = ((alto_ij(i_idx, j_idx) - ALTURA_ANCLA_MSNM) as f32).max(-3.0);
            posiciones.push([este as f32, y, norte as f32]);
            uvs.push([col as f32 / (COLS - 1) as f32, 1.0 - fila as f32 / (FILAS - 1) as f32]);
        }
    }
    for fila in 0..FILAS - 1 {
        for col in 0..COLS - 1 {
            let a = (fila * COLS + col) as u32;
            let b = a + 1;
            let c = a + COLS as u32;
            let d = c + 1;
            indices.extend_from_slice(&[a, c, b, b, c, d]);
        }
    }
    let mut malla = Mesh::new(PrimitiveTopology::TriangleList, bevy::render::render_asset::RenderAssetUsages::default());
    malla.insert_attribute(Mesh::ATTRIBUTE_POSITION, posiciones);
    malla.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    malla.insert_indices(Indices::U32(indices));
    malla
}

/// Cámara en encuadre amplio al startup.
fn construir_escena(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materiales: ResMut<Assets<StandardMaterial>>,
    server: Res<AssetServer>,
) {
    commands.spawn(DirectionalLight { illuminance: 12000.0, shadows_enabled: false, ..default() });
    commands.spawn((
        AmbientLight { color: Color::srgb_u8(200, 220, 255), brightness: 900.0, affects_lightmapped_meshes: true },
        Transform::from_xyz(0.0, 400.0, 0.0),
    ));
    let malla = malla_corredor();
    let textura: Handle<Image> = server.load("corredor-satelital.jpg");
    let material = StandardMaterial {
        base_color_texture: Some(textura),
        cull_mode: None,
        unlit: true,
        metallic: 0.0,
        reflectance: 0.0,
        ..default()
    };
    commands.spawn((
        Mesh3d(meshes.add(malla)),
        MeshMaterial3d(materiales.add(material)),
    ));
    // Cámara amplia sobre el corredor.
    commands.spawn((
        Camera3d::default(),
        Transform::from_xyz(150.0, 260.0, -180.0).looking_at(Vec3::new(0.0, 0.0, 2000.0), Vec3::Y),
    ));
    commands.insert_resource(Vuelo { motor: MotorVuelo::nuevo(vec![
        [0.0, 0.0, 0.0],
        [0.0, 0.0, 50.0],
        [405.79, 4053.6, 50.0],
        [405.79, 4053.6, 0.0],
    ]) });
}

fn avanzar_vuelo(mut vuelo: ResMut<Vuelo>, tiempo: Res<Time>) {
    vuelo.motor.iniciar();
    let dt = tiempo.delta_secs_f64();
    vuelo.motor.actualizar(dt.min(0.1));
}

fn panel_telemetria(mut contexts: EguiContexts, mut vuelo: ResMut<Vuelo>) {
    let ctx = contexts.ctx_mut().expect("egui ctx");
    let m = vuelo.motor.telemetria();
    egui::TopBottomPanel::bottom("telemetria").show(ctx, |ui| {
        ui.add_space(6.0);
        ui.horizontal(|ui| {
            if ui.button("Iniciar vuelo").clicked() { vuelo.motor.iniciar(); }
            if ui.button("Reiniciar").clicked() { vuelo.motor.reiniciar(); }
            ui.separator();
            ui.monospace(format!("t {:>5.1} s", m.t));
            ui.monospace(format!("vel {:>5.1} m/s", m.velocidad_total));
            ui.monospace(format!("alt {:>5.1} m", m.altitud_agl));
            ui.monospace(format!("bat {:>5.1} %", m.bateria_porcentaje));
        });
        ui.add_space(4.0);
    });
}

fn main() {
    App::new()
        .add_plugins((
            DefaultPlugins.set(WindowPlugin {
                primary_window: Some(Window {
                    title: "Dron UTS → UIS (Bevy nativo)".into(),
                    resolution: (1280.0_f32, 720.0).into(),
                    ..default()
                }),
                ..default()
            }),
            EguiPlugin::default(),
        ))
        .add_systems(Startup, construir_escena)
        .add_systems(FixedUpdate, avanzar_vuelo)
        .add_systems(PostUpdate, panel_telemetria)
        .insert_resource(Time::<Fixed>::from_hz(30.0))
        .run();
}

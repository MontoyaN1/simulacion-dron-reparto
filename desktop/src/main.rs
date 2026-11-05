//! Estación de control del dron UTS → UIS (cliente nativo Bevy).

use bevy::image::ImageSamplerDescriptor;
use bevy::prelude::*;
use bevy::render::texture::ImagePlugin;
use bevy::render::view::screenshot::{save_to_disk, Screenshot};
use bevy_egui::{EguiContexts, EguiPlugin};

mod escena;
mod nucleo;

use escena::{Camara, Corredor, EscenaPlugin, Vuelo};
use nucleo::Fase;

const FONDO: egui::Color32 = egui::Color32::from_rgb(11, 18, 32);
const ACENTO: egui::Color32 = egui::Color32::from_rgb(56, 189, 248);
const TEXTO: egui::Color32 = egui::Color32::from_rgb(226, 232, 240);
const TENUE: egui::Color32 = egui::Color32::from_rgb(100, 116, 139);

fn main() {
    // Anisotropía 16: sin ella la ortofoto se ve en bloques al verla de
    // canto (la cámara de persecución vuela a pocos metros del mapa).
    let sampler = ImageSamplerDescriptor {
        anisotropy_clamp: 16,
        ..ImageSamplerDescriptor::linear()
    };
    App::new()
        .add_plugins((
            DefaultPlugins
                .set(WindowPlugin {
                    primary_window: Some(Window {
                        title: "Dron UTS → UIS · Estación de control".into(),
                        name: Some("dron-reparto-desktop".into()),
                        resolution: (1280.0_f32, 720.0).into(),
                        resize_constraints: WindowResizeConstraints {
                            min_width: 960.0,
                            min_height: 540.0,
                            ..default()
                        },
                        ..default()
                    }),
                    ..default()
                })
                .set(ImagePlugin { default_sampler: sampler }),
            EguiPlugin::default(),
            EscenaPlugin,
        ))
        .insert_resource(ClearColor(Color::srgb(0.72, 0.78, 0.87)))
        .insert_resource(Time::<Fixed>::from_hz(1.0 / nucleo::DT_FIJO))
        .add_systems(bevy_egui::EguiPrimaryContextPass, hud)
        .add_systems(Update, (captura, fps_promedio))
        .run();
}

fn nombre_fase(fase: Fase) -> &'static str {
    match fase {
        Fase::Inactivo => "EN TIERRA",
        Fase::Despegue => "DESPEGUE",
        Fase::Crucero => "CRUCERO",
        Fase::Descenso => "DESCENSO",
        Fase::Entregado => "ENTREGADO",
    }
}

fn metrica(ui: &mut egui::Ui, titulo: &str, valor: String) {
    ui.vertical(|ui| {
        ui.label(egui::RichText::new(titulo).color(TENUE).size(10.0).strong());
        ui.label(egui::RichText::new(valor).color(TEXTO).monospace().size(20.0));
    });
    ui.add_space(26.0);
}

fn hud(
    mut contexts: EguiContexts,
    mut vuelo: ResMut<Vuelo>,
    corredor: Res<Corredor>,
    mut camara: ResMut<Camara>,
    tiempo: Res<Time>,
) {
    let ctx = contexts.ctx_mut().expect("egui ctx");
    let m = vuelo.motor.telemetria();
    // Altura real sobre el terreno (no sobre el ancla).
    let sobre_suelo = m.posicion[2] - corredor.agl(m.posicion[0], m.posicion[1]);

    egui::TopBottomPanel::top("barra")
        .frame(egui::Frame::NONE.fill(FONDO).inner_margin(egui::Margin::symmetric(16, 9)))
        .show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.label(egui::RichText::new("DRON · UTS → UIS").color(TEXTO).strong().size(16.0));
                ui.add_space(10.0);
                ui.label(egui::RichText::new(nombre_fase(m.fase)).color(ACENTO).monospace().size(12.0));
                ui.add_space(14.0);
                if camara.libre {
                    ui.label(
                        egui::RichText::new("CÁMARA LIBRE")
                            .color(egui::Color32::from_rgb(251, 191, 36))
                            .monospace()
                            .size(12.0),
                    );
                    if ui.button("SEGUIR DRON").clicked() {
                        camara.libre = false;
                    }
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui.button("Reiniciar").clicked() {
                        vuelo.reiniciar();
                    }
                    let etiqueta = if vuelo.pausado { "Reanudar" } else { "Pausar" };
                    if ui.button(etiqueta).clicked() {
                        vuelo.pausado = !vuelo.pausado;
                    }
                    ui.label(
                        egui::RichText::new(format!("{:.0} fps", 1.0 / tiempo.delta_secs().max(1e-4)))
                            .color(TENUE)
                            .monospace(),
                    );
                });
            });
        });

    egui::TopBottomPanel::bottom("telemetria")
        .frame(egui::Frame::NONE.fill(FONDO).inner_margin(egui::Margin::symmetric(16, 10)))
        .show(ctx, |ui| {
            ui.horizontal(|ui| {
                metrica(ui, "ALTITUD", format!("{sobre_suelo:.1} m"));
                metrica(ui, "VELOCIDAD", format!("{:.1} m/s", m.velocidad_total));
                metrica(ui, "BATERÍA", format!("{:.0} %", m.bateria_porcentaje));
                metrica(ui, "RESTANTE", format!("{:.0} m", m.dist_restante));
                metrica(ui, "RUMBO", format!("{:.0}°", m.rumbo_grados));
                metrica(ui, "TIEMPO", format!("{:.1} s", m.t));
                metrica(ui, "RECORRIDO", format!("{:.0} m", m.dist_recorrida));
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(
                        egui::RichText::new("arrastra: orbitar · rueda: zoom · R: seguir dron")
                            .color(TENUE)
                            .size(11.0),
                    );
                });
                ui.vertical(|ui| {
                    ui.add_space(4.0);
                    ui.add(
                        egui::ProgressBar::new(m.progreso as f32)
                            .desired_width(230.0)
                            .fill(ACENTO)
                            .text(format!("{:.0} % del corredor", m.progreso * 100.0)),
                    );
                });
            });
            ui.add_space(2.0);
        });
}

/** Con `FPS=1` imprime el fps medio cada 5 s (para medir sin mirar el HUD). */
fn fps_promedio(tiempo: Res<Time>, mut acum: Local<f32>, mut n: Local<u32>) {
    if std::env::var("FPS").is_err() {
        return;
    }
    *acum += tiempo.delta_secs();
    *n += 1;
    if *acum >= 5.0 {
        println!("fps prom {0:.1}", *n as f32 / *acum);
        *acum = 0.0;
        *n = 0;
    }
}

/// Con `CAPTURA=1` guarda tres fotogramas del vuelo en `capturas/`.
fn captura(mut commands: Commands, mut hechos: Local<Vec<u8>>, tiempo: Res<Time>) {
    if std::env::var("CAPTURA").is_err() {
        return;
    }
    let marcas: [(f32, &str); 3] = [(1.6, "01-presentacion"), (8.0, "02-despegue"), (30.0, "03-crucero")];
    for (indice, (marca, nombre)) in marcas.into_iter().enumerate() {
        if tiempo.elapsed_secs() > marca && !hechos.contains(&(indice as u8)) {
            hechos.push(indice as u8);
            let ruta = format!("capturas/{nombre}.png");
            commands
                .spawn(Screenshot::primary_window())
                .observe(save_to_disk(ruta));
        }
    }
}

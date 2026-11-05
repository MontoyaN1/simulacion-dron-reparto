//! Estación de control del dron UTS → UIS (cliente nativo Bevy).

use bevy::image::ImageSamplerDescriptor;
use bevy::prelude::*;
use bevy::render::texture::ImagePlugin;
use bevy::render::view::screenshot::{save_to_disk, Screenshot};
use bevy_egui::{EguiContexts, EguiPlugin};

mod escena;
mod matematica;
mod nucleo;

use escena::{Camara, Corredor, EscenaPlugin, VelSim, Vuelo};
use matematica::{vec3, LiveAlgebra, Mat3};
use nucleo::{Fase, MuestraTelemetria};

const FONDO: egui::Color32 = egui::Color32::from_rgb(11, 18, 32);
const ACENTO: egui::Color32 = egui::Color32::from_rgb(56, 189, 248);
const TEXTO: egui::Color32 = egui::Color32::from_rgb(226, 232, 240);
const TENUE: egui::Color32 = egui::Color32::from_rgb(100, 116, 139);
const ELEVADO: egui::Color32 = egui::Color32::from_rgb(19, 28, 44);
const AMBAR: egui::Color32 = egui::Color32::from_rgb(251, 191, 36);
// Mismo sistema de color que la versión web (valores pre-multiplicados).
const TARJETA: egui::Color32 = egui::Color32::from_rgba_premultiplied(13, 22, 34, 209);
const BORDE: egui::Color32 = egui::Color32::from_rgba_premultiplied(24, 26, 30, 41);
const VERDE: egui::Color32 = egui::Color32::from_rgb(34, 197, 94);
const VIVO: egui::Color32 = egui::Color32::from_rgb(125, 211, 252);
const CELDA: egui::Color32 = egui::Color32::from_rgb(203, 230, 247);
const VERDE_FILAFONDO: egui::Color32 = egui::Color32::from_rgba_premultiplied(2, 10, 5, 13);
const VERDE_FILABORDE: egui::Color32 = egui::Color32::from_rgba_premultiplied(6, 36, 17, 46);
const VERDE_CHIPFONDO: egui::Color32 = egui::Color32::from_rgba_premultiplied(4, 24, 11, 31);
const VERDE_CHIPBORDE: egui::Color32 = egui::Color32::from_rgba_premultiplied(12, 69, 33, 90);
const CIAN_FONDO: egui::Color32 = egui::Color32::from_rgba_premultiplied(7, 23, 30, 31);
const CIAN_BORDE: egui::Color32 = egui::Color32::from_rgba_premultiplied(22, 76, 100, 102);
const CIAN_TEXTO: egui::Color32 = egui::Color32::from_rgb(186, 230, 253);
const VERDE_TEXTO: egui::Color32 = egui::Color32::from_rgb(134, 239, 172);
const CUADRO_MATRIZ: egui::Color32 = egui::Color32::from_rgba_premultiplied(3, 5, 9, 140);

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

/// Color de la fase: gris en tierra, ámbar en transiciones, verde en crucero.
fn fase_color(fase: Fase) -> egui::Color32 {
    match fase {
        Fase::Inactivo => TENUE,
        Fase::Despegue | Fase::Descenso => AMBAR,
        Fase::Crucero => VERDE,
        Fase::Entregado => ACENTO,
    }
}

/// Marca de la casa: el cuadricóptero de la versión web, dibujado.
fn marca_dron(ui: &mut egui::Ui, tam: f32, color: egui::Color32) {
    let (rect, _resp) = ui.allocate_exact_size(egui::vec2(tam, tam), egui::Sense::hover());
    let p = ui.painter();
    let pt = |x: f32, y: f32| rect.left_top() + egui::vec2(x * tam / 24.0, y * tam / 24.0);
    let trazo = egui::Stroke::new(1.6 * tam / 20.0, color);
    for (x, y) in [(5.0, 5.0), (19.0, 5.0), (5.0, 19.0), (19.0, 19.0)] {
        p.circle_stroke(pt(x, y), 2.6 * tam / 20.0, trazo);
    }
    p.line_segment([pt(7.0, 7.0), pt(17.0, 17.0)], trazo);
    p.line_segment([pt(17.0, 7.0), pt(7.0, 17.0)], trazo);
    p.rect_filled(
        egui::Rect::from_two_pos(pt(10.4, 10.4), pt(13.6, 13.6)),
        0.8 * tam / 20.0,
        color,
    );
}

/// Botón con los tokens del proyecto; `activo` lo rellena del acento.
fn boton(ui: &mut egui::Ui, texto: &str, activo: bool) -> bool {
    ui.add(
        egui::Button::new(
            egui::RichText::new(texto)
                .color(if activo { FONDO } else { TEXTO })
                .monospace()
                .size(11.5),
        )
        .fill(if activo { ACENTO } else { ELEVADO })
        .stroke(egui::Stroke::new(
            1.0_f32,
            if activo { ACENTO } else { BORDE },
        ))
        .corner_radius(4.0),
    )
    .clicked()
}

fn metrica(ui: &mut egui::Ui, titulo: &str, valor: &str) {
    ui.vertical(|ui| {
        ui.label(egui::RichText::new(titulo).color(TENUE).size(10.0).strong());
        ui.label(egui::RichText::new(valor).color(TEXTO).monospace().size(20.0));
    });
}

/// Datos fijos de la ruta y del marco ENU (se calculan una sola vez).
struct DatosRuta {
    edificios: u32,
    bloquean: u32,
    waypoints: u32,
    desvio: f64,
    distancia: f64,
    rumbo: f64,
    escala: f64,
    destino: [f64; 2],
    dir_h: [f64; 3],
    matriz: Mat3,
}

fn datos_ruta(corredor: &Corredor, vuelo: &Vuelo) -> DatosRuta {
    let (edificios, bloquean) = escena::contar_edificios(corredor);
    let ruta = &vuelo.ruta;
    let mut total = 0.0;
    for i in 1..ruta.len() {
        total += nucleo::distancia(&ruta[i - 1], &ruta[i]);
    }
    let recta = nucleo::distancia(&ruta[0], &ruta[ruta.len() - 1]);
    let [dx, dn] = corredor.desplazamiento;
    let dist = corredor.largo;
    DatosRuta {
        edificios,
        bloquean,
        waypoints: ruta.len() as u32,
        desvio: if recta > 0.0 {
            (total / recta - 1.0) * 100.0
        } else {
            0.0
        },
        distancia: dist,
        rumbo: (dx.atan2(dn) * 180.0 / std::f64::consts::PI + 360.0) % 360.0,
        escala: dist / matematica::ACADEMICO_NORM,
        destino: [
            dx * matematica::ACADEMICO_NORM / dist,
            dn * matematica::ACADEMICO_NORM / dist,
        ],
        dir_h: [dx / dist, dn / dist, 0.0],
        matriz: matematica::matriz_enu(escena::LAT_UTS, escena::LON_UTS),
    }
}

fn hud(
    mut contexts: EguiContexts,
    mut vuelo: ResMut<Vuelo>,
    corredor: Res<Corredor>,
    mut camara: ResMut<Camara>,
    mut vel: ResMut<VelSim>,
    tiempo: Res<Time>,
    mut datos: Local<Option<DatosRuta>>,
    mut abierto: Local<Option<bool>>,
) {
    let ctx = contexts.ctx_mut().expect("egui ctx");
    let m = vuelo.motor.telemetria();
    // Altura real sobre el terreno (no sobre el ancla).
    let sobre_suelo = m.posicion[2] - corredor.agl(m.posicion[0], m.posicion[1]);

    let panel_abierto = abierto.unwrap_or(true);
    let mut toggle = ctx.input(|i| i.key_pressed(egui::Key::M));

    if panel_abierto {
        egui::SidePanel::left("modelo")
            .default_width(370.0)
            .min_width(320.0)
            .max_width(560.0)
            .resizable(true)
            .frame(egui::Frame::NONE.fill(FONDO).stroke(egui::Stroke::new(1.0_f32, BORDE)))
            .show(ctx, |ui| {
                panel_modelo(ui, &m, datos.get_or_insert_with(|| datos_ruta(&corredor, &vuelo)))
            });
    }

    egui::TopBottomPanel::top("barra")
        .frame(
            egui::Frame::NONE
                .fill(FONDO)
                .stroke(egui::Stroke::new(1.0_f32, BORDE))
                .inner_margin(egui::Margin::symmetric(16, 9)),
        )
        .show(ctx, |ui| {
            ui.horizontal(|ui| {
                marca_dron(ui, 20.0, TEXTO);
                ui.add_space(10.0);
                ui.label(
                    egui::RichText::new("DRON · UTS → UIS")
                        .color(TEXTO)
                        .strong()
                        .size(16.0),
                );
                ui.add_space(10.0);
                // Chip de fase: punto + etiqueta, como la versión web.
                let fc = fase_color(m.fase);
                ui.horizontal(|ui| {
                    let (_id, r) = ui.allocate_space(egui::vec2(8.0, 14.0));
                    ui.painter()
                        .circle_filled(egui::pos2(r.min.x + 4.0, r.min.y + 7.0), 3.0, fc);
                    ui.label(
                        egui::RichText::new(nombre_fase(m.fase)).color(fc).monospace().size(12.0),
                    );
                });
                ui.add_space(14.0);
                if camara.libre {
                    ui.label(
                        egui::RichText::new("CÁMARA LIBRE")
                            .color(AMBAR)
                            .monospace()
                            .size(12.0),
                    );
                    if boton(ui, "SEGUIR DRON", false) {
                        camara.libre = false;
                    }
                }
                // Velocidad de la simulación.
                ui.add_space(18.0);
                ui.label(egui::RichText::new("SIM").color(TENUE).strong().size(10.0));
                ui.add_space(5.0);
                for v in [1u32, 2, 4, 8, 16] {
                    if boton(ui, &format!("{v}×"), vel.0 == v) {
                        vel.0 = v;
                    }
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(
                        egui::RichText::new(format!(
                            "{:.0} fps",
                            1.0 / tiempo.delta_secs().max(1e-4)
                        ))
                        .color(TENUE)
                        .monospace(),
                    );
                    let etiqueta = if vuelo.pausado { "Reanudar" } else { "Pausar" };
                    if boton(ui, etiqueta, false) {
                        vuelo.pausado = !vuelo.pausado;
                    }
                    if boton(ui, "Reiniciar", false) {
                        vuelo.reiniciar();
                    }
                    if boton(ui, "MODELO", panel_abierto) {
                        toggle = true;
                    }
                });
            });
        });
    if toggle {
        *abierto = Some(!panel_abierto);
    }

    let metricas = [
        ("ALTITUD", format!("{sobre_suelo:.1} m")),
        ("VELOCIDAD", format!("{:.1} m/s", m.velocidad_total)),
        ("BATERÍA", format!("{:.0} %", m.bateria_porcentaje)),
        ("RESTANTE", format!("{:.0} m", m.dist_restante)),
        ("RUMBO", format!("{:.0}°", m.rumbo_grados)),
        ("TIEMPO", format!("{:.1} s", m.t)),
        ("RECORRIDO", format!("{:.0} m", m.dist_recorrida)),
    ];
    egui::TopBottomPanel::bottom("telemetria")
        .frame(
            egui::Frame::NONE
                .fill(FONDO)
                .stroke(egui::Stroke::new(1.0_f32, BORDE))
                .inner_margin(egui::Margin::symmetric(16, 10)),
        )
        .show(ctx, |ui| {
            ui.horizontal(|ui| {
                for (i, (clave, valor)) in metricas.iter().enumerate() {
                    if i > 0 {
                        ui.add(egui::Separator::default().vertical());
                        ui.add_space(16.0);
                    }
                    metrica(ui, clave, valor);
                    ui.add_space(18.0);
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(
                        egui::RichText::new(
                            "arrastra: orbitar · rueda: zoom · R: seguir dron · M: modelo",
                        )
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

/// Panel "Modelo matemático": la misma información que la versión web
/// (ruta real, matriz ENU y los 11 temas del proyecto), calculada en vivo.
fn panel_modelo(ui: &mut egui::Ui, m: &MuestraTelemetria, d: &DatosRuta) {
    ui.add_space(12.0);
    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("MODELO MATEMÁTICO")
                .color(TEXTO)
                .strong()
                .size(14.0),
        );
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            chip(ui, "EN VIVO", Some(CIAN_FONDO), CIAN_BORDE, CIAN_TEXTO);
        });
    });
    ui.add_space(10.0);
    let a = matematica::algebra_en_vivo(&m.posicion, &m.vel, &d.matriz, &d.dir_h);
    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            tarjeta_ruta(ui, d);
            ui.add_space(12.0);
            tarjeta_matriz(ui, &a, &d.matriz);
            ui.add_space(12.0);
            tarjeta_temas(ui, &a);
        });
    ui.add_space(12.0);
}

/// Marco con el fondo y el borde de la versión web.
fn cuadro(ui: &mut egui::Ui, contenido: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::new()
        .fill(TARJETA)
        .stroke(egui::Stroke::new(1.0_f32, BORDE))
        .corner_radius(12.0)
        .inner_margin(egui::Margin::same(14))
        .show(ui, contenido);
}

fn cabeza(ui: &mut egui::Ui, titulo: &str, etiqueta: &str, verde: bool) {
    ui.horizontal(|ui| {
        ui.label(egui::RichText::new(titulo).color(TEXTO).strong().size(13.5));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            chip(
                ui,
                etiqueta,
                if verde { Some(VERDE_CHIPFONDO) } else { None },
                if verde { VERDE_CHIPBORDE } else { BORDE },
                if verde { VERDE_TEXTO } else { TENUE },
            );
        });
    });
    ui.add_space(10.0);
}

fn chip(
    ui: &mut egui::Ui,
    texto: &str,
    fill: Option<egui::Color32>,
    borde: egui::Color32,
    color: egui::Color32,
) {
    egui::Frame::new()
        .fill(fill.unwrap_or(egui::Color32::TRANSPARENT))
        .stroke(egui::Stroke::new(1.0_f32, borde))
        .corner_radius(999.0)
        .inner_margin(egui::Margin {
            left: 9,
            right: 9,
            top: 4,
            bottom: 4,
        })
        .show(ui, |ui| {
            ui.label(egui::RichText::new(texto).color(color).monospace().size(9.5));
        });
}

/// Fila "clave — valor" (el valor va a la derecha, en monoespaciada).
fn hecho(ui: &mut egui::Ui, clave: &str, valor: &str) {
    ui.horizontal(|ui| {
        ui.label(egui::RichText::new(clave).color(TENUE).size(11.0));
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Max), |ui| {
            ui.label(egui::RichText::new(valor).color(TEXTO).monospace().size(11.0));
        });
    });
    ui.add_space(5.0);
}

fn tarjeta_ruta(ui: &mut egui::Ui, d: &DatosRuta) {
    cuadro(ui, |ui| {
        cabeza(ui, "Ruta real", "perfil realista", false);
        hecho(ui, "Distancia", &format!("{:.2} km", d.distancia / 1000.0));
        hecho(ui, "Rumbo", &format!("{:.2}°", d.rumbo));
        hecho(ui, "Escala académica", &format!("{:.1} m/u", d.escala));
        hecho(
            ui,
            "Destino académico",
            &format!("({:.3}, {:.3}, 0.000)", d.destino[0], d.destino[1]),
        );
        hecho(ui, "Edificios OSM", &d.edificios.to_string());
        hecho(ui, "Bloquean el crucero", &d.bloquean.to_string());
        hecho(ui, "Waypoints", &format!("{} · desvío {:.2} %", d.waypoints, d.desvio));
    });
}

fn tarjeta_matriz(ui: &mut egui::Ui, a: &LiveAlgebra, matriz: &Mat3) {
    cuadro(ui, |ui| {
        cabeza(ui, "Matriz ENU", "T(x) = R·x", false);
        egui::Frame::new()
            .fill(CUADRO_MATRIZ)
            .stroke(egui::Stroke::new(1.0_f32, BORDE))
            .corner_radius(10.0)
            .inner_margin(egui::Margin::same(12))
            .show(ui, |ui| {
                for fila in 0..3 {
                    ui.horizontal(|ui| {
                        for col in 0..3 {
                            ui.add_sized(
                                [76.0, 16.0],
                                egui::Label::new(
                                    egui::RichText::new(format!("{:>11.5}", matriz[fila][col]))
                                        .color(CELDA)
                                        .monospace()
                                        .size(10.5),
                                ),
                            );
                            ui.add_space(4.0);
                        }
                    });
                    ui.add_space(3.0);
                }
            });
        ui.add_space(10.0);
        hecho(ui, "det(R)", &format!("{:.5}", a.rot_det));
        hecho(ui, "Rango", &a.rot_rank.to_string());
        hecho(ui, "ker(R)", "{(0, 0, 0)}");
        ui.add_space(6.0);
        ui.label(
            egui::RichText::new(
                "Rotación ortonormal: isomorfismo entre ECEF y ENU. Es la transformación lineal que el panel usa en vivo.",
            )
            .color(TENUE)
            .size(10.0),
        );
    });
}

/// Fila de tema: punto verde, nombre, detalle y valor en vivo.
fn tema(ui: &mut egui::Ui, nombre: &str, detalle: &str, valor: &str) {
    egui::Frame::new()
        .fill(VERDE_FILAFONDO)
        .stroke(egui::Stroke::new(1.0_f32, VERDE_FILABORDE))
        .corner_radius(9.0)
        .inner_margin(egui::Margin {
            left: 8,
            right: 8,
            top: 6,
            bottom: 6,
        })
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                let (_id, r) = ui.allocate_space(egui::vec2(6.0, 34.0));
                ui.painter()
                    .circle_filled(egui::pos2(r.min.x + 3.0, r.min.y + 3.0), 3.0, VERDE);
                ui.add_space(8.0);
                ui.vertical(|ui| {
                    ui.label(egui::RichText::new(nombre).color(TEXTO).size(11.5));
                    ui.label(egui::RichText::new(detalle).color(TENUE).monospace().size(9.5));
                    ui.label(egui::RichText::new(valor).color(VIVO).monospace().size(10.5));
                });
            });
        });
    ui.add_space(6.0);
}

fn tarjeta_temas(ui: &mut egui::Ui, a: &LiveAlgebra) {
    cuadro(ui, |ui| {
        cabeza(ui, "Parámetros importantes", "11 de 11 en vivo", true);
        // Los 11 temas del proyecto, con las mismas etiquetas que la web.
        // Nota: sin circunflejos combinantes (la fuente no los trae).
        tema(
            ui,
            "Vectores",
            "p = (x, y, z) y su norma",
            &format!("‖p‖ = {:.1} m", a.dist_origen),
        );
        tema(
            ui,
            "Recta paramétrica y cartesiana",
            "L(t) = p + t·ĥ",
            &format!("ĥ = {}", vec3(&a.rumbo_vec, 3)),
        );
        tema(
            ui,
            "Ecuación del plano",
            "z = h del crucero",
            &format!("z = {:.1} m", a.altitude),
        );
        tema(
            ui,
            "Producto interno y norma",
            "v · n con n = (0, 1, 0)",
            &format!(
                "{:.2} m/s · rumbo {:.1}°",
                a.norte_dot, a.rumbo_grados
            ),
        );
        tema(
            ui,
            "Proyecciones ortogonales",
            "P·p sobre z = 0",
            &vec3(&a.ground, 1),
        );
        tema(
            ui,
            "Espacios y subespacios",
            "H = {v : v_z = 0}",
            "dim H = 2 · plano xy",
        );
        tema(
            ui,
            "Espacio generado",
            "span{ĥ, r, k}",
            &format!("dim = {} · det = {:.3}", a.dir_rank, a.dir_det),
        );
        tema(
            ui,
            "Combinaciones lineales",
            "p = a·ĥ + b·r + c·k",
            &format!(
                "a = {:.1} · b = {:.1} · c = {:.1}",
                a.along, a.lateral, a.altitude
            ),
        );
        tema(
            ui,
            "Transformaciones lineales",
            "T(v) = R·v en ENU",
            &format!("‖R·v‖ = {:.2} m/s = ‖v‖", a.vel_rotada),
        );
        tema(
            ui,
            "Núcleo e imagen",
            "ker P = ⟨k⟩ · Im P = plano xy",
            "nulidad 1 · rango 2",
        );
        tema(
            ui,
            "Matriz, rango e isomorfismo",
            "R ortonormal",
            &format!("rango {} · det {:.3}", a.rot_rank, a.rot_det),
        );
    });
}

/** Con `FPS=1` imprime el fps medio y el tiempo de simulación cada 5 s. */
fn fps_promedio(tiempo: Res<Time>, vuelo: Res<Vuelo>, mut acum: Local<f32>, mut n: Local<u32>) {
    if std::env::var("FPS").is_err() {
        return;
    }
    *acum += tiempo.delta_secs();
    *n += 1;
    if *acum >= 5.0 {
        println!(
            "fps prom {0:.1} · t {1:.0} s",
            *n as f32 / *acum,
            vuelo.motor.telemetria().t
        );
        *acum = 0.0;
        *n = 0;
    }
}

/// Con `CAPTURA=1` guarda tres fotogramas del vuelo en `capturas/`.
fn captura(
    mut commands: Commands,
    mut hechos: Local<Vec<u8>>,
    tiempo: Res<Time>,
    vel: Res<VelSim>,
) {
    if std::env::var("CAPTURA").is_err() {
        return;
    }
    // Marcas en tiempo de simulación; en muro se comprimen por la velocidad
    // (con un piso de 1.2 s para que la escena alcance a construirse).
    let marcas: [(f32, &str); 4] = [
        (3.0, "01-presentacion"),
        (60.0, "02-despegue"),
        (150.0, "03-crucero"),
        (262.0, "04-uis"),
    ];
    for (indice, (marca, nombre)) in marcas.into_iter().enumerate() {
        if tiempo.elapsed_secs() > (marca / vel.0 as f32).max(1.2)
            && !hechos.contains(&(indice as u8))
        {
            hechos.push(indice as u8);
            let ruta = format!("capturas/{nombre}.png");
            commands
                .spawn(Screenshot::primary_window())
                .observe(save_to_disk(ruta));
        }
    }
}

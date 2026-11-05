//! Modelo matemático en vivo del proyecto: vectores, subespacios y
//! transformaciones lineales, con la misma definición que la versión de
//! referencia (`liveAlgebra` en shared).

/// Matriz 3×3 (filas).
pub type Mat3 = [[f64; 3]; 3];

/// Norma del desplazamiento académico UTS→UIS (√20).
pub const ACADEMICO_NORM: f64 = 4.47213595499958;

/// Rotación ECEF→ENU con origen en (lat, lon) en grados.
pub fn matriz_enu(lat: f64, lon: f64) -> Mat3 {
    let (la, lo) = (lat.to_radians(), lon.to_radians());
    let (sl, cl) = (la.sin(), la.cos());
    let (so, co) = (lo.sin(), lo.cos());
    [[-so, co, 0.0], [-sl * co, -sl * so, cl], [cl * co, cl * so, sl]]
}

/// Determinante de una 3×3.
pub fn det3(m: &Mat3) -> f64 {
    let (a, b, c) = (&m[0], &m[1], &m[2]);
    a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])
}

/// Rango por menores: 3 si det ≠ 0, 2 si algún menor 2×2 es ≠ 0, si no 1.
pub fn rango3(m: &Mat3) -> u32 {
    if det3(m).abs() > 1e-9 {
        return 3;
    }
    for i in 0..3 {
        for k in (i + 1)..3 {
            for j in 0..3 {
                for l in (j + 1)..3 {
                    if (m[i][j] * m[k][l] - m[i][l] * m[k][j]).abs() > 1e-9 {
                        return 2;
                    }
                }
            }
        }
    }
    1
}

/// Producto matriz × vector.
pub fn mul_mv(m: &Mat3, v: &[f64; 3]) -> [f64; 3] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

fn norma(v: &[f64; 3]) -> f64 {
    (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt()
}

fn punto(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// Velocidad mínima (m/s) para que la velocidad defina el rumbo.
const MIN_RUMBO: f64 = 0.25;

/// Dirección horizontal unitaria: de la velocidad si la hay, del fallback si no.
fn rumbo_horizontal(vel: &[f64; 3], fallback: &[f64; 3]) -> [f64; 3] {
    let plano = |v: &[f64; 3]| {
        let n = (v[0] * v[0] + v[1] * v[1]).sqrt();
        (n >= MIN_RUMBO).then(|| [v[0] / n, v[1] / n, 0.0])
    };
    match plano(vel).or_else(|| plano(fallback)) {
        Some(h) => h,
        None => [0.0, 1.0, 0.0],
    }
}

/// Álgebra en vivo de la telemetría (port de `liveAlgebra` de la referencia).
pub struct LiveAlgebra {
    /// Proyección del dron sobre el plano z = 0.
    pub ground: [f64; 3],
    pub altitude: f64,
    pub dist_origen: f64,
    /// ĥ: rumbo unitario horizontal.
    pub rumbo_vec: [f64; 3],
    /// p = a·ĥ + b·r + c·k.
    pub along: f64,
    pub lateral: f64,
    /// v · n con n = (0, 1, 0).
    pub norte_dot: f64,
    pub rumbo_grados: f64,
    #[allow(dead_code)] // parte de la interfaz de paridad; la UI usa `vel_rotada`
    pub velocidad: f64,
    /// ‖R·v‖: R ortonormal conserva normas.
    pub vel_rotada: f64,
    pub dir_rank: u32,
    pub dir_det: f64,
    pub rot_rank: u32,
    pub rot_det: f64,
}

pub fn algebra_en_vivo(
    pos: &[f64; 3],
    vel: &[f64; 3],
    rot: &Mat3,
    fallback: &[f64; 3],
) -> LiveAlgebra {
    let h = rumbo_horizontal(vel, fallback);
    let r = [-h[1], h[0], 0.0]; // k × h, k = (0, 0, 1)
    let along = punto(pos, &h);
    let lateral = punto(pos, &r);
    let norte: [f64; 3] = [0.0, 1.0, 0.0];
    let dirs: Mat3 = [[h[0], r[0], 0.0], [h[1], r[1], 0.0], [0.0, 0.0, 1.0]];
    LiveAlgebra {
        ground: [pos[0], pos[1], 0.0],
        altitude: pos[2],
        dist_origen: norma(pos),
        rumbo_vec: h,
        along,
        lateral,
        norte_dot: punto(vel, &norte),
        rumbo_grados: ((h[0].atan2(h[1]) * 180.0 / std::f64::consts::PI) + 360.0) % 360.0,
        velocidad: norma(vel),
        vel_rotada: norma(&mul_mv(rot, vel)),
        dir_rank: rango3(&dirs),
        dir_det: det3(&dirs),
        rot_rank: rango3(rot),
        rot_det: det3(rot),
    }
}

/// "(x, y, z)" con `d` decimales.
pub fn vec3(v: &[f64; 3], d: usize) -> String {
    format!("({:.*}, {:.*}, {:.*})", d, v[0], d, v[1], d, v[2])
}

#[cfg(test)]
mod pruebas {
    use super::*;

    const LAT_UTS: f64 = 7.1051164;
    const LON_UTS: f64 = -73.123524;
    const SQRT3: f64 = 1.7320508075688772;

    #[test]
    fn matriz_enu_es_ortonormal() {
        let r = matriz_enu(LAT_UTS, LON_UTS);
        assert!((det3(&r) - 1.0).abs() < 1e-9);
        assert_eq!(rango3(&r), 3);
    }

    #[test]
    fn algebra_cruel() {
        let r = matriz_enu(LAT_UTS, LON_UTS);
        let pos = [10.0, 20.0, 50.0];
        let vel = [7.5, 15.0 * (SQRT3 / 2.0), 2.0]; // ‖vel_h‖ = 15
        let a = algebra_en_vivo(&pos, &vel, &r, &[0.0, 1.0, 0.0]);
        assert!((a.dist_origen - 3000.0_f64.sqrt()).abs() < 1e-9);
        assert!((a.rumbo_vec[0] - 0.5).abs() < 1e-12);
        // along = 10·0.5 + 20·(√3/2) = 5 + 10√3
        assert!((a.along - (5.0 + 20.0 * SQRT3 / 2.0)).abs() < 1e-9);
        assert!((a.lateral - (10.0 - 10.0 * SQRT3 / 2.0)).abs() < 1e-9);
        assert!((a.norte_dot - vel[1]).abs() < 1e-12);
        // R ortonormal: ‖R·v‖ = ‖v‖.
        assert!((a.vel_rotada - a.velocidad).abs() < 1e-9);
        assert_eq!(a.dir_rank, 3);
    }

    #[test]
    fn rumbo_cae_al_fallback() {
        let r = matriz_enu(LAT_UTS, LON_UTS);
        let a = algebra_en_vivo(&[0.0, 0.0, 50.0], &[0.0, 0.0, 2.0], &r, &[1.0, 0.0, 0.0]);
        assert!((a.rumbo_vec[0] - 1.0).abs() < 1e-12);
    }
}

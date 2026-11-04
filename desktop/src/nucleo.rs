//! Núcleo limpio: constantes, motor de vuelo y planificación A*.


/// Altura msnm del origen ENU (la UTS). Toda altura del mundo 3D es relativa a ella.
pub const ALTURA_ANCLA_MSNM: f64 = 938.5;

/// Constantes de vuelo, idénticas a las probadas en la versión de referencia.
pub const CRUCERO_MS: f64 = 15.0;
pub const VERTICAL_MS: f64 = 4.0;
pub const ACELERACION_MAX: f64 = 2.5;
pub const RADIO_LLEGADA: f64 = 1.5;
pub const BATERIA_WH: f64 = 80.0;
pub const POTENCIA_HOVER_W: f64 = 220.0;
pub const FACTOR_ARRASTRE_W: f64 = 0.36;
pub const POTENCIA_ASCENSO_W: f64 = 120.0;
pub const DT_FIJO: f64 = 1.0 / 30.0;
pub const ALTITUD_CRUCERO: f64 = 50.0;

/// Vector ENU (este, norte, arriba) en metros.
pub type Enu = [f64; 3];

pub fn distancia(a: &[f64], b: &[f64]) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Fase {
    Inactivo,
    Despegue,
    Crucero,
    Descenso,
    Entregado,
}

pub struct MuestraTelemetria {
    pub t: f64,
    pub posicion: Enu,
    pub velocidad: Enu,
    pub rumbo_grados: f64,
    pub velocidad_total: f64,
    pub altitud_agl: f64,
    pub bateria_porcentaje: f64,
    pub dist_recorrida: f64,
    pub dist_restante: f64,
    pub progreso: f64,
    pub fase: Fase,
}

/// Motor de vuelo: integración con aceleración limitada sobre waypoints.
pub struct MotorVuelo {
    ruta: Vec<Enu>,
    total: f64,
    pos: Enu,
    vel: Enu,
    t: f64,
    wp: usize,
    recorrido: f64,
    energia_wh: f64,
    fase: Fase,
    iniciado: bool,
    entregado: bool,
    offset_vertical: f64,
    vel_extra: f64,
    rumbog: f64,
}

fn resta(a: &Enu, b: &Enu) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn norma(v: &[f64; 3]) -> f64 {
    (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt()
}
fn escala(v: &[f64; 3], k: f64) -> [f64; 3] {
    [v[0] * k, v[1] * k, v[2] * k]
}

impl MotorVuelo {
    pub fn nuevo(ruta: Vec<Enu>) -> Self {
        let mut total = 0.0;
        for i in 1..ruta.len() {
            total += distancia(&ruta[i - 1], &ruta[i]);
        }
        MotorVuelo {
            ruta,
            total,
            pos: [0.0, 0.0, 0.0],
            vel: [0.0, 0.0, 0.0],
            t: 0.0,
            wp: 0,
            recorrido: 0.0,
            energia_wh: 0.0,
            fase: Fase::Inactivo,
            iniciado: false,
            entregado: false,
            offset_vertical: 0.0,
            vel_extra: 0.0,
            rumbog: 0.0,
        }
    }

    pub fn iniciar(&mut self) {
        if self.iniciado || self.entregado {
            return;
        }
        self.iniciado = true;
        self.fase = Fase::Despegue;
    }

    pub fn reiniciar(&mut self) {
        self.rumbog = 0.0;
        self.pos = [0.0; 3];
        self.vel = [0.0; 3];
        self.t = 0.0;
        self.wp = 0;
        self.recorrido = 0.0;
        self.energia_wh = 0.0;
        self.fase = Fase::Inactivo;
        self.iniciado = false;
        self.entregado = false;
        self.offset_vertical = 0.0;
        self.vel_extra = 0.0;
    }

    fn entregar(&mut self) {
        let ultima = self.ruta[self.ruta.len() - 1];
        self.pos = ultima;
        self.vel = [0.0; 3];
        self.offset_vertical = 0.0;
        self.entregado = true;
        self.fase = Fase::Entregado;
    }

    /** Telemetria consolidada del estado actual. */
    pub fn telemetria(&self) -> MuestraTelemetria {
        let restante = self.restante();
        let altitud = self.pos[2] + self.offset_vertical;
        let velocidad = [self.vel[0], self.vel[1], self.vel[2] + self.vel_extra];
        let velocidad_total = (velocidad[0].powi(2) + velocidad[1].powi(2) + velocidad[2].powi(2)).sqrt();
        let bateria = ((1.0 - self.energia_wh / BATERIA_WH) * 100.0).clamp(0.0, 100.0);
        let progreso = if self.total > 0.0 { 1.0 - restante / self.total } else { 0.0 };
        MuestraTelemetria {
            t: self.t,
            posicion: [self.pos[0], self.pos[1], altitud],
            velocidad,
            rumbo_grados: self.rumbog,
            velocidad_total,
            altitud_agl: altitud,
            bateria_porcentaje: bateria,
            dist_recorrida: self.recorrido,
            dist_restante: restante,
            progreso: progreso.clamp(0.0, 1.0),
            fase: self.fase,
        }
    }
    fn restante(&self) -> f64 {
        if self.wp >= self.ruta.len() {
            return 0.0;
        }
        let mut total = distancia(&self.pos, &self.ruta[self.wp]);
        for i in self.wp..self.ruta.len().saturating_sub(1) {
            total += distancia(&self.ruta[i], &self.ruta[i + 1]);
        }
        total
    }

    fn clasificar(&self, horizontal: f64, dz: f64) -> Fase {
        if horizontal < 2.0 && dz > 1.0 {
            if self.wp <= 1 { Fase::Despegue } else { Fase::Crucero }
        } else if horizontal < 2.0 && dz < -1.0 {
            Fase::Descenso
        } else {
            Fase::Crucero
        }
    }

    pub fn actualizar(&mut self, dt: f64) {
        if !self.iniciado || self.entregado || self.wp >= self.ruta.len() {
            return;
        }
        let dt = dt.clamp(1e-6, 0.2);
        let objetivo_actual = self.ruta[self.wp];
        if distancia(&self.pos, &objetivo_actual) <= RADIO_LLEGADA {
            self.wp += 1;
            if self.wp >= self.ruta.len() {
                self.entregar();
                return;
            }
            // conservar solo la componente de la velocidad a lo largo del nuevo rumbo
            let objetivo_nuevo = self.ruta[self.wp];
            let dir = resta(&objetivo_nuevo, &self.pos);
            let norma_dir = norma(&dir);
            if norma_dir > 1e-6 {
                let a_lo_largo =
                    (self.vel[0] * dir[0] + self.vel[1] * dir[1] + self.vel[2] * dir[2]) / norma_dir;
                self.vel = [dir[0] * a_lo_largo / norma_dir, dir[1] * a_lo_largo / norma_dir, dir[2] * a_lo_largo / norma_dir];
            } else {
                self.vel = [0.0; 3];
            }
        }
        let objetivo = self.ruta[self.wp];
        let a_objetivo = resta(&objetivo, &self.pos);
        let restante = norma(&a_objetivo);
        let horizontal = (a_objetivo[0] * a_objetivo[0] + a_objetivo[1] * a_objetivo[1]).sqrt();
        let vertical = a_objetivo[2].abs();
        let es_vertical = horizontal < 1.0 && vertical > 1.0;
        let velocidad_objetivo = if es_vertical { VERTICAL_MS } else { CRUCERO_MS };
        let limitada = velocidad_objetivo.min(restante / dt);
        let deseada = if restante > 1e-6 {
            escala(&a_objetivo, limitada / restante)
        } else {
            [0.0; 3]
        };
        let error = resta(&deseada, &self.vel);
        let norma_error = norma(&error);
        let magnitud = ACELERACION_MAX.min(norma_error / dt);
        let acel = if norma_error > 1e-9 {
            escala(&error, magnitud / norma_error)
        } else {
            [0.0; 3]
        };
        let vel_siguiente = [self.vel[0] + dt * acel[0], self.vel[1] + dt * acel[1], self.vel[2] + dt * acel[2]];
        let siguiente = [
            self.pos[0] + dt * vel_siguiente[0],
            self.pos[1] + dt * vel_siguiente[1],
            self.pos[2] + dt * vel_siguiente[2],
        ];
        let paso_hecho = distancia(&self.pos, &siguiente);
        if paso_hecho >= restante {
            self.recorrido += restante;
            self.pos = objetivo;
            self.vel = deseada;
        } else {
            self.recorrido += paso_hecho;
            self.pos = siguiente;
            self.vel = vel_siguiente;
        }
        self.t += dt;

        let horizontal_vel = (self.vel[0] * self.vel[0] + self.vel[1] * self.vel[1]).sqrt();
        if horizontal_vel > 0.4 {
            let h = (self.vel[0].atan2(self.vel[1]) * 180.0 / std::f64::consts::PI + 360.0) % 360.0;
            self.rumbog = h;
        }
        let speed = norma(&self.vel);
        let ascenso = self.vel[2].max(0.0);
        let potencia =
            POTENCIA_HOVER_W + FACTOR_ARRASTRE_W * speed * speed + POTENCIA_ASCENSO_W * ascenso;
        self.energia_wh += potencia * dt / 3600.0;
        let dz = self.ruta[self.wp][2] - self.pos[2];
        self.fase = self.clasificar(horizontal, dz);

        // Envolvente vertical suave (la misma curva de la referencia).
        let restante = self.restante();
        let progreso = if self.total > 0.0 { (1.0 - restante / self.total).clamp(0.0, 1.0) } else { 0.0 };
        let span = ((progreso - 0.02) / 0.94).clamp(0.0, 1.0);
        let onda = 4.2 * (1.0 - (2.0 * std::f64::consts::PI * 8.0 * span).cos()) * 0.5
            + 1.0 * (1.0 - (2.0 * std::f64::consts::PI * 19.0 * span).cos()) * 0.5;
        let siguiente_offset = (std::f64::consts::PI * span).sin() * onda;
        self.vel_extra = (siguiente_offset - self.offset_vertical) / dt;
        self.offset_vertical = siguiente_offset;
    }

}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn ruta_prueba() -> Vec<Enu> {
        vec![
            [0.0, 0.0, 0.0],
            [0.0, 0.0, ALTITUD_CRUCERO],
            [405.79, 4053.6, ALTITUD_CRUCERO],
            [405.79, 4053.6, 0.0],
        ]
    }

    fn motor_a_50s() -> MuestraTelemetria {
        let mut m = MotorVuelo::nuevo(ruta_prueba());
        m.iniciar();
        for _ in 0..1500 {
            m.actualizar(DT_FIJO);
        }
        m.telemetria()
    }

    #[test]
    fn fase_cruero_a_50s() {
        assert!(matches!(motor_a_50s().fase, Fase::Crucero));
    }
}

import * as Cesium from "cesium";
import { routeFrame, type Telemetry, type Vec3 } from "@dron/shared";
import { DRONE_HANDOFF_HEIGHT, MISSION_ZONES, PACKAGE_SIZE } from "./constants";
import type { WorldFrame } from "./world";

export type { MissionState } from "../mision/tipos";
export { MISSION_STATE_LABEL } from "../mision/tipos";
import type { MissionState } from "../mision/tipos";

/** Plano de cámara relativo al dron para las dos secuencias. */
export interface CameraShot {
  readonly position: Vec3;
  readonly target: Vec3;
}

type CourierPose = "idle" | "walk" | "reach";

const DELIVERY_MS = 3200;
const RECEPTION_MS = 3600;

const EASE_IN_OUT = (value: number): number =>
  value < 0.5 ? 2 * value * value : 1 - 2 * (1 - value) * (1 - value);
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, alpha: number): number => a + (b - a) * alpha;
const lerpVec = (a: Vec3, b: Vec3, alpha: number): Vec3 => [
  lerp(a[0], b[0], alpha),
  lerp(a[1], b[1], alpha),
  lerp(a[2], b[2], alpha),
];

class Courier {
  private readonly entities: Cesium.Entity[] = [];
  pose: CourierPose = "idle";
  walkPhase = 0;
  reach = 0;
  private enu: Vec3;
  private readonly shirt: Cesium.Color;
  private readonly jacket: Cesium.Color;
  private readonly skin: Cesium.Color;
  private readonly shadowColor: Cesium.Color;

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly world: WorldFrame,
    origin: Vec3,
    facing: number,
    jacketCss: string,
    shirtCss: string,
  ) {
    this.enu = [origin[0], origin[1], 0];
    this.facing = facing;
    this.shirt = Cesium.Color.fromCssColorString(shirtCss);
    this.jacket = Cesium.Color.fromCssColorString(jacketCss);
    this.skin = Cesium.Color.fromCssColorString("#c69b6f");
    this.shadowColor = Cesium.Color.fromCssColorString("#0f172a");
    this.attachBody();
  }

  facing = 0;

  private add(options: Cesium.Entity.ConstructorOptions): void {
    this.entities.push(this.viewer.entities.add(options));
  }

  private legSwing(): number {
    return this.pose === "walk" ? Math.sin(this.walkPhase * 7.4) * 0.16 : 0;
  }

  private legLift(): number {
    return this.pose === "walk" ? Math.abs(Math.cos(this.walkPhase * 7.4)) * 0.08 : 0;
  }

  /** Coordenada ENU de un punto en el sistema local del repartidor. */
  private localEnu(x: number, y: number, z: number): Vec3 {
    const cos = Math.cos(this.facing);
    const sin = Math.sin(this.facing);
    return [
      this.enu[0] + cos * x - sin * y,
      this.enu[1] + sin * x + cos * y,
      z,
    ];
  }

  private local(x: number, y: number, z: number): Cesium.Cartesian3 {
    return this.world.enu(this.localEnu(x, y, z));
  }

  /** Manos: punto exacto donde se entrega o recibe el paquete. */
  handEnu(): Vec3 {
    return this.localEnu(0.02, 0.05 + this.reach * 0.55, 0.82 + this.reach * 0.42);
  }

  private cb(fn: () => Cesium.Cartesian3): Cesium.CallbackPositionProperty {
    return new Cesium.CallbackPositionProperty(fn, false);
  }

  /**
   * Humanoide de bajo poligono pero con proporciones y lectura correctas:
   * uniforme oscuro, chaleco reflectante, cuello, cabeza y gorra. Antes el
   * torso era una caja azul de 44 cm de ancho y a corta distancia se leia como
   * un bloque de color, no como una persona.
   */
  private attachBody(): void {
    const uniform = this.shirt;
    const vest = this.jacket;
    const skin = this.skin;
    const dark = this.shadowColor;
    const reflective = Cesium.Color.fromCssColorString("#e2e8f0");
    const hair = Cesium.Color.fromCssColorString("#1f2937");
    const breath = (): number => (this.pose === "idle" ? Math.sin(this.walkPhase * 0.9) * 0.006 : 0);

    for (const side of [-1, 1]) {
      // Muslo y pantorrilla, con la zancada aplicada al conjunto.
      this.add({
        position: this.cb(() => this.local(side * 0.105, this.legSwing() * 0.45, 0.68)),
        cylinder: { length: 0.42, topRadius: 0.076, bottomRadius: 0.06, material: uniform },
      });
      this.add({
        position: this.cb(
          () => this.local(side * 0.105, this.legSwing() * 0.45, 0.31 + this.legLift() * 0.4),
        ),
        cylinder: { length: 0.36, topRadius: 0.06, bottomRadius: 0.05, material: uniform },
      });
      this.add({
        position: this.cb(() => this.local(side * 0.105, 0.055, 0.05 + this.legLift())),
        box: {
          dimensions: new Cesium.Cartesian3(0.13, 0.25, 0.1),
          material: dark,
        },
      });
    }

    // Cadera, torso y chaleco.
    this.add({
      position: this.cb(() => this.local(0, 0, 0.9 + breath())),
      cylinder: { length: 0.18, topRadius: 0.155, bottomRadius: 0.17, material: uniform },
    });
    this.add({
      position: this.cb(() => this.local(0, 0, 1.17 + breath())),
      cylinder: { length: 0.52, topRadius: 0.2, bottomRadius: 0.16, material: uniform },
    });
    this.add({
      position: this.cb(() => this.local(0, 0, 1.2 + breath())),
      cylinder: { length: 0.4, topRadius: 0.212, bottomRadius: 0.175, material: vest },
    });
    this.add({
      position: this.cb(() => this.local(0, 0, 1.16 + breath())),
      cylinder: { length: 0.06, topRadius: 0.216, bottomRadius: 0.214, material: reflective },
    });

    // Cuello, cabeza y gorra.
    this.add({
      position: this.cb(() => this.local(0, 0, 1.47 + breath())),
      cylinder: { length: 0.09, topRadius: 0.055, bottomRadius: 0.062, material: skin },
    });
    this.add({
      position: this.cb(() => this.local(0, 0.005, 1.6 + breath())),
      ellipsoid: { radii: new Cesium.Cartesian3(0.105, 0.1, 0.12), material: skin },
    });
    this.add({
      position: this.cb(() => this.local(0, -0.005, 1.665 + breath())),
      ellipsoid: { radii: new Cesium.Cartesian3(0.108, 0.104, 0.065), material: hair },
    });
    this.add({
      position: this.cb(() => this.local(0, 0.085, 1.665 + breath())),
      box: {
        dimensions: new Cesium.Cartesian3(0.2, 0.12, 0.02),
        material: hair,
      },
    });

    // Hombros y brazos. El brazo avanza y sube con `reach`.
    for (const side of [-1, 1]) {
      this.add({
        position: this.cb(() => this.local(side * 0.2, 0, 1.42 + breath())),
        ellipsoid: { radii: new Cesium.Cartesian3(0.07, 0.07, 0.065), material: vest },
      });
      this.add({
        position: this.cb(() => {
          const reach = this.reach;
          const swing = this.pose === "walk" ? Math.sin(this.walkPhase * 7.4 + Math.PI) * 0.09 : 0;
          return this.local(side * 0.235, 0.02 + reach * 0.34 + swing, 1.07 + reach * 0.22);
        }),
        cylinder: { length: 0.56, topRadius: 0.052, bottomRadius: 0.044, material: uniform },
      });
      this.add({
        position: this.cb(
          () => this.local(side * 0.235, 0.05 + this.reach * 0.55, 0.82 + this.reach * 0.42),
        ),
        ellipsoid: { radii: new Cesium.Cartesian3(0.045, 0.05, 0.055), material: skin },
      });
    }
  }

  step(dt: number): void {
    if (this.pose === "walk") this.walkPhase += dt;
    else this.walkPhase += dt * 0.6;
  }

  place(origin: Vec3, facing: number): void {
    this.enu = [origin[0], origin[1], origin[2] ?? 0];
    this.facing = facing;
  }

  setPose(pose: CourierPose): void {
    this.pose = pose;
    if (pose === "idle") this.walkPhase = 0;
  }

  destroy(): void {
    for (const entity of this.entities) this.viewer.entities.remove(entity);
    this.entities.length = 0;
  }
}

const zoneRing = (
  viewer: Cesium.Viewer,
  world: WorldFrame,
  origin: Vec3,
  radius: number,
  css: string,
): Cesium.Entity => {
  const pulse = (): number => 0.5 + 0.5 * Math.sin(performance.now() * 0.0026);
  const accent = Cesium.Color.fromCssColorString(css);
  const ground = (): Cesium.Cartesian3 => world.ground(origin);
  return viewer.entities.add({
    // Callback: si el ancla del mundo se recalibra con el terreno real, el
    // anillo se vuelve a posar solo en vez de quedar flotando.
    position: new Cesium.CallbackPositionProperty(ground, false),
    ellipse: {
      semiMajorAxis: radius,
      semiMinorAxis: radius,
      material: new Cesium.ColorMaterialProperty(
        new Cesium.CallbackProperty(() => accent.withAlpha(0.05 + 0.04 * pulse()), false),
      ),
      height: new Cesium.CallbackProperty(
        () => (Cesium.Cartographic.fromCartesian(ground())?.height ?? 0) + 0.08,
        false,
      ),
      outline: true,
      outlineColor: new Cesium.CallbackProperty(() => accent.withAlpha(0.3 + 0.5 * pulse()), false),
    },
    polyline: {
      positions: new Cesium.CallbackProperty(
        () => [ground(), world.enu([origin[0], origin[1], 6])],
        false,
      ),
      width: 1.5,
      material: new Cesium.PolylineDashMaterialProperty({
        color: accent.withAlpha(0.6),
        dashLength: 12,
      }),
      arcType: Cesium.ArcType.NONE,
    },
  });
};

export class MissionDirector {
  private state: MissionState = "esperando";
  private stateSince = 0;
  private lastFrameAt = performance.now();
  private lastTelemetryT = 0;
  private lastPhase: Telemetry["phase"] | null = null;
  private deliveryLatch = false;
  private receptionLatch = false;
  private packageLoaded = false;
  private hold = false;
  private courierUts: Courier;
  private courierUis: Courier;
  private readonly courierUtsOrigin: Vec3;
  private readonly courierUisOrigin: Vec3;
  private zoneEntities: Cesium.Entity[] = [];
  private packageEntities: Cesium.Entity[] = [];
  private packagePosition = new Cesium.Cartesian3();
  private lastBelly: Vec3 = [0, 0, 0];
  private destroyed = false;

  constructor(
    private readonly viewer: Cesium.Viewer,
    private readonly world: WorldFrame,
    private readonly onState: (state: MissionState) => void,
    private readonly onHold: (hold: boolean) => void,
  ) {
    this.courierUtsOrigin = [-5.6, -8.4, 0];
    this.courierUisOrigin = [routeFrame.displacement[0] + 6.4, routeFrame.displacement[1] + 9.4, 0];
    // (chaleco reflectante, uniforme)
    this.courierUts = new Courier(viewer, world, this.courierUtsOrigin, 0.42, "#f97316", "#1e293b");
    this.courierUis = new Courier(viewer, world, this.courierUisOrigin, Math.PI + 0.55, "#facc15", "#1e293b");
    this.createZones();
    this.createPackage();
  }

  private createZones(): void {
    this.zoneEntities.push(
      zoneRing(this.viewer, this.world, [0, 0, 0], MISSION_ZONES.uts.radius, "#22c55e"),
      zoneRing(
        this.viewer,
        this.world,
        routeFrame.displacement,
        MISSION_ZONES.uis.radius,
        "#f97316",
      ),
    );
  }

  /**
   * Paquete de cartón: caja kraft, cinta de embalaje y etiqueta blanca.
   * Antes era una caja ámbar plana que parecía un cubo de juguete.
   */
  private createPackage(): void {
    const position = new Cesium.CallbackPositionProperty(
      () => this.packagePosition,
      false,
    );
    const kraft = Cesium.Color.fromCssColorString("#c08a52");
    const tape = Cesium.Color.fromCssColorString("#9a6b39");
    const label = Cesium.Color.fromCssColorString("#f4f4f0");
    const [width, depth, height] = PACKAGE_SIZE;

    this.packageEntities.push(
      this.viewer.entities.add({
        position,
        box: {
          dimensions: new Cesium.Cartesian3(width, depth, height),
          material: kraft,
          outline: true,
          outlineColor: tape.withAlpha(0.7),
        },
      }),
      // Cinta que cruza la tapa y sobresale 2 mm por delante y por detrás.
      this.viewer.entities.add({
        position,
        box: {
          dimensions: new Cesium.Cartesian3(width + 0.006, 0.062, height + 0.004),
          material: tape,
        },
      }),
      // Etiqueta de envío.
      this.viewer.entities.add({
        position,
        box: {
          dimensions: new Cesium.Cartesian3(0.11, depth + 0.006, 0.075),
          material: label,
        },
      }),
    );
  }

  /** Anillos recolocados tras recalibrar el ancla con el terreno real. */
  refreshZones(): void {
    for (const entity of this.zoneEntities) this.viewer.entities.remove(entity);
    this.zoneEntities = [];
    this.createZones();
  }

  private setState(state: MissionState): void {
    if (this.state === state) return;
    this.state = state;
    this.stateSince = performance.now();
    this.onState(state);
  }

  private setHold(hold: boolean): void {
    if (this.hold === hold) return;
    this.hold = hold;
    this.onHold(hold);
  }

  private animateDelivery(sample: Telemetry, alpha: number): void {
    const courier = this.courierUts;
    const groundX = sample.position[0];
    const groundY = sample.position[1];
    if (alpha < 0.38) {
      const target: Vec3 = [groundX + 2.1, groundY - 1.2, 0];
      const progress = EASE_IN_OUT(alpha / 0.38);
      courier.place(
        [
          lerp(this.courierUtsOrigin[0], target[0], progress),
          lerp(this.courierUtsOrigin[1], target[1], progress),
          0,
        ],
        Math.atan2(target[1] - this.courierUtsOrigin[1], target[0] - this.courierUtsOrigin[0]),
      );
      courier.setPose("walk");
      return;
    }
    if (alpha < 0.6) {
      courier.place([groundX + 1.55, groundY - 0.85, 0], Math.PI + 0.4);
      courier.reach = 1;
      courier.setPose("reach");
      return;
    }
    if (alpha < 0.84) {
      courier.place([groundX + 1.05, groundY - 1.35, 0], Math.PI * 1.35);
      courier.reach = 0;
      courier.setPose("idle");
      return;
    }
    const progress = EASE_IN_OUT((alpha - 0.84) / 0.16);
    courier.place(
      [
        lerp(groundX + 1.05, this.courierUtsOrigin[0] - 2.6, progress),
        lerp(groundY - 1.35, this.courierUtsOrigin[1] - 3.8, progress),
        0,
      ],
      Math.PI + 0.4,
    );
    courier.setPose("walk");
  }

  private animateReception(sample: Telemetry, alpha: number): void {
    const courier = this.courierUis;
    const groundX = sample.position[0];
    const groundY = sample.position[1];
    if (alpha < 0.42) {
      const target: Vec3 = [groundX + 2.2, groundY + 1.4, 0];
      const progress = EASE_IN_OUT(alpha / 0.42);
      courier.place(
        [
          lerp(this.courierUisOrigin[0], target[0], progress),
          lerp(this.courierUisOrigin[1], target[1], progress),
          0,
        ],
        Math.atan2(target[1] - this.courierUisOrigin[1], target[0] - this.courierUisOrigin[0]),
      );
      courier.setPose("walk");
      courier.reach = 0;
      return;
    }
    if (alpha < 0.62) {
      courier.place([groundX + 1.7, groundY + 0.95, 0], Math.PI + 0.35);
      courier.reach = 1;
      courier.setPose("reach");
      return;
    }
    if (alpha < 0.8) {
      courier.place([groundX + 2.05, groundY + 1.75, 0], Math.PI * 1.55);
      courier.setPose("idle");
      courier.reach = 0;
      return;
    }
    const progress = EASE_IN_OUT((alpha - 0.8) / 0.2);
    courier.place(
      [
        lerp(groundX + 2.05, this.courierUisOrigin[0] + 2.4, progress),
        lerp(groundY + 1.75, this.courierUisOrigin[1] + 3.4, progress),
        0,
      ],
      Math.PI * 1.6,
    );
    courier.setPose("walk");
  }

  /**
   * Un solo paquete, con dueño explícito. Se mueve del repartidor al dron y del
   * dron al receptor; nunca hay dos cajas independientes.
   */
  private updatePackage(now: number): void {
    const utsHand = this.courierUts.handEnu();
    const uisHand = this.courierUis.handEnu();
    const belly = this.lastBelly;

    let target: Vec3;
    if (this.state === "animando_entrega") {
      const elapsed = clamp01((now - this.stateSince) / DELIVERY_MS);
      const handoff = EASE_IN_OUT(clamp01((elapsed - 0.52) / 0.3));
      target = lerpVec(utsHand, belly, handoff);
      if (elapsed >= 0.8) this.packageLoaded = true;
    } else if (this.state === "animando_recepcion") {
      const elapsed = clamp01((now - this.stateSince) / RECEPTION_MS);
      const handoff = EASE_IN_OUT(clamp01((elapsed - 0.45) / 0.28));
      target = lerpVec(belly, uisHand, handoff);
      if (elapsed >= 0.72) this.packageLoaded = false;
    } else if (this.packageLoaded) {
      target = belly;
    } else if (this.state === "completado") {
      target = uisHand;
    } else {
      target = utsHand;
    }

    this.packagePosition = this.world.enu(target);
  }

  /** Plano de cámara de la secuencia activa, relativo al dron. */
  shot(): CameraShot | null {
    if (this.state === "animando_entrega") {
      // Plano a ~5 m: entran dron, repartidor y algo de campus detrás.
      return { position: [4.2, -5.4, 1.7], target: [1.0, -0.8, -0.3] };
    }
    if (this.state === "animando_recepcion") {
      return { position: [4.6, 5.4, 1.8], target: [1.1, 0.9, -0.3] };
    }
    return null;
  }

  update(sample: Telemetry, now: number, belly: Vec3, ready: boolean): void {
    if (this.destroyed) return;
    const dt = Math.min(0.12, Math.max(0.001, (now - this.lastFrameAt) / 1000));
    this.lastFrameAt = now;
    this.lastBelly = belly;

    // Detección real de "el servidor reinició": el reloj retrocede o la fase
    // vuelve a idle. Comprobar sólo `t === 0 && phase === "idle"` disparaba el
    // reset en cada frame en el pad y cancelaba la secuencia de carga.
    const serverReset =
      (this.lastPhase !== null && this.lastPhase !== "idle" && sample.phase === "idle") ||
      sample.t + 1 < this.lastTelemetryT;
    this.lastTelemetryT = sample.t;
    this.lastPhase = sample.phase;
    if (serverReset) {
      this.reset();
      return;
    }
    this.courierUts.step(dt);
    this.courierUis.step(dt);

    const position = sample.position;
    const inUts = Math.hypot(position[0], position[1]) < MISSION_ZONES.uts.radius;
    const inUis =
      Math.hypot(
        position[0] - routeFrame.displacement[0],
        position[1] - routeFrame.displacement[1],
      ) < MISSION_ZONES.uis.radius;
    const elapsed = (now - this.stateSince) / 1000;

    if (this.state === "animando_entrega") {
      this.animateDelivery(sample, clamp01(elapsed / (DELIVERY_MS / 1000)));
      if (elapsed * 1000 >= DELIVERY_MS) {
        this.packageLoaded = true;
        this.setState("paquete_cargado");
      }
    } else if (this.state === "animando_recepcion") {
      this.animateReception(sample, clamp01(elapsed / (RECEPTION_MS / 1000)));
      if (elapsed * 1000 >= RECEPTION_MS) {
        this.packageLoaded = false;
        this.setState("completado");
      }
    } else if (this.state === "paquete_cargado") {
      if (sample.phase === "delivered" && inUis && !this.receptionLatch) {
        this.receptionLatch = true;
        this.courierUis.reach = 0;
        this.setState("animando_recepcion");
      }
    } else if (this.state === "esperando" || this.state === "en_zona") {
      if (sample.t > 4 && sample.phase !== "idle" && !this.deliveryLatch) {
        // Alguien abrió la página con el vuelo ya empezado: el paquete debe
        // estar colgado del dron, no en manos del repartidor de la UTS.
        this.deliveryLatch = true;
        this.packageLoaded = true;
        this.setState("paquete_cargado");
      } else if (!ready) {
        if (inUts || inUis) this.setState("en_zona");
      } else if (inUts && sample.t < 4 && !this.deliveryLatch) {
        // La secuencia de carga solo tiene sentido en el pad, antes del ascenso.
        this.deliveryLatch = true;
        this.packageLoaded = false;
        this.courierUts.reach = 0;
        this.setState("animando_entrega");
      } else if (inUts || inUis) {
        this.setState("en_zona");
      } else {
        this.setState("esperando");
      }
    }

    this.updatePackage(now);
    this.setHold(
      !ready ||
        this.state === "animando_entrega" ||
        this.state === "animando_recepcion",
    );
  }

  hoverZ(sample: Telemetry): number | null {
    // Mantiene el dron a altura de manos durante la carga y hasta que la
    // telemetría lo alcance, para que no haya salto al reanudar.
    if (this.state === "animando_entrega" || (this.packageLoaded && sample.t < 3)) {
      return DRONE_HANDOFF_HEIGHT;
    }
    return null;
  }

  reset(): void {
    this.state = "esperando";
    this.stateSince = 0;
    this.deliveryLatch = false;
    this.receptionLatch = false;
    this.packageLoaded = false;
    this.courierUts.place(this.courierUtsOrigin, 0.42);
    this.courierUis.place(this.courierUisOrigin, Math.PI + 0.55);
    this.courierUts.reach = 0;
    this.courierUis.reach = 0;
    this.courierUts.setPose("idle");
    this.courierUis.setPose("idle");
    this.setHold(false);
    this.onState(this.state);
  }

  destroy(): void {
    this.destroyed = true;
    this.courierUts.destroy();
    this.courierUis.destroy();
    for (const entity of this.zoneEntities) this.viewer.entities.remove(entity);
    for (const entity of this.packageEntities) this.viewer.entities.remove(entity);
    this.zoneEntities = [];
    this.packageEntities = [];
  }
}

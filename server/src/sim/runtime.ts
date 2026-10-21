import type {
  ClientCommand,
  ServerMessage,
  SessionInfo,
  SimEvent,
  SimulationStatus,
  Vec3,
} from "@dron/shared";
import { CAMPUSES, DroneSimulation } from "@dron/shared";

const FIXED_DT = 1 / 30;
const TICK_MS = 20;
const TELEMETRY_INTERVAL_SECONDS = 1 / 15;
const MAX_STEPS_PER_TICK = 90;
const MAX_EVENT_LOG = 120;

type Listener = (message: ServerMessage) => void;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export class SimulationRuntime {
  private sim: DroneSimulation;
  private readonly route: Vec3[];
  private readonly listeners = new Set<Listener>();
  private readonly timer: NodeJS.Timeout;
  private eventLog: SimEvent[] = [];

  private running = false;
  private speed = 1;
  private accumulator = 0;
  private telemetryAccumulator = 0;
  private lastTick = performance.now();

  constructor(route: Vec3[]) {
    this.route = route;
    this.sim = new DroneSimulation(route);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  addListener(listener: Listener): void {
    this.listeners.add(listener);
  }

  removeListener(listener: Listener): void {
    this.listeners.delete(listener);
  }

  dispose(): void {
    clearInterval(this.timer);
    this.listeners.clear();
  }

  status(): SimulationStatus {
    return {
      running: this.running,
      speed: this.speed,
      started: this.sim.isStarted,
      delivered: this.sim.isDelivered,
    };
  }

  session(): SessionInfo {
    return {
      telemetry: this.sim.telemetry(),
      route: this.route,
      events: [...this.eventLog],
      status: this.status(),
      campuses: CAMPUSES,
    };
  }

  handle(command: ClientCommand): void {
    switch (command.type) {
      case "start":
        this.start();
        break;
      case "pause":
        this.pause();
        break;
      case "resume":
        this.resume();
        break;
      case "reset":
        this.reset();
        break;
      case "speed":
        this.setSpeed(command.value);
        break;
    }
  }

  start(): void {
    if (this.sim.isDelivered) return;
    if (this.sim.isStarted) {
      this.resume();
      return;
    }
    this.sim.start();
    this.running = true;
    this.accumulator = 0;
    this.lastTick = performance.now();
    this.drainEvents();
    this.emitStatus();
    this.emitTelemetry();
  }

  pause(): void {
    if (!this.running) return;
    this.running = false;
    this.emitStatus();
  }

  resume(): void {
    if (this.running || !this.sim.isStarted || this.sim.isDelivered) return;
    this.running = true;
    this.lastTick = performance.now();
    this.emitStatus();
  }

  reset(): void {
    this.sim = new DroneSimulation(this.route);
    this.running = false;
    this.speed = 1;
    this.accumulator = 0;
    this.telemetryAccumulator = 0;
    this.lastTick = performance.now();
    this.eventLog = [];
    this.emit({ type: "route", payload: { route: this.route } });
    this.emitStatus();
    this.emitTelemetry();
  }

  setSpeed(value: number): void {
    if (!Number.isFinite(value)) return;
    this.speed = clamp(value, 0.25, 8);
    this.emitStatus();
  }

  private tick(): void {
    const now = performance.now();
    const wallDelta = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;

    if (!this.running) return;

    this.accumulator += wallDelta * this.speed;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_TICK) {
      this.sim.step(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps += 1;
    }

    this.drainEvents();

    this.telemetryAccumulator += wallDelta;
    if (this.telemetryAccumulator >= TELEMETRY_INTERVAL_SECONDS) {
      this.telemetryAccumulator = 0;
      this.emitTelemetry();
    }

    if (this.sim.isDelivered) {
      this.running = false;
      this.emitTelemetry();
      this.emitStatus();
    }
  }

  private drainEvents(): void {
    const events = this.sim.drainEvents();
    for (const event of events) {
      this.eventLog.push(event);
      this.emit({ type: "event", payload: event });
    }
    if (this.eventLog.length > MAX_EVENT_LOG) {
      this.eventLog = this.eventLog.slice(-MAX_EVENT_LOG);
    }
  }

  private emitTelemetry(): void {
    this.emit({ type: "telemetry", payload: this.sim.telemetry() });
  }

  private emitStatus(): void {
    this.emit({ type: "status", payload: this.status() });
  }

  private emit(message: ServerMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }
}

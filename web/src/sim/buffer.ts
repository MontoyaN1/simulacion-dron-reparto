import type { Telemetry } from "@dron/shared";

interface TimedSample {
  readonly telemetry: Telemetry;
  readonly receivedAt: number;
}

const RENDER_DELAY_MS = 110;
const MAX_SAMPLES = 16;

const lerp = (a: number, b: number, alpha: number): number => a + (b - a) * alpha;

const lerpAngle = (a: number, b: number, alpha: number): number => {
  const difference = ((((b - a + 180) % 360) + 360) % 360) - 180;
  return (a + difference * alpha + 360) % 360;
};

const interpolate = (a: Telemetry, b: Telemetry, alpha: number): Telemetry => ({
  t: lerp(a.t, b.t, alpha),
  position: [
    lerp(a.position[0], b.position[0], alpha),
    lerp(a.position[1], b.position[1], alpha),
    lerp(a.position[2], b.position[2], alpha),
  ],
  velocity: [
    lerp(a.velocity[0], b.velocity[0], alpha),
    lerp(a.velocity[1], b.velocity[1], alpha),
    lerp(a.velocity[2], b.velocity[2], alpha),
  ],
  acceleration: [
    lerp(a.acceleration[0], b.acceleration[0], alpha),
    lerp(a.acceleration[1], b.acceleration[1], alpha),
    lerp(a.acceleration[2], b.acceleration[2], alpha),
  ],
  speed: lerp(a.speed, b.speed, alpha),
  verticalSpeed: lerp(a.verticalSpeed, b.verticalSpeed, alpha),
  headingDeg: lerpAngle(a.headingDeg, b.headingDeg, alpha),
  altitudeAgl: lerp(a.altitudeAgl, b.altitudeAgl, alpha),
  distanceTravelled: lerp(a.distanceTravelled, b.distanceTravelled, alpha),
  distanceRemaining: lerp(a.distanceRemaining, b.distanceRemaining, alpha),
  progress: lerp(a.progress, b.progress, alpha),
  batteryPercent: lerp(a.batteryPercent, b.batteryPercent, alpha),
  powerWatts: lerp(a.powerWatts, b.powerWatts, alpha),
  phase: b.phase,
  waypointIndex: b.waypointIndex,
});

export class TelemetryBuffer {
  private samples: TimedSample[] = [];

  push(telemetry: Telemetry): void {
    const latest = this.samples[this.samples.length - 1]?.telemetry;
    if (
      latest &&
      (telemetry.t < latest.t - 0.25 ||
        Math.hypot(
          telemetry.position[0] - latest.position[0],
          telemetry.position[1] - latest.position[1],
          telemetry.position[2] - latest.position[2],
        ) > 250)
    ) {
      this.samples = [];
    }

    this.samples.push({ telemetry, receivedAt: performance.now() });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  get latest(): Telemetry | null {
    return this.samples[this.samples.length - 1]?.telemetry ?? null;
  }

  sample(now = performance.now()): Telemetry | null {
    if (this.samples.length === 0) return null;
    const renderAt = now - RENDER_DELAY_MS;
    const first = this.samples[0];
    if (renderAt <= first.receivedAt || this.samples.length === 1) {
      return first.telemetry;
    }

    for (let index = 0; index < this.samples.length - 1; index += 1) {
      const previous = this.samples[index];
      const current = this.samples[index + 1];
      if (renderAt > current.receivedAt) continue;
      const span = current.receivedAt - previous.receivedAt;
      if (span <= 0) return current.telemetry;
      const alpha = Math.min(1, Math.max(0, (renderAt - previous.receivedAt) / span));
      return interpolate(previous.telemetry, current.telemetry, alpha);
    }

    return this.latest;
  }
}

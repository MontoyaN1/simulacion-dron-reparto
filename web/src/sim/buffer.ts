import type { Telemetry } from "@dron/shared";

interface TimedSample {
  readonly telemetry: Telemetry;
  readonly receivedAt: number;
}

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
  private previous: TimedSample | null = null;
  private current: TimedSample | null = null;

  push(telemetry: Telemetry): void {
    this.previous = this.current;
    this.current = { telemetry, receivedAt: performance.now() };
  }

  get latest(): Telemetry | null {
    return this.current?.telemetry ?? null;
  }

  sample(now = performance.now()): Telemetry | null {
    if (!this.current) return null;
    if (!this.previous) return this.current.telemetry;

    const span = this.current.receivedAt - this.previous.receivedAt;
    if (span <= 0) return this.current.telemetry;

    const alpha = Math.min(1, Math.max(0, (now - this.previous.receivedAt) / span));
    if (alpha >= 1) return this.current.telemetry;
    return interpolate(this.previous.telemetry, this.current.telemetry, alpha);
  }
}

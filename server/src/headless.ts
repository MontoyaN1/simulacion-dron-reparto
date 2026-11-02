import { DroneSimulation, OPERATION_LIMITS, routeFrame, straightRoute } from "@dron/shared";

const route = straightRoute(routeFrame, OPERATION_LIMITS.cruiseAltitudeAglMeters);
const sim = new DroneSimulation(route);
sim.start();

const dt = 1 / 30;
const header = [
  "t(s)".padStart(7),
  "x(m)".padStart(8),
  "y(m)".padStart(8),
  "z(m)".padStart(6),
  "v(m/s)".padStart(8),
  "batt%".padStart(7),
  "fase".padStart(10),
].join(" ");

console.log(header);
console.log("-".repeat(header.length));

let step = 0;
while (!sim.isDelivered && step * dt < 900) {
  sim.step(dt);
  step += 1;
  if (step % 30 === 0) {
    const telemetry = sim.telemetry();
    console.log(
      [
        telemetry.t.toFixed(1).padStart(7),
        telemetry.position[0].toFixed(1).padStart(8),
        telemetry.position[1].toFixed(1).padStart(8),
        telemetry.position[2].toFixed(1).padStart(6),
        telemetry.speed.toFixed(2).padStart(8),
        telemetry.batteryPercent.toFixed(1).padStart(7),
        telemetry.phase.padStart(10),
      ].join(" "),
    );
  }
}

for (const event of sim.drainEvents()) {
  console.log(`[${event.t.toFixed(1)}s] ${event.type}: ${event.message}`);
}

const final = sim.telemetry();
console.log(
  `\nEntregado: ${sim.isDelivered} · duracion: ${final.t.toFixed(1)} s · bateria final: ${final.batteryPercent.toFixed(1)} %`,
);

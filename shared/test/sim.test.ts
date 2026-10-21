import assert from "node:assert/strict";
import { test } from "node:test";
import { DroneSimulation, straightRoute } from "../src/sim";
import { routeFrame } from "../src/config/frames";
import { norm, vec3 } from "../src/math/vec3";

const CRUISE_ALTITUDE = 50;
const route = straightRoute(routeFrame, CRUISE_ALTITUDE);

const runUntilDelivered = (sim: DroneSimulation, maxSeconds = 600): number => {
  const dt = 1 / 30;
  let steps = 0;
  while (!sim.isDelivered && steps * dt < maxSeconds) {
    sim.step(dt);
    steps += 1;
  }
  return steps * dt;
};

test("la ruta recta sube, cruza y desciende", () => {
  assert.equal(route.length, 4);
  assert.deepEqual(route[0], [0, 0, 0]);
  assert.deepEqual(route[1], [0, 0, CRUISE_ALTITUDE]);
  assert.equal(route[2][2], CRUISE_ALTITUDE);
  assert.equal(route[3][2], 0);
  assert.ok(Math.abs(route[2][0] - routeFrame.displacement[0]) < 1e-9);
});

test("el vuelo llega a la UIS con bateria suficiente", () => {
  const sim = new DroneSimulation(route);
  sim.start();
  const elapsed = runUntilDelivered(sim);
  const telemetry = sim.telemetry();

  assert.ok(sim.isDelivered);
  assert.ok(elapsed > 200 && elapsed < 400, `duracion inesperada: ${elapsed}`);
  assert.ok(telemetry.batteryPercent > 30, `bateria baja: ${telemetry.batteryPercent}`);
  assert.ok(Math.abs(telemetry.position[0] - routeFrame.displacement[0]) < 2);
  assert.ok(Math.abs(telemetry.position[1] - routeFrame.displacement[1]) < 2);
  assert.ok(telemetry.position[2] < 1);
  assert.equal(telemetry.phase, "delivered");
});

test("la altitud nunca es negativa y el crucero ronda la altura fijada", () => {
  const sim = new DroneSimulation(route);
  sim.start();
  const dt = 1 / 30;
  let minimum = Infinity;
  let maximum = 0;
  for (let step = 0; step < 600 && !sim.isDelivered; step += 1) {
    sim.step(dt);
    const altitude = sim.telemetry().altitudeAgl;
    minimum = Math.min(minimum, altitude);
    maximum = Math.max(maximum, altitude);
  }
  assert.ok(minimum >= 0);
  assert.ok(maximum < CRUISE_ALTITUDE + 2);
  assert.ok(maximum > CRUISE_ALTITUDE - 2);
});

test("la simulacion es determinista con el mismo paso de tiempo", () => {
  const first = new DroneSimulation(route);
  const second = new DroneSimulation(route);
  first.start();
  second.start();
  for (let step = 0; step < 3000; step += 1) {
    first.step(1 / 30);
    second.step(1 / 30);
  }
  const a = first.telemetry();
  const b = second.telemetry();
  assert.equal(a.t, b.t);
  assert.ok(norm(vec3(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2])) < 1e-12);
  assert.ok(Math.abs(a.distanceTravelled - b.distanceTravelled) < 1e-12);
});

test("la distancia recorrida crece y la restante decrece", () => {
  const sim = new DroneSimulation(route);
  sim.start();
  let previousTravelled = -1;
  let previousRemaining = Infinity;
  for (let step = 0; step < 6000 && !sim.isDelivered; step += 1) {
    sim.step(1 / 30);
    if (step % 30 === 0) {
      const telemetry = sim.telemetry();
      assert.ok(telemetry.distanceTravelled >= previousTravelled);
      assert.ok(telemetry.distanceRemaining <= previousRemaining + 1e-6);
      previousTravelled = telemetry.distanceTravelled;
      previousRemaining = telemetry.distanceRemaining;
    }
  }
});

test("los eventos narran despegue, crucero y entrega", () => {
  const sim = new DroneSimulation(route);
  sim.start();
  const messages: string[] = [];
  for (let step = 0; step < 12000 && !sim.isDelivered; step += 1) {
    sim.step(1 / 30);
    messages.push(...sim.drainEvents().map((event) => event.message));
  }
  messages.push(...sim.drainEvents().map((event) => event.message));
  assert.ok(messages.some((message) => message.includes("Despegue")));
  assert.ok(messages.some((message) => message.includes("crucero")));
  assert.ok(messages.some((message) => message.includes("entregado")));
});

test("el reinicio devuelve el dron al origen", () => {
  const sim = new DroneSimulation(route);
  sim.start();
  for (let step = 0; step < 300; step += 1) sim.step(1 / 30);
  assert.ok(sim.telemetry().distanceTravelled > 0);
  sim.reset();
  const telemetry = sim.telemetry();
  assert.deepEqual(telemetry.position, [0, 0, 0]);
  assert.equal(telemetry.distanceTravelled, 0);
  assert.equal(telemetry.batteryPercent, 100);
  assert.equal(telemetry.phase, "idle");
});

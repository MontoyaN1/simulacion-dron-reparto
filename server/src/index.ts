import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { WebSocket } from "ws";
import type { ClientCommand, ServerMessage } from "@dron/shared";
import {
  CAMPUSES,
  OPERATION_LIMITS,
  isClientCommand,
  routeFrame,
  straightRoute,
} from "@dron/shared";
import { SimulationRuntime } from "./sim/runtime";

const SERVICE_NAME = "simulacion-dron-reparto";
const SERVICE_VERSION = "0.2.0";
const PORT = Number(process.env.PORT ?? 3100);
const HOST = process.env.HOST ?? "0.0.0.0";

const route = straightRoute(routeFrame, OPERATION_LIMITS.cruiseAltitudeAglMeters);
const runtime = new SimulationRuntime(route);

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
});

await app.register(websocket);

app.get("/api/health", async () => ({
  ok: true,
  service: SERVICE_NAME,
  version: SERVICE_VERSION,
  phase: 1,
  uptimeSeconds: Math.round(process.uptime()),
  timestamp: new Date().toISOString(),
}));

app.get("/api/frame", async () => ({
  campuses: CAMPUSES,
  limits: OPERATION_LIMITS,
  frame: {
    origin: routeFrame.origin.id,
    destination: routeFrame.destination.id,
    originGeodetic: routeFrame.originGeodetic,
    destinationGeodetic: routeFrame.destinationGeodetic,
    destinationEnu: routeFrame.destinationEnu,
    displacement: routeFrame.displacement,
    distanceMeters: routeFrame.distanceMeters,
    bearingDeg: routeFrame.bearingDeg,
    enuRotation: routeFrame.enuRotation,
    academicScale: routeFrame.academicScale,
    destinationAcademic: routeFrame.destinationAcademic,
  },
}));

app.get("/api/sim", async () => runtime.session());

app.get("/api/route", async () => ({ route }));

app.post("/api/sim/action", async (request, reply) => {
  const body = request.body as { action?: unknown; value?: unknown } | undefined;
  const action = body?.action;
  let command: ClientCommand | null = null;

  if (action === "start" || action === "pause" || action === "resume" || action === "reset") {
    command = { type: action };
  } else if (action === "speed" && typeof body?.value === "number") {
    command = { type: "speed", value: body.value };
  }

  if (!command) {
    return reply.code(400).send({ error: "Accion invalida" });
  }

  runtime.handle(command);
  return runtime.session();
});

app.get("/ws", { websocket: true }, (socket) => {
  const send = (message: ServerMessage): void => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  const listener = (message: ServerMessage): void => send(message);
  runtime.addListener(listener);

  send({ type: "init", payload: runtime.session() });
  if (!runtime.status().started) {
    runtime.start();
  }

  socket.on("message", (raw) => {
    try {
      const parsed: unknown = JSON.parse(raw.toString());
      if (isClientCommand(parsed)) {
        runtime.handle(parsed);
      }
    } catch {
      return;
    }
  });

  const detach = (): void => runtime.removeListener(listener);
  socket.on("close", detach);
  socket.on("error", detach);
});

app.get("/api", async () => ({
  service: SERVICE_NAME,
  version: SERVICE_VERSION,
  endpoints: ["/api/health", "/api/frame", "/api/sim", "/api/route", "/api/sim/action", "/ws"],
}));

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "cerrando servidor");
  runtime.dispose();
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: PORT, host: HOST });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

import Fastify from "fastify";
import { CAMPUSES, OPERATION_LIMITS, routeFrame } from "@dron/shared";

const SERVICE_NAME = "simulacion-dron-reparto";
const SERVICE_VERSION = "0.1.0";
const PORT = Number(process.env.PORT ?? 3100);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
});

app.get("/api/health", async () => ({
  ok: true,
  service: SERVICE_NAME,
  version: SERVICE_VERSION,
  phase: 0,
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

app.get("/api", async () => ({
  service: SERVICE_NAME,
  version: SERVICE_VERSION,
  endpoints: ["/api/health", "/api/frame"],
}));

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "cerrando servidor");
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

import type { FastifyInstance } from "fastify";
import type { BackendService } from "../../services.js";
import { bodyAsRecord } from "../../http.js";

export async function registerBackgroundRoutes(app: FastifyInstance, services: BackendService) {
  app.post("/background/ingest/raw", async (request) => services.ingestBackground("raw", bodyAsRecord(request)));
  app.post("/background/ingest/normalized", async (request) => services.ingestBackground("normalized", bodyAsRecord(request)));
  app.post("/background/ingest/feature", async (request) => services.ingestBackground("feature", bodyAsRecord(request)));
  app.post("/units/:id/background/weather/forecast", async (request) => services.ingestWeatherForecast((request.params as { id: string }).id, bodyAsRecord(request)));
  app.get("/units/:id/background/latest", async (request) => services.latestBackground((request.params as { id: string }).id));
}

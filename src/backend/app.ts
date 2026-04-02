import Fastify from "fastify";
import multipart from "@fastify/multipart";
import type { BackendRepository } from "./repository.js";
import { BackendService } from "./services.js";
import { LocalFileStorage } from "./storage/local-storage.js";
import { HttpError } from "./utils.js";
import { registerHealthRoutes } from "./modules/health/routes.js";
import { registerUnitRoutes } from "./modules/units/routes.js";
import { registerObservationRoutes } from "./modules/observations/routes.js";
import { registerOperationRoutes } from "./modules/operations/routes.js";
import { registerRecommendationRoutes } from "./modules/recommendations/routes.js";
import { registerReminderRoutes } from "./modules/reminders/routes.js";
import { registerBackgroundRoutes } from "./modules/background-data/routes.js";
import { registerExportRoutes } from "./modules/exports/routes.js";
import { registerPluginAdapterRoutes } from "./modules/plugin-adapter/routes.js";
import type { WeatherForecastProvider } from "./weather.js";

export async function buildBackendApp(params: { repository: BackendRepository; storage: LocalFileStorage; weatherProvider?: WeatherForecastProvider }) {
  await params.storage.ensureReady();
  const app = Fastify({ logger: false });
  await app.register(multipart, { attachFieldsToBody: false, limits: { fileSize: 10 * 1024 * 1024, files: 6 } });

  const services = new BackendService(params.repository, params.storage, params.weatherProvider);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.status(error.statusCode).send({ ok: false, message: error.message, details: error.details ?? null });
      return;
    }
    const message = error instanceof Error ? error.message : "internal error";
    reply.status(500).send({ ok: false, message });
  });

  await registerHealthRoutes(app, services);
  await registerUnitRoutes(app, services);
  await registerObservationRoutes(app, services, params.storage);
  await registerOperationRoutes(app, services);
  await registerRecommendationRoutes(app, services);
  await registerReminderRoutes(app, services);
  await registerBackgroundRoutes(app, services);
  await registerExportRoutes(app, services);
  await registerPluginAdapterRoutes(app, services, params.storage);

  return { app, services };
}

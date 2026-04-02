import type { FastifyInstance } from "fastify";
import type { BackendService } from "../../services.js";
import { bodyAsRecord, readMultipartPayload } from "../../http.js";
import { LocalFileStorage } from "../../storage/local-storage.js";

export async function registerPluginAdapterRoutes(app: FastifyInstance, services: BackendService, storage: LocalFileStorage) {
  app.get("/plugin/units/:id/context-summary", async (request) => services.getPluginContextSummary((request.params as { id: string }).id));
  app.post("/plugin/units/:id/weather/forecast", async (request) => services.pluginWeatherForecast((request.params as { id: string }).id, bodyAsRecord(request)));
  app.post("/plugin/units/:id/observation", async (request) => {
    const contentType = request.headers["content-type"] ?? "";
    const parsed = typeof contentType === "string" && contentType.includes("multipart/form-data") ? await readMultipartPayload(request, storage) : { body: bodyAsRecord(request), attachments: [] };
    return services.pluginObservation((request.params as { id: string }).id, parsed.body, parsed.attachments);
  });
  app.post("/plugin/units/:id/care-check", async (request) => services.pluginCareCheck((request.params as { id: string }).id, bodyAsRecord(request)));
  app.post("/plugin/units/:id/confirm-operation", async (request) => services.pluginConfirmOperation((request.params as { id: string }).id, bodyAsRecord(request)));
  app.get("/plugin/units/:id/active-state", async (request) => services.pluginActiveState((request.params as { id: string }).id));
}

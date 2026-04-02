import type { FastifyInstance } from "fastify";
import type { BackendService } from "../../services.js";
import { bodyAsRecord } from "../../http.js";
import { toBoolean } from "../../utils.js";

export async function registerRecommendationRoutes(app: FastifyInstance, services: BackendService) {
  app.post("/units/:id/care-check", async (request) => {
    const body = bodyAsRecord(request);
    const persist = toBoolean(body.persist) ?? true;
    return services.runCareCheck((request.params as { id: string }).id, persist);
  });
  app.get("/units/:id/recommendations", async (request) => services.listRecommendations((request.params as { id: string }).id));
}

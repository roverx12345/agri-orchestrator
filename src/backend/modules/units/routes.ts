import type { FastifyInstance } from "fastify";
import type { BackendService } from "../../services.js";
import { bodyAsRecord } from "../../http.js";

export async function registerUnitRoutes(app: FastifyInstance, services: BackendService) {
  app.post("/units", async (request) => services.createUnit(bodyAsRecord(request)));
  app.get("/units/:id", async (request) => services.getUnit((request.params as { id: string }).id));
  app.patch("/units/:id", async (request) => services.updateUnit((request.params as { id: string }).id, bodyAsRecord(request)));
  app.post("/units/:id/crop-plans", async (request) => services.createCropPlan((request.params as { id: string }).id, bodyAsRecord(request)));
  app.get("/units/:id/timeline", async (request) => services.getTimeline((request.params as { id: string }).id));
}

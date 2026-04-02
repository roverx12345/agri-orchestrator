import type { FastifyInstance } from "fastify";
import type { BackendService } from "../../services.js";
import { bodyAsRecord } from "../../http.js";

export async function registerOperationRoutes(app: FastifyInstance, services: BackendService) {
  app.post("/units/:id/operations", async (request) => services.createOperation((request.params as { id: string }).id, bodyAsRecord(request)));
  app.get("/units/:id/operations", async (request) => services.listOperations((request.params as { id: string }).id));
}

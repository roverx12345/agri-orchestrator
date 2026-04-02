import type { FastifyInstance } from "fastify";
import type { BackendService } from "../../services.js";
import { bodyAsRecord } from "../../http.js";

export async function registerExportRoutes(app: FastifyInstance, services: BackendService) {
  app.post("/exports", async (request) => services.createExport(bodyAsRecord(request)));
  app.get("/exports/:id", async (request) => services.getExport((request.params as { id: string }).id));
}

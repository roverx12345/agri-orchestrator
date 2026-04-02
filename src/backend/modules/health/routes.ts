import type { FastifyInstance } from "fastify";
import type { BackendService } from "../../services.js";

export async function registerHealthRoutes(app: FastifyInstance, services: BackendService) {
  app.get("/health", async () => services.health());
}

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BackendService } from "../../services.js";
import { bodyAsRecord, readMultipartPayload } from "../../http.js";
import { LocalFileStorage } from "../../storage/local-storage.js";

async function parseObservation(request: FastifyRequest, storage: LocalFileStorage) {
  const contentType = request.headers["content-type"] ?? "";
  if (typeof contentType === "string" && contentType.includes("multipart/form-data")) {
    return readMultipartPayload(request, storage);
  }
  return { body: bodyAsRecord(request), attachments: [] };
}

export async function registerObservationRoutes(app: FastifyInstance, services: BackendService, storage: LocalFileStorage) {
  app.post("/units/:id/observations/user", async (request) => {
    const { body, attachments } = await parseObservation(request, storage);
    return services.createObservation((request.params as { id: string }).id, "user", { body, attachments });
  });
  app.post("/units/:id/observations/coworker", async (request) => {
    const { body, attachments } = await parseObservation(request, storage);
    return services.createObservation((request.params as { id: string }).id, "coworker", { body, attachments });
  });
  app.get("/units/:id/observations", async (request) => services.listObservations((request.params as { id: string }).id));
}

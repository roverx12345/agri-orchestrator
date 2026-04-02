import type { FastifyInstance } from "fastify";
import type { BackendService } from "../../services.js";
import { bodyAsRecord } from "../../http.js";

export async function registerReminderRoutes(app: FastifyInstance, services: BackendService) {
  app.post("/units/:id/reminders", async (request) => services.createReminder((request.params as { id: string }).id, bodyAsRecord(request)));
  app.get("/units/:id/reminders", async (request) => services.listReminders((request.params as { id: string }).id));
  app.post("/reminders/:id/complete", async (request) => services.completeReminder((request.params as { id: string }).id));
  app.post("/reminders/:id/skip", async (request) => services.skipReminder((request.params as { id: string }).id));
}

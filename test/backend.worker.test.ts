import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BackendService } from "../src/backend/services.js";
import { InMemoryRepository } from "../src/backend/repository.js";
import { LocalFileStorage } from "../src/backend/storage/local-storage.js";

describe("seedflower reminder worker flow", () => {
  it("processes due reminders and fans out recurring reminders", async () => {
    const repository = new InMemoryRepository();
    const storage = new LocalFileStorage(path.join(os.tmpdir(), "seedflower-backend-worker"));
    const services = new BackendService(repository, storage);

    const unit = await services.createUnit({ name: "Worker Pot", type: "container" });
    const reminder = await services.createReminder(unit.id, {
      reminderType: "daily-check",
      scheduleBasis: "recurring",
      dueAt: "2026-01-01T08:00:00.000Z",
      recurrenceRule: { intervalDays: 1 },
    });

    const result = await services.processDueReminders("2026-01-01T09:00:00.000Z");
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0].id).toBe(reminder.id);
    expect(result.processed[0].status).toBe("sent");

    const reminders = await services.listReminders(unit.id);
    expect(reminders.some((item) => item.id === reminder.id && item.status === "sent")).toBe(true);
    expect(reminders.some((item) => item.id !== reminder.id && item.status === "pending" && item.scheduleBasis === "recurring")).toBe(true);
  });
});

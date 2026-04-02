import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBackendApp } from "../src/backend/app.js";
import { InMemoryRepository } from "../src/backend/repository.js";
import { LocalFileStorage } from "../src/backend/storage/local-storage.js";

describe("seedflower backend validation guards", () => {
  const repository = new InMemoryRepository();
  const storage = new LocalFileStorage(path.join(os.tmpdir(), "seedflower-backend-validation"));
  let app: Awaited<ReturnType<typeof buildBackendApp>>["app"];

  beforeAll(async () => {
    ({ app } = await buildBackendApp({ repository, storage }));
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects invalid unit coordinates", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/units",
      payload: { name: "Bad Pot", type: "container", latitude: 200 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("latitude");
  });

  it("treats string persist=false as false", async () => {
    const unit = await app.inject({
      method: "POST",
      url: "/units",
      payload: { name: "Persist Pot", type: "container" },
    });
    const unitId = unit.json().id;

    const response = await app.inject({
      method: "POST",
      url: `/units/${unitId}/care-check`,
      payload: { persist: "false" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().savedRecommendations).toHaveLength(0);
    expect(response.json().savedReminders).toHaveLength(0);
  });

  it("requires recurrenceRule for recurring reminders", async () => {
    const unit = await app.inject({
      method: "POST",
      url: "/units",
      payload: { name: "Reminder Pot", type: "container" },
    });
    const unitId = unit.json().id;

    const response = await app.inject({
      method: "POST",
      url: `/units/${unitId}/reminders`,
      payload: { reminderType: "daily", scheduleBasis: "recurring" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("recurrenceRule");
  });

  it("does not allow plugin confirmation across units", async () => {
    const unitA = (await app.inject({ method: "POST", url: "/units", payload: { name: "A", type: "container" } })).json();
    const unitB = (await app.inject({ method: "POST", url: "/units", payload: { name: "B", type: "container" } })).json();

    const operation = await app.inject({
      method: "POST",
      url: `/units/${unitA.id}/operations`,
      payload: { type: "weeding", details: { note: "done" } },
    });

    const response = await app.inject({
      method: "POST",
      url: `/plugin/units/${unitB.id}/confirm-operation`,
      payload: { operationId: operation.json().id, confirmedBy: "plugin" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("does not belong");
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBackendApp } from "../src/backend/app.js";
import { InMemoryRepository } from "../src/backend/repository.js";
import { LocalFileStorage } from "../src/backend/storage/local-storage.js";

describe("seedflower backend smoke flow", () => {
  const repository = new InMemoryRepository();
  const storageRoot = path.join(os.tmpdir(), "seedflower-backend-smoke");
  const storage = new LocalFileStorage(storageRoot);
  let app: Awaited<ReturnType<typeof buildBackendApp>>["app"];
  let unitId = "";
  let reminderId = "";

  beforeAll(async () => {
    ({ app } = await buildBackendApp({ repository, storage }));
  });

  afterAll(async () => {
    await app.close();
  });

  it("runs the minimum integration flow and writes a real export file", async () => {
    const createUnit = await app.inject({
      method: "POST",
      url: "/units",
      payload: {
        name: "Smoke Test Pot",
        type: "container",
        locationText: "window",
        latitude: 31.23,
        longitude: 121.47,
      },
    });
    expect(createUnit.statusCode).toBe(200);
    unitId = createUnit.json().id;

    const createPlan = await app.inject({
      method: "POST",
      url: `/units/${unitId}/crop-plans`,
      payload: {
        crop: "hyacinth",
        cultivar: "Pink Pearl",
        currentStage: "flowering",
        target: "ornamental",
      },
    });
    expect(createPlan.statusCode).toBe(200);

    const createObservation = await app.inject({
      method: "POST",
      url: `/units/${unitId}/observations/user`,
      payload: {
        type: "soil_moisture",
        payload: { status: "dry", note: "surface dry" },
      },
    });
    expect(createObservation.statusCode).toBe(200);

    const careCheck = await app.inject({
      method: "POST",
      url: `/units/${unitId}/care-check`,
      payload: { persist: true },
    });
    expect(careCheck.statusCode).toBe(200);
    const careCheckBody = careCheck.json();
    expect(careCheckBody.savedRecommendations.length).toBeGreaterThan(0);
    expect(careCheckBody.savedReminders.length).toBeGreaterThan(0);
    reminderId = careCheckBody.savedReminders[0].id;

    const createOperation = await app.inject({
      method: "POST",
      url: `/units/${unitId}/operations`,
      payload: {
        type: "spraying",
        confirmed: true,
        confirmedBy: "smoke-test",
        details: { product: "demo-safe", dose: "5ml/L" },
      },
    });
    expect(createOperation.statusCode).toBe(200);
    expect(createOperation.json().confirmed).toBe(true);

    const pluginSummary = await app.inject({
      method: "GET",
      url: `/plugin/units/${unitId}/context-summary`,
    });
    expect(pluginSummary.statusCode).toBe(200);
    expect(pluginSummary.json()).toMatchObject({
      unit: { id: unitId },
      recentObservations: expect.any(Array),
      recentOperations: expect.any(Array),
      recentRecommendations: expect.any(Array),
      pendingReminders: expect.any(Array),
      latestBackground: expect.any(Array),
    });

    const activeState = await app.inject({
      method: "GET",
      url: `/plugin/units/${unitId}/active-state`,
    });
    expect(activeState.statusCode).toBe(200);
    expect(activeState.json()).toMatchObject({
      unitId,
      unitStatus: "active",
      pendingReminderCount: expect.any(Number),
    });

    const exportResponse = await app.inject({
      method: "POST",
      url: "/exports",
      payload: { unitId, format: "csv" },
    });
    expect(exportResponse.statusCode).toBe(200);
    const exportJob = exportResponse.json();
    expect(exportJob.status).toBe("completed");
    expect(typeof exportJob.outputPath).toBe("string");

    const exportPath = path.join(storageRoot, exportJob.outputPath);
    const exportContent = await fs.readFile(exportPath, "utf8");
    expect(exportContent).toContain("# observations");
    expect(exportContent).toContain("# operations");
    expect(exportContent).toContain("# recommendations");
    expect(exportContent).toContain("# reminders");

    const completeReminder = await app.inject({
      method: "POST",
      url: `/reminders/${reminderId}/complete`,
    });
    expect(completeReminder.statusCode).toBe(200);
    expect(completeReminder.json().status).toBe("done");
  });
});

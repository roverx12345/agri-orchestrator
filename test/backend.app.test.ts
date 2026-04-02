import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBackendApp } from "../src/backend/app.js";
import { InMemoryRepository } from "../src/backend/repository.js";
import { LocalFileStorage } from "../src/backend/storage/local-storage.js";

describe("seedflower backend api", () => {
  const repository = new InMemoryRepository();
  const storage = new LocalFileStorage(path.join(os.tmpdir(), "seedflower-backend-tests"));
  const weatherProvider = {
    async getDailyForecast() {
      return {
        provider: "open-meteo",
        timezone: "America/Chicago",
        latitude: 41.59,
        longitude: -93.62,
        days: [
          {
            date: "2026-03-22",
            precipitationProbabilityMax: 20,
            precipitationSumMm: 0.2,
          },
          {
            date: "2026-03-23",
            precipitationProbabilityMax: 88,
            precipitationSumMm: 16,
            windGustsMaxKph: 38,
          },
        ],
      };
    },
  };
  let app: Awaited<ReturnType<typeof buildBackendApp>>["app"];
  let unitId = "";

  beforeAll(async () => {
    ({ app } = await buildBackendApp({ repository, storage, weatherProvider }));
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a unit and crop plan", async () => {
    const createUnit = await app.inject({
      method: "POST",
      url: "/units",
      payload: { name: "Balcony Pot", type: "container", locationText: "east balcony" },
    });
    expect(createUnit.statusCode).toBe(200);
    const unit = createUnit.json();
    unitId = unit.id;

    const createPlan = await app.inject({
      method: "POST",
      url: `/units/${unitId}/crop-plans`,
      payload: { crop: "hyacinth", cultivar: "Delft Blue", currentStage: "flowering", target: "ornamental" },
    });
    expect(createPlan.statusCode).toBe(200);
    expect(createPlan.json().unitId).toBe(unitId);
  });

  it("uploads a user observation as structured JSON", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/units/${unitId}/observations/user`,
      payload: {
        type: "soil_moisture",
        payload: { status: "dry" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().type).toBe("soil_moisture");

    const list = await app.inject({ method: "GET", url: `/units/${unitId}/observations` });
    expect(list.json().length).toBeGreaterThan(0);
  });

  it("returns structured care-check output", async () => {
    const response = await app.inject({ method: "POST", url: `/units/${unitId}/care-check`, payload: { persist: true } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.recommendations)).toBe(true);
    expect(Array.isArray(body.savedRecommendations)).toBe(true);
    expect(Array.isArray(body.savedReminders)).toBe(true);
  });

  it("blocks high-risk operations without confirmation and allows confirmed records", async () => {
    const blocked = await app.inject({
      method: "POST",
      url: `/units/${unitId}/operations`,
      payload: { type: "spraying", details: { product: "demo" } },
    });
    expect(blocked.statusCode).toBe(400);

    const allowed = await app.inject({
      method: "POST",
      url: `/units/${unitId}/operations`,
      payload: { type: "spraying", confirmed: true, details: { product: "demo" } },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().confirmed).toBe(true);
  });

  it("ingests a weather forecast and turns it into a corn rain warning", async () => {
    const field = await app.inject({
      method: "POST",
      url: "/units",
      payload: {
        name: "North Corn Block",
        type: "field",
        latitude: 41.59,
        longitude: -93.62,
        locationText: "north farm",
      },
    });
    expect(field.statusCode).toBe(200);
    const fieldId = field.json().id;

    const plan = await app.inject({
      method: "POST",
      url: `/units/${fieldId}/crop-plans`,
      payload: { crop: "corn", currentStage: "silking", target: "yield" },
    });
    expect(plan.statusCode).toBe(200);

    await app.inject({
      method: "POST",
      url: `/units/${fieldId}/observations/user`,
      payload: { type: "soil_moisture", payload: { status: "adequate" } },
    });
    await app.inject({
      method: "POST",
      url: `/units/${fieldId}/observations/user`,
      payload: { type: "soil_test", payload: { status: "adequate" } },
    });
    await app.inject({
      method: "POST",
      url: `/units/${fieldId}/observations/user`,
      payload: { type: "pest_scout", payload: { level: "low" } },
    });

    const weatherResponse = await app.inject({
      method: "POST",
      url: `/units/${fieldId}/background/weather/forecast`,
      payload: {},
    });
    expect(weatherResponse.statusCode).toBe(200);
    expect(weatherResponse.json().targetForecast).toMatchObject({
      forecastDate: "2026-03-23",
      rainRiskLevel: "high",
    });

    const careCheck = await app.inject({
      method: "POST",
      url: `/units/${fieldId}/care-check`,
      payload: { persist: false },
    });
    expect(careCheck.statusCode).toBe(200);
    const rainRecommendation = careCheck
      .json()
      .recommendations.find((item: { rationale: unknown[] }) => item.rationale.some((entry) => String(entry).includes("Corn field rain risk")));
    expect(rainRecommendation?.severity).toBe("urgent");
  });
});

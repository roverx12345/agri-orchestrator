import { describe, expect, it } from "vitest";
import { runCareRules } from "../src/backend/rules/engine.js";

describe("runCareRules", () => {
  it("falls back to conservative mode when moisture and nutrition inputs are missing", () => {
    const result = runCareRules({
      unit: {
        id: "unit_1",
        name: "Demo Pot",
        type: "container",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      cropPlan: {
        id: "plan_1",
        unitId: "unit_1",
        crop: "hyacinth",
        currentStage: "flowering",
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      recentObservations: [],
      recentOperations: [],
      latestBackground: [],
    });

    expect(result.mode).toBe("conservative");
    expect(result.missingInputs).toContain("recent soil moisture");
    expect(result.recommendations.some((item) => item.category === "water")).toBe(true);
    expect(result.reminders.length).toBeGreaterThan(0);
  });

  it("produces an action-level water recommendation when dryness is observed", () => {
    const result = runCareRules({
      unit: {
        id: "unit_2",
        name: "Field A",
        type: "field",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      cropPlan: undefined,
      recentObservations: [
        {
          id: "obs_1",
          unitId: "unit_2",
          source: "user",
          type: "soil_moisture",
          payload: { status: "dry" },
          attachmentRefs: [],
          createdAt: new Date().toISOString(),
        },
      ],
      recentOperations: [],
      latestBackground: [],
    });

    const waterRecommendation = result.recommendations.find((item) => item.category === "water");
    expect(waterRecommendation?.severity).toBe("action");
  });

  it("raises a rain warning for corn when tomorrow's forecast is wet", () => {
    const result = runCareRules({
      unit: {
        id: "unit_3",
        name: "Corn Block",
        type: "field",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      cropPlan: {
        id: "plan_3",
        unitId: "unit_3",
        crop: "corn",
        currentStage: "silking",
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      recentObservations: [
        {
          id: "obs_weather_1",
          unitId: "unit_3",
          cropPlanId: "plan_3",
          source: "api",
          type: "weather",
          payload: {
            forecastDate: "2026-03-23",
            rainRiskLevel: "high",
            precipitationProbabilityMax: 85,
            precipitationSumMm: 18,
          },
          attachmentRefs: [],
          createdAt: new Date().toISOString(),
        },
      ],
      recentOperations: [],
      latestBackground: [],
    });

    const rainRecommendation = result.recommendations.find((item) =>
      item.rationale.some((entry) => String(entry).includes("Corn field rain risk")),
    );
    expect(rainRecommendation?.severity).toBe("urgent");
    expect(result.reminders.some((item) => item.reminderType === "corn-post-rain-scout")).toBe(true);
  });
});

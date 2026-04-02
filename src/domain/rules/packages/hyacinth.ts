import { makeRecommendation, classifyMoisture, latestObservationOfType, latestPhenologyText, normalizeText, WATER_SIGNAL_LOOKBACK_MS, hasRecentObservation, SCOUT_LOOKBACK_MS } from "../helpers.js";
import type { CropRuleBaseContext, CropRuleContext, CropRulePackage } from "../types.js";

function inferFromPhenology(ctx: CropRuleBaseContext): string | undefined {
  const text = latestPhenologyText(ctx.observations);
  if (!text) {
    return;
  }
  if (text.includes("flower") || text.includes("bloom")) {
    return "flowering";
  }
  if (text.includes("post") || text.includes("spent") || text.includes("faded")) {
    return "post_flowering";
  }
  if (text.includes("root")) {
    return "rooting";
  }
  if (text.includes("leaf") || text.includes("emerg")) {
    return "vegetative";
  }
  if (text.includes("dorm")) {
    return "dormant";
  }
  return;
}

export const hyacinthRulePackage: CropRulePackage = {
  id: "hyacinth",
  cropAliases: ["hyacinth", "water hyacinth", "风信子"],
  inferStage(ctx) {
    return inferFromPhenology(ctx);
  },
  getRequiredInputs(ctx) {
    const required: string[] = [];
    if (!ctx.stage) {
      required.push("currentStage or phenology observation");
    }
    if (!hasRecentObservation(ctx.observations, ["soil_moisture"], ctx.now.getTime(), WATER_SIGNAL_LOOKBACK_MS)) {
      required.push("recent soil_moisture observation");
    }
    return required;
  },
  evaluateWater(ctx) {
    const latestMoisture = latestObservationOfType(ctx.observations, "soil_moisture");
    const moistureClass = classifyMoisture(latestMoisture);

    if (!latestMoisture || !moistureClass) {
      return [];
    }

    if (moistureClass === "dry") {
      return [
        makeRecommendation(ctx, {
          category: "irrigation",
          severity: "medium",
          confidence: 0.74,
          rationale:
            ctx.unit?.kind === "container"
              ? "Hyacinth container moisture looks dry. Container-grown bulbs should be checked before substrate dries hard."
              : "Hyacinth moisture signal looks dry. Check rooting media or water level before the plant loses turgor.",
          proposedActions: [
            "Inspect substrate or water level and restore moisture gradually.",
            "After watering or refilling, log the operation with agri_log_operation.",
          ],
        }),
      ];
    }

    if (moistureClass === "wet") {
      return [
        makeRecommendation(ctx, {
          category: "irrigation",
          severity: "low",
          confidence: 0.68,
          rationale:
            "Hyacinth moisture appears high. Avoid adding more water until the bulb zone and root zone are re-checked.",
          proposedActions: [
            "Delay additional watering.",
            "Check drainage or water-contact depth to avoid bulb rot pressure.",
          ],
        }),
      ];
    }

    return [];
  },
  evaluateNutrition(ctx) {
    const stage = normalizeText(ctx.stage);

    if (stage.includes("flower")) {
      return [
        makeRecommendation(ctx, {
          category: "nutrition",
          severity: "low",
          confidence: 0.84,
          rationale:
            "Hyacinth in active bloom should not be pushed with routine top-dress fertilization in this MVP rule set.",
          proposedActions: [
            "Do not default to additional fertilizer during bloom unless a clear deficiency is observed.",
            "Focus on moisture stability and light management during flowering.",
          ],
        }),
      ];
    }

    if (stage.includes("post")) {
      return [
        makeRecommendation(ctx, {
          category: "planning",
          severity: "low",
          confidence: 0.71,
          rationale:
            "Hyacinth appears post-flowering. Recovery and bulb rebuild logic is only a placeholder in this MVP, so management should stay conservative.",
          proposedActions: [
            "Keep leaves intact while they remain green.",
            "Record follow-up observations for leaf condition and reserve rebuild before deciding next nutrition steps.",
          ],
        }),
      ];
    }

    return [];
  },
  evaluatePest(ctx) {
    if (hasRecentObservation(ctx.observations, ["pest_scout", "disease_scout"], ctx.now.getTime(), SCOUT_LOOKBACK_MS)) {
      return [];
    }

    return [
      makeRecommendation(ctx, {
        category: "ipm",
        severity: "low",
        confidence: 0.62,
        rationale:
          "No recent hyacinth pest or disease scouting note is available. Container and indoor bulb issues are easy to miss when moisture shifts.",
        proposedActions: [
          "Run a quick scout for bulb rot, aphids, and leaf spotting before changing care inputs.",
        ],
      }),
    ];
  },
  evaluateHarvest() {
    return [];
  },
};


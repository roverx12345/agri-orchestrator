import { classifyMoisture, formatTargetYield, hasRecentObservation, hasRecentOperation, hasTargetYield, IRRIGATION_LOOKBACK_MS, latestObservationOfType, latestPhenologyText, makeRecommendation, normalizeText, readStringField, SCOUT_LOOKBACK_MS, SOIL_TEST_LOOKBACK_MS, WATER_SIGNAL_LOOKBACK_MS } from "../helpers.js";
import type { CropRuleBaseContext, CropRuleContext, CropRulePackage } from "../types.js";

function inferCornStage(ctx: CropRuleBaseContext): string | undefined {
  const text = latestPhenologyText(ctx.observations);
  if (!text) {
    return;
  }
  if (text.includes("tassel")) {
    return "tasseling";
  }
  if (text.includes("silk")) {
    return "silking";
  }
  if (text.includes("grain") || text.includes("dent")) {
    return "grain_fill";
  }
  if (text.includes("mature") || text.includes("black layer")) {
    return "mature";
  }
  if (text.includes("v6") || text.includes("vegetative")) {
    return "vegetative";
  }
  return;
}

export const cornRulePackage: CropRulePackage = {
  id: "corn",
  cropAliases: ["corn", "maize", "玉米"],
  inferStage(ctx) {
    return inferCornStage(ctx);
  },
  getRequiredInputs(ctx) {
    const required: string[] = [];
    if (!ctx.stage) {
      required.push("currentStage or phenology observation");
    }
    if (!hasRecentObservation(ctx.observations, ["soil_moisture"], ctx.now.getTime(), WATER_SIGNAL_LOOKBACK_MS)) {
      required.push("recent soil_moisture observation");
    }
    if (!hasTargetYield(ctx.cropPlan)) {
      required.push("targetYield");
    }
    if (!hasRecentObservation(ctx.observations, ["soil_test"], ctx.now.getTime(), SOIL_TEST_LOOKBACK_MS)) {
      required.push("recent soil_test observation");
    }
    return required;
  },
  evaluateWater(ctx) {
    const stage = normalizeText(ctx.stage);
    const latestMoisture = latestObservationOfType(ctx.observations, "soil_moisture");
    const moistureClass = classifyMoisture(latestMoisture);

    if (
      ["tasseling", "silking", "grain_fill"].some((token) => stage.includes(token)) &&
      moistureClass === "dry"
    ) {
      return [
        makeRecommendation(ctx, {
          category: "irrigation",
          severity: "high",
          confidence: 0.82,
          rationale:
            "Corn is in a water-sensitive stage and the latest soil moisture signal reads dry.",
          proposedActions: [
            "Review irrigation timing immediately and prioritize root-zone moisture verification.",
            "If irrigation is applied, log it with agri_log_operation.",
          ],
        }),
      ];
    }

    if (
      ["tasseling", "silking", "grain_fill"].some((token) => stage.includes(token)) &&
      !hasRecentOperation(ctx.operations, "irrigation", ctx.now.getTime(), IRRIGATION_LOOKBACK_MS)
    ) {
      return [
        makeRecommendation(ctx, {
          category: "irrigation",
          severity: "medium",
          confidence: 0.67,
          rationale:
            "Corn is in a water-sensitive stage but there is no recent irrigation log to confirm the field water plan.",
          proposedActions: [
            "Confirm whether irrigation has already occurred and record it if so.",
            "If no irrigation has occurred, review near-term water demand conservatively.",
          ],
        }),
      ];
    }

    return [];
  },
  evaluateNutrition(ctx) {
    const latestSoilTest = latestObservationOfType(ctx.observations, "soil_test");
    const soilInterpretation = normalizeText(
      readStringField(latestSoilTest, ["interpretation", "status", "summary"]) ?? latestSoilTest?.summary,
    );

    if (soilInterpretation.includes("low") || soilInterpretation.includes("deficien")) {
      return [
        makeRecommendation(ctx, {
          category: "nutrition",
          severity: "medium",
          confidence: 0.76,
          rationale: [
            `Corn target yield is ${formatTargetYield(ctx.cropPlan)}, and the latest soil test suggests a low or deficient nutrient condition.`,
            "Use the recorded yield target to size the next fertility review instead of applying inputs ad hoc.",
          ],
          proposedActions: [
            "Review sidedress or fertility adjustments against the soil test before applying inputs.",
            "Log any fertility action through agri_log_operation after the plan is confirmed.",
          ],
        }),
      ];
    }

    return [
      makeRecommendation(ctx, {
        category: "nutrition",
        severity: "low",
        confidence: 0.61,
        rationale:
          `Corn has both targetYield (${formatTargetYield(ctx.cropPlan)}) and a soil test on record, so nutrition decisions can be tied to structured evidence rather than ad hoc guesses.`,
        proposedActions: [
          "Use the recorded target yield and soil test as the basis for the next fertilizer review.",
        ],
      }),
    ];
  },
  evaluatePest(ctx) {
    if (hasRecentObservation(ctx.observations, ["pest_scout", "disease_scout", "weed_scout"], ctx.now.getTime(), SCOUT_LOOKBACK_MS)) {
      return [];
    }

    return [
      makeRecommendation(ctx, {
        category: "ipm",
        severity: "low",
        confidence: 0.66,
        rationale:
          "Corn has no recent scout record for pest, disease, or weed pressure.",
        proposedActions: [
          "Run scouting before escalating to spraying or rescue interventions.",
        ],
      }),
    ];
  },
  evaluateHarvest(ctx) {
    const stage = normalizeText(ctx.stage);
    if (!stage.includes("mature")) {
      return [];
    }

    return [
      makeRecommendation(ctx, {
        category: "harvest",
        severity: "medium",
        confidence: 0.71,
        rationale:
          "Corn appears mature. Final harvest timing should still be human-confirmed against moisture and handling targets.",
          proposedActions: [
            "Verify grain or ear maturity against harvest objectives.",
            "Assign a batchId or lotId before logging the harvest so the lot stays traceable.",
            "Only log harvest after explicit human confirmation.",
          ],
          requiredInputs: ["batchId or lotId"],
          needsHumanConfirm: true,
          governanceReason: "Harvest logs should carry a traceable lot or batch identifier.",
        }),
      ];
  },
};

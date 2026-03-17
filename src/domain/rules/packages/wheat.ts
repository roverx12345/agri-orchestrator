import { hasRecentObservation, hasRecentOperation, IRRIGATION_LOOKBACK_MS, latestPhenologyText, makeRecommendation, normalizeText, PHENOLOGY_LOOKBACK_MS, SCOUT_LOOKBACK_MS } from "../helpers.js";
import type { CropRuleBaseContext, CropRuleContext, CropRulePackage } from "../types.js";

function inferWheatStage(ctx: CropRuleBaseContext): string | undefined {
  const text = latestPhenologyText(ctx.observations);
  if (!text) {
    return;
  }
  if (text.includes("tiller")) {
    return "tillering";
  }
  if (text.includes("boot")) {
    return "booting";
  }
  if (text.includes("head")) {
    return "heading";
  }
  if (text.includes("flower") || text.includes("anthesis")) {
    return "anthesis";
  }
  if (text.includes("grain")) {
    return "grain_fill";
  }
  if (text.includes("mature") || text.includes("ripen")) {
    return "mature";
  }
  return;
}

export const wheatRulePackage: CropRulePackage = {
  id: "wheat",
  cropAliases: ["wheat", "小麦"],
  inferStage(ctx) {
    return inferWheatStage(ctx);
  },
  getRequiredInputs(ctx) {
    const required: string[] = [];
    if (!ctx.stage) {
      required.push("currentStage or phenology observation");
    }
    if (!hasRecentObservation(ctx.observations, ["phenology"], ctx.now.getTime(), PHENOLOGY_LOOKBACK_MS)) {
      required.push("recent phenology observation");
    }
    if (!ctx.operations.some((item) => item.type === "irrigation")) {
      required.push("irrigation history or irrigation decision record");
    }
    return required;
  },
  evaluateWater(ctx) {
    const stage = normalizeText(ctx.stage);
    if (
      ["booting", "heading", "anthesis", "grain_fill"].some((token) => stage.includes(token)) &&
      !hasRecentOperation(ctx.operations, "irrigation", ctx.now.getTime(), IRRIGATION_LOOKBACK_MS)
    ) {
      return [
        makeRecommendation(ctx, {
          category: "irrigation",
          severity: "medium",
          confidence: 0.73,
          rationale:
            "Wheat is in a yield-sensitive stage and there is no recent irrigation log confirming the recent water decision.",
          proposedActions: [
            "Review whether irrigation was intentionally withheld or simply not recorded.",
            "Record the decision path before making another water change.",
          ],
        }),
      ];
    }

    return [];
  },
  evaluateNutrition() {
    return [];
  },
  evaluatePest(ctx) {
    if (hasRecentObservation(ctx.observations, ["disease_scout", "weed_scout", "pest_scout"], ctx.now.getTime(), SCOUT_LOOKBACK_MS)) {
      return [];
    }

    return [
      makeRecommendation(ctx, {
        category: "ipm",
        severity: "low",
        confidence: 0.61,
        rationale:
          "Wheat has no recent scouting note for disease, weed, or insect pressure.",
        proposedActions: [
          "Run a scout before escalating to fungicide, herbicide, or rescue actions.",
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
        confidence: 0.69,
        rationale:
          "Wheat appears mature, but harvest timing should remain a human-confirmed decision tied to grain moisture and field conditions.",
        proposedActions: [
          "Verify harvest readiness against moisture and lodging risk.",
          "Only log harvest once the operator explicitly confirms the action.",
        ],
        needsHumanConfirm: true,
      }),
    ];
  },
};


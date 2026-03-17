import { makeConservativeRecommendation } from "../helpers.js";
import type { CropRuleContext, CropRulePackage } from "../types.js";

export const genericConservativeRulePackage: CropRulePackage = {
  id: "generic",
  cropAliases: [],
  inferStage() {
    return undefined;
  },
  getRequiredInputs(ctx) {
    const required = ["currentStage or phenology observation", "recent soil_moisture observation"];
    if (!ctx.cropPlan.targetYield?.trim()) {
      required.push("targetYield");
    }
    return required;
  },
  evaluateWater() {
    return [];
  },
  evaluateNutrition() {
    return [];
  },
  evaluatePest() {
    return [];
  },
  evaluateHarvest() {
    return [];
  },
};

export function buildGenericFallbackRecommendation(ctx: CropRuleContext) {
  const requiredInputs = genericConservativeRulePackage.getRequiredInputs(ctx);
  return makeConservativeRecommendation(ctx, {
    packageId: genericConservativeRulePackage.id,
    rationale:
      "No crop-specific rule package is registered for this crop, so agri-orchestrator is using generic conservative mode.",
    requiredInputs,
  });
}

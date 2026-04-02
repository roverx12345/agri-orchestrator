import type { AgriStore, CareCheckFilters, CareCheckPlanResult, CareCheckResult, CropPlan, Observation, Operation, Recommendation } from "../../types.js";
import { buildBaseContext, displayCropPlan, makeConservativeRecommendation, makeRecommendation, normalizeText, uniqueStrings } from "./helpers.js";
import { buildGenericFallbackRecommendation } from "./packages/generic.js";
import { getGenericConservativePackage, resolveCropRulePackage } from "./registry.js";
import type { CropRuleBaseContext, CropRuleContext, CropRulePackage } from "./types.js";

function scopeCropPlans(store: AgriStore, filters: CareCheckFilters): CropPlan[] {
  const scope = filters.scope ?? (filters.planId || filters.cropPlanId ? "planId" : "all");
  const scopedPlanId = filters.planId ?? filters.cropPlanId;

  if (scope === "planId") {
    if (!scopedPlanId) {
      return [];
    }
    return store.cropPlans.filter((item) => item.id === scopedPlanId);
  }

  if (filters.unitId) {
    return store.cropPlans.filter((item) => item.unitId === filters.unitId);
  }

  return store.cropPlans;
}

function observationsForPlan(store: AgriStore, cropPlan: CropPlan): Observation[] {
  return store.observations.filter(
    (item) => item.cropPlanId === cropPlan.id || (!item.cropPlanId && item.unitId === cropPlan.unitId),
  );
}

function operationsForPlan(store: AgriStore, cropPlan: CropPlan): Operation[] {
  return store.operations.filter(
    (item) => item.cropPlanId === cropPlan.id || (!item.cropPlanId && item.unitId === cropPlan.unitId),
  );
}

function conservativePlanResult(
  pkg: CropRulePackage,
  ctx: CropRuleContext,
  requiredInputs: string[],
  rationale: string,
): {
  plan: CareCheckPlanResult;
  recommendations: Recommendation[];
} {
  return {
    plan: {
      planId: ctx.cropPlan.id,
      crop: ctx.cropPlan.crop,
      cropPackageId: pkg.id,
      mode: "conservative",
      inferredStage: ctx.inferredStage,
      requiredInputs,
    },
    recommendations: [
      makeConservativeRecommendation(ctx, {
        packageId: pkg.id,
        rationale,
        requiredInputs,
        severity: requiredInputs.some((item) => normalizeText(item).includes("stage")) ? "high" : "medium",
      }),
    ],
  };
}

function evaluatePlan(
  store: AgriStore,
  cropPlan: CropPlan,
  now: Date,
): {
  plan: CareCheckPlanResult;
  recommendations: Recommendation[];
} {
  const unit = store.productionUnits.find((item) => item.id === cropPlan.unitId);
  const baseCtx: CropRuleBaseContext = {
    store,
    cropPlan,
    unit,
    observations: observationsForPlan(store, cropPlan),
    operations: operationsForPlan(store, cropPlan),
    now,
    nowIso: now.toISOString(),
  };
  const resolvedPackage = resolveCropRulePackage(cropPlan.crop);

  if (!resolvedPackage) {
    const genericPackage = getGenericConservativePackage();
    const genericCtx = buildBaseContext(baseCtx);
    return {
      plan: {
        planId: cropPlan.id,
        crop: cropPlan.crop,
        cropPackageId: genericPackage.id,
        mode: "conservative",
        inferredStage: genericCtx.inferredStage,
        requiredInputs: genericPackage.getRequiredInputs(genericCtx),
      },
      recommendations: [buildGenericFallbackRecommendation(genericCtx)],
    };
  }

  const inferredStage = resolvedPackage.inferStage(baseCtx);
  const ctx = buildBaseContext(baseCtx, inferredStage);
  const requiredInputs = uniqueStrings(resolvedPackage.getRequiredInputs(ctx));

  if (!unit) {
    return conservativePlanResult(
      resolvedPackage,
      ctx,
      uniqueStrings([...requiredInputs, "valid production unit"]),
      `Crop plan ${displayCropPlan(cropPlan)} references a missing production unit, so ${resolvedPackage.id} rules are restricted to conservative mode.`,
    );
  }

  if (requiredInputs.length > 0) {
    return conservativePlanResult(
      resolvedPackage,
      ctx,
      requiredInputs,
      `${resolvedPackage.id} crop rules entered conservative mode because critical inputs are missing for ${displayCropPlan(cropPlan)}.`,
    );
  }

  const recommendations = [
    ...resolvedPackage.evaluateWater(ctx),
    ...resolvedPackage.evaluateNutrition(ctx),
    ...resolvedPackage.evaluatePest(ctx),
    ...resolvedPackage.evaluateHarvest(ctx),
    ...evaluateRecordedOperationCompliance(ctx),
  ];

  if (recommendations.length === 0) {
    recommendations.push(
      makeRecommendation(ctx, {
        category: "monitoring",
        severity: "low",
        confidence: 0.58,
        rationale:
          `${resolvedPackage.id} package found no urgent action from the current MVP rules. Keep structured observations current.`,
        proposedActions: [
          "Continue logging observations so future rules can stay evidence-based.",
        ],
      }),
    );
  }

  return {
    plan: {
      planId: cropPlan.id,
      crop: cropPlan.crop,
      cropPackageId: resolvedPackage.id,
      mode: "package",
      inferredStage,
      requiredInputs: [],
    },
    recommendations,
  };
}

function evaluateRecordedOperationCompliance(ctx: CropRuleContext): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const operation of ctx.operations) {
    if (operation.type === "spraying") {
      const missingFields: string[] = [];
      if (!operation.compliance?.productName?.trim()) {
        missingFields.push("compliance.productName");
      }
      if (!operation.compliance?.labelTargetCrop?.trim()) {
        missingFields.push("compliance.labelTargetCrop");
      }
      if (!operation.compliance?.lotNumber?.trim()) {
        missingFields.push("compliance.lotNumber");
      }
      if (typeof operation.compliance?.phiDays !== "number" || !Number.isFinite(operation.compliance.phiDays)) {
        missingFields.push("compliance.phiDays");
      }

      if (missingFields.length > 0) {
        recommendations.push(
          makeRecommendation(ctx, {
            category: "compliance",
            severity: "critical",
            confidence: 0.92,
            rationale: [
              "A spraying record exists without the minimum compliance fields expected by the MVP.",
              "Chemical-use records should include product identity, label target crop, and PHI before they are treated as auditable.",
            ],
            requiredInputs: missingFields,
            proposedActions: [
              "Backfill the missing spraying compliance fields before relying on this record operationally.",
            ],
            needsHumanConfirm: true,
            governanceReason: "Spraying records need minimum PHI and label metadata.",
          }),
        );
      }
    }

    if (
      (operation.type === "harvest" || operation.type === "postharvest") &&
      operation.confirmed === true &&
      !operation.batchId?.trim() &&
      !operation.lotId?.trim()
    ) {
      recommendations.push(
        makeRecommendation(ctx, {
          category: "compliance",
          severity: "high",
          confidence: 0.9,
          rationale: [
            `${operation.type} was logged without a batchId or lotId.`,
            "Confirmed harvest and postharvest work should stay traceable to a batch or lot.",
          ],
          requiredInputs: ["batchId or lotId"],
          proposedActions: [
            "Assign a batchId or lotId to the recorded harvest or postharvest operation.",
          ],
          needsHumanConfirm: true,
          governanceReason: "Harvest traceability is part of the MVP compliance surface.",
        }),
      );
    }
  }

  return recommendations;
}

export function careCheckAll(
  store: AgriStore,
  filters: CareCheckFilters = {},
  now = new Date(),
): CareCheckResult {
  const recommendations: Recommendation[] = [];
  const plans: CareCheckPlanResult[] = [];
  const scopedPlans = scopeCropPlans(store, filters);

  if (store.productionUnits.length === 0) {
    recommendations.push({
      id: `rec_seed_units_${now.getTime()}`,
      category: "planning",
      severity: "medium",
      confidence: 0.95,
      rationale: ["No production units are registered, so agronomy checks cannot be scoped safely."],
      requiredInputs: ["production unit"],
      proposedActions: [
        "Register a field, greenhouse, orchard, container, or nursery with agri_register_unit.",
      ],
      governance: { needsHumanConfirm: false },
      createdAt: now.toISOString(),
    });
  }

  if (scopedPlans.length === 0) {
    recommendations.push({
      id: `rec_seed_plans_${now.getTime()}`,
      cropPlanId: filters.planId ?? filters.cropPlanId,
      unitId: filters.unitId,
      category: "planning",
      severity: "medium",
      confidence: 0.95,
      rationale: [
        filters.scope === "planId"
          ? "Requested plan scope could not be resolved to a crop plan."
          : "No crop plan is available in scope, so crop-specific care logic cannot run.",
      ],
      requiredInputs: ["crop plan"],
      proposedActions: [
        "Register a crop plan with agri_register_crop_plan before requesting care recommendations.",
      ],
      governance: { needsHumanConfirm: false },
      createdAt: now.toISOString(),
    });

    return { recommendations, plans };
  }

  for (const cropPlan of scopedPlans) {
    const evaluated = evaluatePlan(store, cropPlan, now);
    plans.push(evaluated.plan);
    recommendations.push(...evaluated.recommendations);
  }

  return { recommendations, plans };
}

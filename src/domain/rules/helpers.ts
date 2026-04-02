import { randomUUID } from "node:crypto";
import type {
  CropPlan,
  Observation,
  Operation,
  Recommendation,
  RecommendationCategory,
  RecommendationSeverity,
} from "../../types.js";
import type { CropRuleBaseContext, CropRuleContext } from "./types.js";

export const WATER_SIGNAL_LOOKBACK_MS = 72 * 60 * 60 * 1000;
export const SCOUT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
export const SOIL_TEST_LOOKBACK_MS = 180 * 24 * 60 * 60 * 1000;
export const PHENOLOGY_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
export const IRRIGATION_LOOKBACK_MS = 10 * 24 * 60 * 60 * 1000;

export function parseTime(value?: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function inLookback(value: string | undefined, nowMs: number, lookbackMs: number): boolean {
  const parsed = parseTime(value);
  return parsed !== null && parsed >= nowMs - lookbackMs;
}

export function latestBy<T>(items: T[], pick: (item: T) => string | undefined): T | undefined {
  return [...items].sort((left, right) => {
    const leftTime = parseTime(pick(left)) ?? 0;
    const rightTime = parseTime(pick(right)) ?? 0;
    return rightTime - leftTime;
  })[0];
}

export function normalizeText(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

export function normalizeStage(value?: string): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

export function normalizeCropName(value?: string): string {
  return normalizeText(value).replace(/[_-]+/g, " ");
}

export function displayCropPlan(plan: CropPlan): string {
  return `${plan.crop}${plan.cultivar ? ` / ${plan.cultivar}` : ""}`;
}

export function hasTargetYield(plan: CropPlan): boolean {
  return (
    (typeof plan.targetYield === "string" && plan.targetYield.trim().length > 0) ||
    (typeof plan.targetYieldValue === "number" && Number.isFinite(plan.targetYieldValue))
  );
}

export function formatTargetYield(plan: CropPlan): string {
  if (typeof plan.targetYield === "string" && plan.targetYield.trim().length > 0) {
    return plan.targetYield.trim();
  }
  if (typeof plan.targetYieldValue === "number" && Number.isFinite(plan.targetYieldValue)) {
    return `${plan.targetYieldValue}${plan.targetYieldUnit ? ` ${plan.targetYieldUnit}` : ""}`;
  }
  return "unset";
}

export function observationsForPlan(ctx: CropRuleBaseContext): Observation[] {
  return ctx.observations;
}

export function operationsForPlan(ctx: CropRuleBaseContext): Operation[] {
  return ctx.operations;
}

export function latestObservationOfType(
  observations: Observation[],
  type: Observation["type"],
): Observation | undefined {
  return latestBy(
    observations.filter((item) => item.type === type),
    (item) => item.observedAt,
  );
}

export function hasRecentObservation(
  observations: Observation[],
  types: Observation["type"][],
  nowMs: number,
  lookbackMs: number,
): boolean {
  return observations.some(
    (item) => types.includes(item.type) && inLookback(item.observedAt, nowMs, lookbackMs),
  );
}

export function hasRecentOperation(
  operations: Operation[],
  type: Operation["type"],
  nowMs: number,
  lookbackMs: number,
): boolean {
  return operations.some(
    (item) => item.type === type && inLookback(item.performedAt, nowMs, lookbackMs),
  );
}

export function readStringField(
  observation: Observation | undefined,
  keys: string[],
): string | undefined {
  if (!observation?.data) {
    return;
  }

  for (const key of keys) {
    const value = observation.data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return;
}

export function readNumberField(
  observation: Observation | undefined,
  keys: string[],
): number | undefined {
  if (!observation?.data) {
    return;
  }

  for (const key of keys) {
    const value = observation.data[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return;
}

export function classifyMoisture(observation: Observation | undefined): "dry" | "adequate" | "wet" | undefined {
  if (!observation) {
    return;
  }

  const status = normalizeText(
    readStringField(observation, ["status", "condition", "level", "interpretation"]) ??
      observation.summary,
  );
  const numeric =
    readNumberField(observation, ["vwc", "moisture", "value", "percent"]) ??
    readNumberField(observation, ["relative", "reading"]);

  if (status.includes("dry") || status.includes("low")) {
    return "dry";
  }
  if (status.includes("wet") || status.includes("waterlogged") || status.includes("high")) {
    return "wet";
  }
  if (status.includes("adequate") || status.includes("optimal") || status.includes("moderate")) {
    return "adequate";
  }
  if (numeric !== undefined) {
    if (numeric < 25) {
      return "dry";
    }
    if (numeric > 70) {
      return "wet";
    }
    return "adequate";
  }

  return;
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function makeRecommendation(
  ctx: CropRuleContext,
  params: {
    category: RecommendationCategory;
    severity: RecommendationSeverity;
    confidence: number;
    rationale: string | string[];
    requiredInputs?: string[];
    proposedActions: string[];
    needsHumanConfirm?: boolean;
    governanceReason?: string;
  },
): Recommendation {
  return {
    id: `rec_${randomUUID()}`,
    cropPlanId: ctx.cropPlan.id,
    unitId: ctx.cropPlan.unitId,
    category: params.category,
    severity: params.severity,
    confidence: params.confidence,
    rationale: Array.isArray(params.rationale) ? params.rationale : [params.rationale],
    requiredInputs: uniqueStrings(params.requiredInputs ?? []),
    proposedActions: params.proposedActions,
    governance: {
      needsHumanConfirm: params.needsHumanConfirm === true,
      reason: params.governanceReason,
    },
    createdAt: ctx.nowIso,
  };
}

export function makeConservativeRecommendation(
  ctx: CropRuleContext,
  params: {
    packageId: string;
    rationale: string;
    requiredInputs: string[];
    severity?: RecommendationSeverity;
  },
): Recommendation {
  return makeRecommendation(ctx, {
    category: "data_quality",
    severity: params.severity ?? "medium",
    confidence: 0.93,
    rationale: params.rationale,
    requiredInputs: params.requiredInputs,
    proposedActions: [
      "Log the missing inputs before changing irrigation, fertilization, spraying, or harvest plans.",
      "Use agri_log_observation or agri_log_operation to complete the record.",
      "Keep actions conservative until the crop package has enough signal to evaluate safely.",
    ],
  });
}

export function buildBaseContext(
  params: CropRuleBaseContext,
  inferredStage?: string,
): CropRuleContext {
  const planStage = normalizeStage(params.cropPlan.currentStage);
  return {
    ...params,
    inferredStage,
    stage: planStage ?? normalizeStage(inferredStage),
  };
}

export function latestPhenologyText(observations: Observation[]): string | undefined {
  const latestPhenology = latestObservationOfType(observations, "phenology");
  return normalizeText(latestPhenology?.summary ?? readStringField(latestPhenology, ["stage", "summary"]));
}

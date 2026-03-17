import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  AnyAgentTool,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import {
  CareCheckSchema,
  CropPlanSchema,
  ObservationSchema,
  OperationSchema,
  ProductionUnitSchema,
  type CareCheckInput,
  type CropPlanInput,
  type ObservationInput,
  type OperationInput,
  type ProductionUnitInput,
} from "./schema.js";
import { careCheckAll } from "./rules.js";
import { appendMemorySummary, loadStore, resolveStorePath, writeStore } from "./store.js";
import type {
  AgriStore,
  CropPlan,
  Operation,
  ProductionUnit,
  Recommendation,
} from "./types.js";
import { isHighRiskOperationType } from "./types.js";

type ToolFactoryContext = {
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  messageChannel?: string;
  agentAccountId?: string;
  requesterSenderId?: string;
  senderIsOwner?: boolean;
  sandboxed?: boolean;
};

function resolveWorkspaceDir(ctx: ToolFactoryContext): string {
  return path.resolve(ctx.workspaceDir ?? process.cwd());
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string, preferred?: string): string {
  if (preferred && preferred.trim()) {
    return preferred.trim();
  }

  return `${prefix}_${randomUUID()}`;
}

function textResult(text: string, details: Record<string, unknown>): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

function displayUnit(unit: ProductionUnit): string {
  return `${unit.name} (${unit.kind})`;
}

function displayCropPlan(plan: CropPlan): string {
  return `${plan.crop}${plan.cultivar ? ` / ${plan.cultivar}` : ""}`;
}

function summarizeRecommendation(item: Recommendation): string {
  return `${item.severity.toUpperCase()} ${item.category}: ${item.rationale}`;
}

async function resolveScopedReferences(
  store: AgriStore,
  params: {
    unitId?: string;
    cropPlanId?: string;
  },
): Promise<{
  unitId?: string;
  cropPlanId?: string;
  cropPlan?: CropPlan;
  errors: string[];
}> {
  const errors: string[] = [];
  let { unitId, cropPlanId } = params;
  let cropPlan: CropPlan | undefined;

  if (cropPlanId) {
    cropPlan = store.cropPlans.find((item) => item.id === cropPlanId);
    if (!cropPlan) {
      errors.push(`cropPlanId ${cropPlanId} was not found.`);
    } else if (!unitId) {
      unitId = cropPlan.unitId;
    }
  }

  if (unitId && !store.productionUnits.some((item) => item.id === unitId)) {
    errors.push(`unitId ${unitId} was not found.`);
  }

  return {
    unitId,
    cropPlanId,
    cropPlan,
    errors,
  };
}

function sortActivePlans(store: AgriStore, limit: number): CropPlan[] {
  return [...store.cropPlans]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, limit);
}

export async function buildPromptSummary(
  workspaceDir: string,
  limit: number,
): Promise<string | undefined> {
  const store = await loadStore(workspaceDir);
  const plans = sortActivePlans(store, limit);

  if (plans.length === 0) {
    return;
  }

  const lines = plans.map((plan) => {
    const unit = store.productionUnits.find((item) => item.id === plan.unitId);
    const stage = plan.currentStage?.trim() || "stage unknown";
    const unitLabel = unit ? `${unit.name} (${unit.kind})` : plan.unitId;
    return `- ${displayCropPlan(plan)} at ${stage} in ${unitLabel}`;
  });

  return `Agri context snapshot:\n${lines.join("\n")}`;
}

export function createRegisterUnitToolFactory(_api: OpenClawPluginApi) {
  return (ctx: ToolFactoryContext): AnyAgentTool => ({
    name: "agri_register_unit",
    label: "Agri Register Unit",
    description: "Register or update a production unit such as a field, greenhouse, orchard, container, or nursery.",
    parameters: ProductionUnitSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as ProductionUnitInput;
      const workspaceDir = resolveWorkspaceDir(ctx);
      const store = await loadStore(workspaceDir);
      const timestamp = nowIso();
      const unit: ProductionUnit = {
        id: makeId("unit", params.id),
        name: params.name.trim(),
        kind: params.kind,
        description: params.description?.trim(),
        location: params.location?.trim(),
        areaM2: params.areaM2,
        tags: params.tags,
        notes: params.notes?.trim(),
        metadata: params.metadata,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const existingIndex = store.productionUnits.findIndex((item) => item.id === unit.id);

      if (existingIndex >= 0) {
        const existing = store.productionUnits[existingIndex]!;
        store.productionUnits[existingIndex] = {
          ...existing,
          ...unit,
          createdAt: existing.createdAt,
          updatedAt: timestamp,
        };
      } else {
        store.productionUnits.push(unit);
      }

      const storePath = await writeStore(workspaceDir, store);
      await appendMemorySummary(workspaceDir, {
        title: "Registered production unit",
        timestamp,
        lines: [
          `Unit: ${displayUnit(unit)}`,
          `Location: ${unit.location ?? "n/a"}`,
          `Store: ${storePath}`,
        ],
      });

      return textResult(`Production unit saved: ${displayUnit(unit)}`, {
        ok: true,
        item: existingIndex >= 0 ? store.productionUnits[existingIndex] : unit,
        storePath,
      });
    },
  });
}

export function createRegisterCropPlanToolFactory(_api: OpenClawPluginApi) {
  return (ctx: ToolFactoryContext): AnyAgentTool => ({
    name: "agri_register_crop_plan",
    label: "Agri Register Crop Plan",
    description: "Register or update a crop plan attached to a production unit.",
    parameters: CropPlanSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as CropPlanInput;
      const workspaceDir = resolveWorkspaceDir(ctx);
      const store = await loadStore(workspaceDir);
      const timestamp = nowIso();
      const unit = store.productionUnits.find((item) => item.id === params.unitId);

      if (!unit) {
        return textResult(`Cannot register crop plan: unitId ${params.unitId} was not found.`, {
          ok: false,
          error: "missing_unit",
        });
      }

      const cropPlan: CropPlan = {
        id: makeId("plan", params.id),
        unitId: params.unitId,
        crop: params.crop.trim(),
        cultivar: params.cultivar?.trim(),
        season: params.season?.trim(),
        sowingDate: params.sowingDate,
        transplantDate: params.transplantDate,
        currentStage: params.currentStage?.trim(),
        targetYield: params.targetYield?.trim(),
        notes: params.notes?.trim(),
        metadata: params.metadata,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      const existingIndex = store.cropPlans.findIndex((item) => item.id === cropPlan.id);

      if (existingIndex >= 0) {
        const existing = store.cropPlans[existingIndex]!;
        store.cropPlans[existingIndex] = {
          ...existing,
          ...cropPlan,
          createdAt: existing.createdAt,
          updatedAt: timestamp,
        };
      } else {
        store.cropPlans.push(cropPlan);
      }

      const storedPlan = existingIndex >= 0 ? store.cropPlans[existingIndex]! : cropPlan;
      const storePath = await writeStore(workspaceDir, store);
      await appendMemorySummary(workspaceDir, {
        title: "Registered crop plan",
        timestamp,
        lines: [
          `Crop plan: ${displayCropPlan(storedPlan)}`,
          `Unit: ${displayUnit(unit)}`,
          `Stage: ${storedPlan.currentStage ?? "unset"}`,
        ],
      });

      return textResult(`Crop plan saved: ${displayCropPlan(storedPlan)}`, {
        ok: true,
        item: storedPlan,
        storePath,
      });
    },
  });
}

export function createLogObservationToolFactory(_api: OpenClawPluginApi) {
  return (ctx: ToolFactoryContext): AnyAgentTool => ({
    name: "agri_log_observation",
    label: "Agri Log Observation",
    description: "Log a structured field, greenhouse, orchard, or container observation.",
    parameters: ObservationSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as ObservationInput;
      const workspaceDir = resolveWorkspaceDir(ctx);
      const store = await loadStore(workspaceDir);
      const timestamp = nowIso();
      const refs = await resolveScopedReferences(store, {
        unitId: params.unitId,
        cropPlanId: params.cropPlanId,
      });

      if (!refs.unitId && !refs.cropPlanId) {
        refs.errors.push("Provide at least one of unitId or cropPlanId.");
      }

      if (refs.errors.length > 0) {
        return textResult(`Observation was not saved: ${refs.errors.join(" ")}`, {
          ok: false,
          error: "invalid_scope",
          errors: refs.errors,
        });
      }

      const observation = {
        id: makeId("obs", params.id),
        unitId: refs.unitId,
        cropPlanId: refs.cropPlanId,
        type: params.type,
        observedAt: params.observedAt,
        summary: params.summary?.trim(),
        source: params.source?.trim(),
        data: params.data,
        createdAt: timestamp,
      };

      store.observations.push(observation);
      const storePath = await writeStore(workspaceDir, store);
      await appendMemorySummary(workspaceDir, {
        title: "Logged observation",
        timestamp,
        lines: [
          `Type: ${observation.type}`,
          `Scope: ${observation.cropPlanId ?? observation.unitId ?? "unknown"}`,
          `Summary: ${observation.summary ?? "n/a"}`,
        ],
      });

      return textResult(`Observation logged: ${observation.type}`, {
        ok: true,
        item: observation,
        storePath,
      });
    },
  });
}

export function createLogOperationToolFactory(_api: OpenClawPluginApi) {
  return (ctx: ToolFactoryContext): AnyAgentTool => ({
    name: "agri_log_operation",
    label: "Agri Log Operation",
    description: "Log a production operation. High-risk operations require confirmed=true.",
    parameters: OperationSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = rawParams as OperationInput;
      const workspaceDir = resolveWorkspaceDir(ctx);
      const store = await loadStore(workspaceDir);
      const timestamp = nowIso();
      const refs = await resolveScopedReferences(store, {
        unitId: params.unitId,
        cropPlanId: params.cropPlanId,
      });

      if (!refs.unitId && !refs.cropPlanId) {
        refs.errors.push("Provide at least one of unitId or cropPlanId.");
      }

      if (refs.errors.length > 0) {
        return textResult(`Operation was not saved: ${refs.errors.join(" ")}`, {
          ok: false,
          error: "invalid_scope",
          errors: refs.errors,
        });
      }

      if (isHighRiskOperationType(params.type) && params.confirmed !== true) {
        return textResult(
          `Blocked ${params.type} log. High-risk operations require confirmed=true for human confirmation.`,
          {
            ok: false,
            blocked: true,
            reason: "needs_human_confirmation",
            type: params.type,
          },
        );
      }

      const operation: Operation = {
        id: makeId("op", params.id),
        unitId: refs.unitId,
        cropPlanId: refs.cropPlanId,
        type: params.type,
        performedAt: params.performedAt,
        summary: params.summary?.trim(),
        confirmed: params.confirmed,
        operator: params.operator?.trim(),
        data: params.data,
        createdAt: timestamp,
      };

      store.operations.push(operation);
      const storePath = await writeStore(workspaceDir, store);
      await appendMemorySummary(workspaceDir, {
        title: "Logged operation",
        timestamp,
        lines: [
          `Type: ${operation.type}`,
          `Scope: ${operation.cropPlanId ?? operation.unitId ?? "unknown"}`,
          `Confirmed: ${operation.confirmed === true ? "yes" : "no"}`,
        ],
      });

      return textResult(`Operation logged: ${operation.type}`, {
        ok: true,
        item: operation,
        storePath,
      });
    },
  });
}

export function createCareCheckToolFactory(_api: OpenClawPluginApi) {
  return (ctx: ToolFactoryContext): AnyAgentTool => ({
    name: "agri_care_check",
    label: "Agri Care Check",
    description:
      "Run the MVP agronomy rule engine across the current workspace and produce structured recommendations.",
    parameters: CareCheckSchema,
    execute: async (_toolCallId, rawParams) => {
      const params = (rawParams ?? {}) as CareCheckInput;
      const workspaceDir = resolveWorkspaceDir(ctx);
      const store = await loadStore(workspaceDir);
      const asOf = params.asOf ? new Date(params.asOf) : new Date();
      const persistRecommendations = params.persistRecommendations !== false;
      const scope = params.scope ?? ((params.planId ?? params.cropPlanId) ? "planId" : "all");
      const planId = params.planId ?? params.cropPlanId;

      if (scope === "planId" && !planId) {
        return textResult("care_check with scope=planId requires planId.", {
          ok: false,
          error: "missing_plan_id",
        });
      }

      const { recommendations, plans } = careCheckAll(
        store,
        {
          scope,
          planId,
          unitId: params.unitId,
        },
        Number.isNaN(asOf.getTime()) ? new Date() : asOf,
      );

      let storePath = resolveStorePath(workspaceDir);
      if (persistRecommendations) {
        store.recommendations.push(...recommendations);
        storePath = await writeStore(workspaceDir, store);
      }

      await appendMemorySummary(workspaceDir, {
        title: "Care check",
        timestamp: nowIso(),
        lines: [
          `Scope: ${scope}${planId ? ` (${planId})` : ""}`,
          ...recommendations.slice(0, 4).map(summarizeRecommendation),
        ],
      });

      return textResult(`Generated ${recommendations.length} agronomy recommendation(s).`, {
        ok: true,
        scope,
        planId,
        recommendationCount: recommendations.length,
        recommendations,
        plans,
        storePath,
        persistedRecommendations: persistRecommendations,
      });
    },
  });
}

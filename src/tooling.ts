import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
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
import {
  findLatestForecastObservation,
  formatWeatherPromptLine,
  lookupLocationCoordinates,
  syncWorkspaceWeather,
} from "./weather.js";

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

export type PromptSummaryOptions = {
  includeWeather?: boolean;
  autoRefreshWeather?: boolean;
  weatherRefreshAfterMs?: number;
  weatherFetchFn?: typeof fetch;
  now?: Date;
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
  return `${item.severity.toUpperCase()} ${item.category}: ${item.rationale.join(" ")}`;
}

function trimOptional(value?: string): string | undefined {
  if (!value) {
    return;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeLookupText(value?: string): string | undefined {
  const trimmed = trimOptional(value);
  if (!trimmed) {
    return;
  }

  return trimmed.toLowerCase().replace(/\s+/g, " ");
}

function slugifyLookupText(value?: string): string | undefined {
  const normalized = normalizeLookupText(value);
  if (!normalized) {
    return;
  }

  const ascii = normalized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const slug = ascii
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

  return slug || normalized.replace(/\s+/g, "-");
}

function uniqueUnitsById(units: ProductionUnit[]): ProductionUnit[] {
  const seen = new Set<string>();
  return units.filter((unit) => {
    if (seen.has(unit.id)) {
      return false;
    }

    seen.add(unit.id);
    return true;
  });
}

function findUnitsByReference(store: AgriStore, reference?: string): ProductionUnit[] {
  const trimmed = trimOptional(reference);
  if (!trimmed) {
    return [];
  }

  const normalized = normalizeLookupText(trimmed);
  const slug = slugifyLookupText(trimmed);

  return uniqueUnitsById(
    store.productionUnits.filter((unit) => {
      if (unit.id === trimmed) {
        return true;
      }

      const unitIdNormalized = normalizeLookupText(unit.id);
      const unitNameNormalized = normalizeLookupText(unit.name);
      if (
        normalized &&
        (unitIdNormalized === normalized || unitNameNormalized === normalized)
      ) {
        return true;
      }

      const unitIdSlug = slugifyLookupText(unit.id);
      const unitNameSlug = slugifyLookupText(unit.name);
      return Boolean(slug && (unitIdSlug === slug || unitNameSlug === slug));
    }),
  );
}

function resolveUnitReference(
  store: AgriStore,
  reference?: string,
): {
  unit?: ProductionUnit;
  error?: string;
} {
  const trimmed = trimOptional(reference);
  if (!trimmed) {
    return {};
  }

  const matches = findUnitsByReference(store, trimmed);
  if (matches.length === 1) {
    return { unit: matches[0] };
  }

  if (matches.length > 1) {
    return {
      error: `unit reference ${trimmed} matched multiple production units; use an exact unit id.`,
    };
  }

  return {
    error: `unit reference ${trimmed} was not found.`,
  };
}

function findEquivalentUnit(
  store: AgriStore,
  params: ProductionUnitInput,
): ProductionUnit | undefined {
  const resolvedById = resolveUnitReference(store, params.id).unit;
  if (resolvedById) {
    return resolvedById;
  }

  const targetName = normalizeLookupText(params.name);
  const targetLocation = normalizeLookupText(params.location);

  return store.productionUnits.find(
    (unit) =>
      unit.kind === params.kind &&
      normalizeLookupText(unit.name) === targetName &&
      normalizeLookupText(unit.location) === targetLocation,
  );
}

const PLACEHOLDER_COMPLIANCE_VALUES = new Set([
  "unknown",
  "not recorded",
  "unrecorded",
  "not provided",
  "unspecified",
  "n/a",
  "na",
  "none",
  "todo",
  "tbd",
  "\u672a\u8bb0\u5f55",
  "\u672a\u77e5",
  "\u5f85\u8865\u5145",
  "\u672a\u63d0\u4f9b",
]);

const GENERIC_SPRAYING_PRODUCT_NAMES = new Set([
  "pesticide",
  "fungicide",
  "insecticide",
  "herbicide",
  "chemical",
  "spray",
  "spray product",
  "routine spray",
  "routine-spray",
  "regular spray",
  "\u519c\u836f",
  "\u6740\u83cc\u5242",
  "\u6740\u866b\u5242",
  "\u9664\u8349\u5242",
]);

const MISSING_DETAIL_NOTE_MARKERS = [
  "not provided",
  "not recorded",
  "unknown",
  "missing",
  "unspecified",
  "\u672a\u63d0\u4f9b",
  "\u672a\u8bb0\u5f55",
  "\u672a\u77e5",
  "\u7f3a\u5c11",
];

function isPlaceholderComplianceValue(value?: string): boolean {
  const normalized = normalizeLookupText(value);
  return normalized ? PLACEHOLDER_COMPLIANCE_VALUES.has(normalized) : false;
}

function isGenericSprayingProductName(value?: string): boolean {
  const normalized = normalizeLookupText(value);
  return normalized ? GENERIC_SPRAYING_PRODUCT_NAMES.has(normalized) : false;
}

function notesIndicateMissingDetails(value?: string): boolean {
  const normalized = normalizeLookupText(value);
  return normalized
    ? MISSING_DETAIL_NOTE_MARKERS.some((marker) => normalized.includes(marker))
    : false;
}

function isDateLikeComplianceValue(value?: string): boolean {
  const trimmed = trimOptional(value);
  if (!trimmed) {
    return false;
  }

  return (
    /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ||
    /^\d{4}\/\d{2}\/\d{2}$/.test(trimmed) ||
    /^\d{8}$/.test(trimmed) ||
    /^\d{4}-\d{2}-\d{2}[t\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?$/i.test(
      trimmed,
    )
  );
}

function hasLettersAndDigits(value?: string): boolean {
  if (!value) {
    return false;
  }

  return /[a-z]/i.test(value) && /\d/.test(value);
}

function collectDisallowedSprayProductNames(
  store: AgriStore,
  refs?: {
    unitId?: string;
    cropPlan?: CropPlan;
  },
): Set<string> {
  const unit = refs?.unitId
    ? store.productionUnits.find((item) => item.id === refs.unitId)
    : undefined;
  const unitPlans = refs?.unitId
    ? store.cropPlans.filter((item) => item.unitId === refs.unitId)
    : [];

  const candidates = [
    normalizeLookupText(refs?.cropPlan?.crop),
    normalizeLookupText(refs?.cropPlan?.cultivar),
    normalizeLookupText(unit?.name),
    normalizeLookupText(unit?.id),
    ...unitPlans.flatMap((plan) => [
      normalizeLookupText(plan.crop),
      normalizeLookupText(plan.cultivar),
    ]),
  ];

  return new Set(
    candidates.filter((value): value is string => Boolean(value)),
  );
}

async function readLatestUserMessageText(ctx: ToolFactoryContext): Promise<string | undefined> {
  const agentDir = trimOptional(ctx.agentDir);
  const sessionIds = Array.from(
    new Set([trimOptional(ctx.sessionId), trimOptional(ctx.sessionKey)].filter(Boolean)),
  );
  if (!agentDir || sessionIds.length === 0) {
    return;
  }

  const sessionDirs = Array.from(
    new Set([
      path.join(agentDir, "sessions"),
      path.join(path.dirname(agentDir), "sessions"),
    ]),
  );

  for (const sessionDir of sessionDirs) {
    for (const sessionId of sessionIds) {
      const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);

      let raw: string;
      try {
        raw = await fs.readFile(sessionPath, "utf8");
      } catch {
        continue;
      }

      const lines = raw.split(/\r?\n/).filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const entry = JSON.parse(lines[index]!);
          if (entry?.type !== "message" || entry.message?.role !== "user") {
            continue;
          }

          const parts = Array.isArray(entry.message?.content) ? entry.message.content : [];
          const text = parts
            .filter((part: unknown) => typeof part === "object" && part !== null && (part as { type?: string }).type === "text")
            .map((part: { text?: string }) => part.text ?? "")
            .join("\n")
            .trim();

          if (text) {
            return text;
          }
        } catch {
          continue;
        }
      }
    }
  }
}

async function inferredSprayingComplianceFields(
  ctx: ToolFactoryContext,
  params: OperationInput,
): Promise<string[]> {
  if (params.type !== "spraying") {
    return [];
  }

  const latestUserText = await readLatestUserMessageText(ctx);
  const normalizedMessage = normalizeLookupText(latestUserText);
  if (!normalizedMessage) {
    return [];
  }

  const inferred: string[] = [];
  const productName = normalizeLookupText(params.compliance?.productName);
  if (productName && !normalizedMessage.includes(productName)) {
    inferred.push("compliance.productName");
  }

  const lotNumber = normalizeLookupText(params.compliance?.lotNumber);
  if (lotNumber && !normalizedMessage.includes(lotNumber)) {
    inferred.push("compliance.lotNumber");
  }

  return inferred;
}

function normalizeOperationCompliance(
  compliance: OperationInput["compliance"],
): Operation["compliance"] {
  if (!compliance) {
    return;
  }

  return {
    productName: trimOptional(compliance.productName),
    labelTargetCrop: trimOptional(compliance.labelTargetCrop),
    phiDays:
      typeof compliance.phiDays === "number" && Number.isFinite(compliance.phiDays)
        ? compliance.phiDays
        : undefined,
    reiHours:
      typeof compliance.reiHours === "number" && Number.isFinite(compliance.reiHours)
        ? compliance.reiHours
        : undefined,
    lotNumber: trimOptional(compliance.lotNumber),
    notes: trimOptional(compliance.notes),
  };
}

function missingComplianceFields(params: OperationInput): string[] {
  const required: string[] = [];

  if (params.type === "spraying") {
    if (!params.compliance?.productName?.trim()) {
      required.push("compliance.productName");
    }
    if (!params.compliance?.labelTargetCrop?.trim()) {
      required.push("compliance.labelTargetCrop");
    }
    if (!params.compliance?.lotNumber?.trim()) {
      required.push("compliance.lotNumber");
    }
    if (
      typeof params.compliance?.phiDays !== "number" ||
      !Number.isFinite(params.compliance.phiDays)
    ) {
      required.push("compliance.phiDays");
    }
  }

  if (
    (params.type === "harvest" || params.type === "postharvest") &&
    !params.batchId?.trim() &&
    !params.lotId?.trim()
  ) {
    required.push("batchId or lotId");
  }

  return required;
}

function invalidComplianceFields(
  store: AgriStore,
  params: OperationInput,
  refs?: {
    unitId?: string;
    cropPlanId?: string;
    cropPlan?: CropPlan;
  },
): string[] {
  const invalid: string[] = [];

  if (params.type === "spraying") {
    if (isPlaceholderComplianceValue(params.compliance?.productName)) {
      invalid.push("compliance.productName");
    }
    if (isGenericSprayingProductName(params.compliance?.productName)) {
      invalid.push("compliance.productName");
    }
    if (isDateLikeComplianceValue(params.compliance?.productName)) {
      invalid.push("compliance.productName");
    }
    if (isPlaceholderComplianceValue(params.compliance?.labelTargetCrop)) {
      invalid.push("compliance.labelTargetCrop");
    }
    if (isPlaceholderComplianceValue(params.compliance?.lotNumber)) {
      invalid.push("compliance.lotNumber");
    }
    if (isDateLikeComplianceValue(params.compliance?.lotNumber)) {
      invalid.push("compliance.lotNumber");
    }
    if (notesIndicateMissingDetails(params.compliance?.notes)) {
      invalid.push("compliance.notes");
    }

    const productName = normalizeLookupText(params.compliance?.productName);
    const disallowedProductNames = collectDisallowedSprayProductNames(store, refs);
    const labelTargetCrop = normalizeLookupText(params.compliance?.labelTargetCrop);
    if (labelTargetCrop) {
      disallowedProductNames.add(labelTargetCrop);
    }
    if (productName && disallowedProductNames.has(productName)) {
      invalid.push("compliance.productName");
    }

    const lotNumber = trimOptional(params.compliance?.lotNumber);
    if (lotNumber && (lotNumber.length < 4 || !hasLettersAndDigits(lotNumber))) {
      invalid.push("compliance.lotNumber");
    }
  }

  return Array.from(new Set(invalid));
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
    const resolvedUnit = resolveUnitReference(store, unitId);
    if (resolvedUnit.unit) {
      unitId = resolvedUnit.unit.id;
    } else if (resolvedUnit.error) {
      errors.push(resolvedUnit.error);
    }
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
  options: PromptSummaryOptions = {},
): Promise<string | undefined> {
  let store = await loadStore(workspaceDir);
  const plans = sortActivePlans(store, limit);
  const weatherErrors = new Map<string, string>();

  if (plans.length === 0) {
    return;
  }

  if (options.includeWeather) {
    const targetUnitIds = Array.from(new Set(plans.map((plan) => plan.unitId)));
    if (options.autoRefreshWeather !== false && targetUnitIds.length > 0) {
      try {
        const syncResult = await syncWorkspaceWeather(workspaceDir, {
          now: options.now,
          fetchFn: options.weatherFetchFn,
          refreshAfterMs: options.weatherRefreshAfterMs,
          unitIds: targetUnitIds,
          store,
        });
        store = syncResult.store;
        for (const item of syncResult.errors) {
          weatherErrors.set(item.unitId, item.message);
        }
      } catch {
        // Weather context should never block prompt construction.
      }
    }
  }

  const lines = plans.flatMap((plan) => {
    const unit = store.productionUnits.find((item) => item.id === plan.unitId);
    const stage = plan.currentStage?.trim() || "stage unknown";
    const unitLabel = unit ? `${unit.name} (${unit.kind})` : plan.unitId;
    const planLine = `- ${displayCropPlan(plan)} at ${stage} in ${unitLabel}`;

    if (!options.includeWeather || !unit) {
      return [planLine];
    }

    const latestWeather = findLatestForecastObservation(store, unit.id);
    let weatherLine = latestWeather && formatWeatherPromptLine(latestWeather);
    if (!weatherLine) {
      const error = weatherErrors.get(unit.id);
      if (error?.includes("no geocoding result")) {
        weatherLine =
          `- Tomorrow weather for ${unit.location ?? unit.name}: unavailable ` +
          `(please ask the user for a more standard address or manual latitude/longitude).`;
      } else {
        weatherLine = `- Tomorrow weather for ${unit.location ?? unit.name}: unavailable (no fresh forecast cached).`;
      }
    }

    return [planLine, weatherLine];
  });

  return `Agri context snapshot:\n${lines.join("\n")}`;
}

export function createRegisterUnitToolFactory(api: OpenClawPluginApi) {
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
      const equivalentUnit = findEquivalentUnit(store, params);
      const autoLookupLocation = api.pluginConfig?.enableRegisterLocationLookup !== false;
      let locationLookupWarning: string | undefined;
      const unit: ProductionUnit = {
        id: equivalentUnit?.id ?? makeId("unit", params.id),
        name: params.name.trim(),
        kind: params.kind,
        description: params.description?.trim(),
        location: params.location?.trim(),
        latitude: typeof params.latitude === "number" ? params.latitude : undefined,
        longitude: typeof params.longitude === "number" ? params.longitude : undefined,
        timezone: params.timezone?.trim(),
        areaM2: params.areaM2,
        tags: params.tags,
        notes: params.notes?.trim(),
        metadata: params.metadata,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      if (
        autoLookupLocation &&
        unit.location &&
        typeof unit.latitude !== "number" &&
        typeof unit.longitude !== "number"
      ) {
        try {
          const resolved = await lookupLocationCoordinates(unit.location);
          unit.latitude = resolved.latitude;
          unit.longitude = resolved.longitude;
          unit.timezone = unit.timezone ?? resolved.timezone;
        } catch (error) {
          locationLookupWarning =
            error instanceof Error && error.message.includes("no geocoding result")
              ? "Coordinates were not resolved from the location text. Ask the user for a more standard address or manual latitude/longitude."
              : "Automatic coordinate lookup failed; ask the user for latitude/longitude if weather context is important.";
        }
      }
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
          typeof unit.latitude === "number" && typeof unit.longitude === "number"
            ? `Coordinates: ${unit.latitude}, ${unit.longitude}`
            : `Coordinates: ${locationLookupWarning ?? "not resolved"}`,
          `Store: ${storePath}`,
        ],
      });

      const responseText =
        `Production unit saved: ${displayUnit(unit)}` +
        (typeof unit.latitude === "number" && typeof unit.longitude === "number"
          ? ` (coordinates ${unit.latitude}, ${unit.longitude})`
          : locationLookupWarning
            ? `\n${locationLookupWarning}`
            : "");

      return textResult(responseText, {
        ok: true,
        item: existingIndex >= 0 ? store.productionUnits[existingIndex] : unit,
        storePath,
        locationLookupWarning,
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
      const resolvedUnit = resolveUnitReference(store, params.unitId);
      const unit = resolvedUnit.unit;

      if (!unit) {
        return textResult(
          `Cannot register crop plan: ${resolvedUnit.error ?? `unitId ${params.unitId} was not found.`}`,
          {
            ok: false,
            error: "missing_unit",
          },
        );
      }

      const cropPlan: CropPlan = {
        id: makeId("plan", params.id),
        unitId: unit.id,
        crop: params.crop.trim(),
        cultivar: params.cultivar?.trim(),
        season: params.season?.trim(),
        sowingDate: params.sowingDate,
        transplantDate: params.transplantDate,
        currentStage: params.currentStage?.trim(),
        targetYield: params.targetYield?.trim(),
        targetYieldValue: params.targetYieldValue,
        targetYieldUnit: params.targetYieldUnit?.trim(),
        rulesetVersion: params.rulesetVersion?.trim(),
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
        source: params.source,
        qualityFlag: params.qualityFlag,
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

      const missingFields = missingComplianceFields(params);
      if (missingFields.length > 0) {
        return textResult(
          `Blocked ${params.type} log. Complete the MVP compliance fields first: ${missingFields.join(", ")}.`,
          {
            ok: false,
            blocked: true,
            reason: "missing_compliance_fields",
            missingFields,
            type: params.type,
          },
        );
      }

      const invalidFields = invalidComplianceFields(store, params, refs);
      if (invalidFields.length > 0) {
        return textResult(
          `Blocked ${params.type} log. Placeholder compliance values are not accepted for: ${invalidFields.join(", ")}.`,
          {
            ok: false,
            blocked: true,
            reason: "placeholder_compliance_fields",
            invalidFields,
            type: params.type,
          },
        );
      }

      const inferredFields = await inferredSprayingComplianceFields(ctx, params);
      if (inferredFields.length > 0) {
        return textResult(
          `Blocked ${params.type} log. The latest user message did not supply verifiable values for: ${inferredFields.join(", ")}.`,
          {
            ok: false,
            blocked: true,
            reason: "inferred_compliance_fields",
            inferredFields,
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
        amount: params.amount,
        unit: trimOptional(params.unit),
        batchId: trimOptional(params.batchId),
        lotId: trimOptional(params.lotId),
        compliance: normalizeOperationCompliance(params.compliance),
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
          `Batch/Lot: ${operation.batchId ?? operation.lotId ?? "n/a"}`,
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

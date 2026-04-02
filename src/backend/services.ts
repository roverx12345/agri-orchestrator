import type {
  AttachmentRef,
  BackgroundLayer,
  CareCheckOutput,
  CropPlan,
  Json,
  JsonObject,
  Observation,
  OperationLog,
  Recommendation,
  Reminder,
  Unit,
} from "./domain.js";
import {
  EXPORT_FORMATS,
  HIGH_RISK_OPERATION_TYPES,
  OBSERVATION_SOURCES,
  OBSERVATION_TYPES,
  OPERATION_RISK_LEVELS,
  OPERATION_TYPES,
  CROP_TARGETS,
  QUALITY_FLAGS,
  REMINDER_SCHEDULE_BASIS,
  REMINDER_STATUSES,
  UNIT_STATUSES,
  UNIT_TYPES,
  asJsonObject,
} from "./domain.js";
import type {
  BackendRepository,
  CreateBackgroundInput,
  CreateCropPlanInput,
  CreateObservationInput,
  CreateUnitInput,
} from "./repository.js";
import { LocalFileStorage } from "./storage/local-storage.js";
import { runCareRules } from "./rules/engine.js";
import { assert, clampConfidence, isIsoDateString, nowIso, toBoolean, toNumber } from "./utils.js";
import { buildWeatherFeaturePayload, OpenMeteoForecastProvider, type WeatherForecastProvider } from "./weather.js";

function ensureEnum<T extends readonly string[]>(value: unknown, values: T, field: string): T[number] {
  assert(typeof value === "string" && values.includes(value as T[number]), `${field} is invalid`);
  return value as T[number];
}

function ensureString(value: unknown, field: string): string {
  assert(typeof value === "string" && value.trim().length > 0, `${field} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  assert(isIsoDateString(value), `${field} must be a valid ISO date or datetime`);
  return new Date(String(value)).toISOString();
}

function optionalDateOnly(value: unknown, field: string): string | undefined {
  return optionalDate(value, field)?.slice(0, 10);
}

function optionalLatitude(value: unknown, field: string): number | undefined {
  const numeric = toNumber(value);
  if (numeric === undefined) return undefined;
  assert(numeric >= -90 && numeric <= 90, `${field} must be between -90 and 90`);
  return numeric;
}

function optionalLongitude(value: unknown, field: string): number | undefined {
  const numeric = toNumber(value);
  if (numeric === undefined) return undefined;
  assert(numeric >= -180 && numeric <= 180, `${field} must be between -180 and 180`);
  return numeric;
}

function optionalNonNegativeNumber(value: unknown, field: string): number | undefined {
  const numeric = toNumber(value);
  if (numeric === undefined) return undefined;
  assert(numeric >= 0, `${field} must be >= 0`);
  return numeric;
}

function validateRecurrenceRule(value: unknown): JsonObject | undefined {
  if (value === undefined || value === null) return undefined;
  const rule = asJsonObject(value);
  const intervalDays = toNumber(rule.intervalDays);
  const intervalHours = toNumber(rule.intervalHours);
  if (intervalDays !== undefined) {
    assert(intervalDays > 0, "recurrenceRule.intervalDays must be > 0");
  }
  if (intervalHours !== undefined) {
    assert(intervalHours > 0, "recurrenceRule.intervalHours must be > 0");
  }
  assert(intervalDays !== undefined || intervalHours !== undefined, "recurrenceRule requires intervalDays or intervalHours");
  return rule;
}

function buildProfileSummary(params: {
  unit: Unit;
  cropPlan?: CropPlan;
  observations: Observation[];
  operations: OperationLog[];
  recommendations: Recommendation[];
  reminders: Reminder[];
}): JsonObject {
  const latestObservation = params.observations[0];
  const latestOperation = params.operations[0];
  const latestRecommendation = params.recommendations[0];
  const pendingReminders = params.reminders.filter((item) => item.status === "pending" || item.status === "sent");

  return {
    unitType: params.unit.type,
    activeCrop: params.cropPlan?.crop ?? null,
    activeCultivar: params.cropPlan?.cultivar ?? null,
    currentStage: params.cropPlan?.currentStage ?? null,
    observationCount: params.observations.length,
    operationCount: params.operations.length,
    recommendationCount: params.recommendations.length,
    pendingReminderCount: pendingReminders.length,
    latestObservationAt: latestObservation?.createdAt ?? null,
    latestOperationAt: latestOperation?.createdAt ?? null,
    latestRecommendationSeverity: latestRecommendation?.severity ?? null,
    latestRecommendationCategory: latestRecommendation?.category ?? null,
  };
}

function csvEscape(value: unknown): string {
  const text = value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvSection(name: string, rows: Record<string, unknown>[]): string {
  if (rows.length === 0) {
    return `# ${name}\nempty\n`;
  }
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [keys.join(",")];
  for (const row of rows) {
    lines.push(keys.map((key) => csvEscape(row[key])).join(","));
  }
  return `# ${name}\n${lines.join("\n")}\n`;
}

function addHours(baseIso: string, hours: number): string {
  const date = new Date(baseIso);
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

export class BackendService {
  constructor(
    private readonly repository: BackendRepository,
    private readonly storage: LocalFileStorage,
    private readonly weatherProvider: WeatherForecastProvider = new OpenMeteoForecastProvider(),
  ) {}

  async health() {
    await this.storage.ensureReady();
    await this.repository.healthCheck();
    return { ok: true };
  }

  async createUnit(body: Record<string, unknown>): Promise<Unit> {
    const input: CreateUnitInput = {
      name: ensureString(body.name, "name"),
      type: ensureEnum(body.type, UNIT_TYPES, "type"),
      locationText: optionalString(body.locationText ?? body.location),
      latitude: optionalLatitude(body.latitude, "latitude"),
      longitude: optionalLongitude(body.longitude, "longitude"),
      geometryGeojson: body.geometryGeojson ? asJsonObject(body.geometryGeojson) : undefined,
      areaM2: optionalNonNegativeNumber(body.areaM2 ?? body.area, "areaM2"),
      containerInfo: body.containerInfo ? asJsonObject(body.containerInfo) : undefined,
      irrigationMethod: optionalString(body.irrigationMethod),
      ownerRef: optionalString(body.ownerRef ?? body.owner),
      projectRef: optionalString(body.projectRef ?? body.project),
      status: body.status ? ensureEnum(body.status, UNIT_STATUSES, "status") : "active",
      profileSummary: {},
    };
    const unit = await this.repository.createUnit(input);
    await this.repository.createAuditLog({ actor: "api", action: "unit.create", targetType: "unit", targetId: unit.id, metadata: { unitType: unit.type } });
    return unit;
  }

  async getUnit(id: string): Promise<Unit> {
    const unit = await this.repository.getUnit(id);
    assert(unit, "unit not found", 404);
    return unit;
  }

  async updateUnit(id: string, body: Record<string, unknown>): Promise<Unit> {
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = ensureString(body.name, "name");
    if (body.type !== undefined) patch.type = ensureEnum(body.type, UNIT_TYPES, "type");
    if (body.locationText !== undefined || body.location !== undefined) patch.locationText = optionalString(body.locationText ?? body.location);
    if (body.latitude !== undefined) patch.latitude = optionalLatitude(body.latitude, "latitude");
    if (body.longitude !== undefined) patch.longitude = optionalLongitude(body.longitude, "longitude");
    if (body.areaM2 !== undefined || body.area !== undefined) patch.areaM2 = optionalNonNegativeNumber(body.areaM2 ?? body.area, "areaM2");
    if (body.containerInfo !== undefined) patch.containerInfo = asJsonObject(body.containerInfo);
    if (body.irrigationMethod !== undefined) patch.irrigationMethod = optionalString(body.irrigationMethod);
    if (body.ownerRef !== undefined || body.owner !== undefined) patch.ownerRef = optionalString(body.ownerRef ?? body.owner);
    if (body.projectRef !== undefined || body.project !== undefined) patch.projectRef = optionalString(body.projectRef ?? body.project);
    if (body.status !== undefined) patch.status = ensureEnum(body.status, UNIT_STATUSES, "status");
    const updated = await this.repository.updateUnit(id, patch);
    assert(updated, "unit not found", 404);
    await this.repository.createAuditLog({ actor: "api", action: "unit.update", targetType: "unit", targetId: id, metadata: patch as JsonObject });
    return updated;
  }

  async createCropPlan(unitId: string, body: Record<string, unknown>): Promise<CropPlan> {
    await this.getUnit(unitId);
    const planInput: CreateCropPlanInput = {
      unitId,
      crop: ensureString(body.crop, "crop"),
      cultivar: optionalString(body.cultivar),
      sowingDate: optionalDate(body.sowingDate, "sowingDate")?.slice(0, 10),
      transplantDate: optionalDate(body.transplantDate, "transplantDate")?.slice(0, 10),
      currentStage: optionalString(body.currentStage),
      target: body.target ? ensureEnum(body.target, CROP_TARGETS, "target") : undefined,
      active: toBoolean(body.active) ?? true,
    };
    const plan = await this.repository.createCropPlan(planInput);
    await this.refreshUnitProfileSummary(unitId);
    await this.repository.createAuditLog({ actor: "api", action: "crop-plan.create", targetType: "crop_plan", targetId: plan.id, metadata: { unitId } });
    return plan;
  }

  async getTimeline(unitId: string) {
    await this.getUnit(unitId);
    return this.repository.getTimeline(unitId);
  }

  async createObservation(unitId: string, source: Observation["source"], params: { body?: Record<string, unknown>; attachments?: AttachmentRef[] }): Promise<Observation> {
    await this.getUnit(unitId);
    assert(OBSERVATION_SOURCES.includes(source), "source is invalid");
    const body = params.body ?? {};
    const activePlan = await this.repository.getActiveCropPlanByUnit(unitId);
    const observation: CreateObservationInput = {
      unitId,
      cropPlanId: optionalString(body.cropPlanId) ?? activePlan?.id,
      source,
      type: ensureEnum(body.type, OBSERVATION_TYPES, "type"),
      payload: asJsonObject(body.payload),
      attachmentRefs: params.attachments ?? [],
      qualityFlag: body.qualityFlag ? ensureEnum(body.qualityFlag, QUALITY_FLAGS, "qualityFlag") : undefined,
    };
    const created = await this.repository.createObservation(observation);
    await this.refreshUnitProfileSummary(unitId);
    await this.repository.createAuditLog({ actor: source, action: "observation.create", targetType: "observation", targetId: created.id, metadata: { unitId, type: created.type } });
    return created;
  }

  async listObservations(unitId: string): Promise<Observation[]> {
    await this.getUnit(unitId);
    return this.repository.listObservationsByUnit(unitId);
  }

  async createOperation(unitId: string, body: Record<string, unknown>, actor = "api"): Promise<OperationLog> {
    await this.getUnit(unitId);
    const activePlan = await this.repository.getActiveCropPlanByUnit(unitId);
    const type = ensureEnum(body.type, OPERATION_TYPES, "type");
    const confirmed = toBoolean(body.confirmed) ?? false;
    if (HIGH_RISK_OPERATION_TYPES.has(type)) {
      assert(confirmed || optionalString(body.confirmedBy), `${type} requires confirmed=true or confirmedBy`, 400);
    }
    const created = await this.repository.createOperation({
      unitId,
      cropPlanId: optionalString(body.cropPlanId) ?? activePlan?.id,
      type,
      details: asJsonObject(body.details),
      confirmed,
      confirmedBy: optionalString(body.confirmedBy) ?? (confirmed ? actor : undefined),
      confirmedAt: confirmed ? optionalDate(body.confirmedAt, "confirmedAt") ?? nowIso() : undefined,
      riskLevel: body.riskLevel ? ensureEnum(body.riskLevel, OPERATION_RISK_LEVELS, "riskLevel") : HIGH_RISK_OPERATION_TYPES.has(type) ? "high" : "low",
      linkedRecommendationId: optionalString(body.linkedRecommendationId),
      linkedReminderId: optionalString(body.linkedReminderId),
    });
    await this.refreshUnitProfileSummary(unitId);
    await this.repository.createAuditLog({ actor, action: "operation.create", targetType: "operation", targetId: created.id, metadata: { unitId, type } });
    return created;
  }

  async listOperations(unitId: string): Promise<OperationLog[]> {
    await this.getUnit(unitId);
    return this.repository.listOperationsByUnit(unitId);
  }

  async runCareCheck(unitId: string, persist = true): Promise<CareCheckOutput & { savedRecommendations: Recommendation[]; savedReminders: Reminder[] }> {
    const context = await this.repository.getCareCheckContext(unitId);
    assert(context, "unit not found", 404);
    const output = runCareRules(context);
    let savedRecommendations: Recommendation[] = [];
    let savedReminders: Reminder[] = [];

    if (persist) {
      savedRecommendations = await this.repository.createRecommendations(
        output.recommendations.map((item) => ({
          unitId: item.unitId,
          cropPlanId: item.cropPlanId,
          category: item.category,
          severity: item.severity,
          rationale: item.rationale,
          requiredInputs: item.requiredInputs,
          proposedActions: item.proposedActions,
          confidence: clampConfidence(item.confidence),
          needsHumanConfirm: item.needsHumanConfirm,
          engine: item.engine,
        })),
      );

      const existingReminders = await this.repository.listRemindersByUnit(unitId);
      const deduped = output.reminders.filter((item) => {
        return !existingReminders.some(
          (existing) =>
            (existing.status === "pending" || existing.status === "sent") &&
            existing.reminderType === item.reminderType &&
            existing.cropPlanId === item.cropPlanId,
        );
      });

      savedReminders = await this.repository.createReminders(
        deduped.map((item) => ({
          unitId: item.unitId,
          cropPlanId: item.cropPlanId,
          reminderType: item.reminderType,
          scheduleBasis: item.scheduleBasis,
          dueAt: item.dueAt,
          status: item.status ?? "pending",
          linkedRecommendationId: undefined,
          recurrenceRule: item.recurrenceRule,
          payload: item.payload,
        })),
      );
      await this.refreshUnitProfileSummary(unitId);
    }

    await this.repository.createAuditLog({ actor: "engine", action: "care-check.run", targetType: "unit", targetId: unitId, metadata: { mode: output.mode, persist } });
    return { ...output, savedRecommendations, savedReminders };
  }

  async listRecommendations(unitId: string): Promise<Recommendation[]> {
    await this.getUnit(unitId);
    return this.repository.listRecommendationsByUnit(unitId);
  }

  async createReminder(unitId: string, body: Record<string, unknown>): Promise<Reminder> {
    await this.getUnit(unitId);
    const activePlan = await this.repository.getActiveCropPlanByUnit(unitId);
    const scheduleBasis = body.scheduleBasis ? ensureEnum(body.scheduleBasis, REMINDER_SCHEDULE_BASIS, "scheduleBasis") : "manual";
    const recurrenceRule = validateRecurrenceRule(body.recurrenceRule);
    if (scheduleBasis === "recurring") {
      assert(recurrenceRule, "recurring reminders require recurrenceRule");
    }
    const reminders = await this.repository.createReminders([
      {
        unitId,
        cropPlanId: optionalString(body.cropPlanId) ?? activePlan?.id,
        reminderType: ensureString(body.reminderType, "reminderType"),
        scheduleBasis,
        dueAt: optionalDate(body.dueAt, "dueAt") ?? addHours(nowIso(), 24),
        status: body.status ? ensureEnum(body.status, REMINDER_STATUSES, "status") : "pending",
        linkedRecommendationId: optionalString(body.linkedRecommendationId),
        recurrenceRule,
        payload: body.payload ? asJsonObject(body.payload) : {},
      },
    ]);
    await this.refreshUnitProfileSummary(unitId);
    return reminders[0];
  }

  async listReminders(unitId: string): Promise<Reminder[]> {
    await this.getUnit(unitId);
    return this.repository.listRemindersByUnit(unitId);
  }

  async completeReminder(id: string): Promise<Reminder> {
    const reminder = await this.repository.updateReminderStatus(id, { status: "done", completedAt: nowIso() });
    assert(reminder, "reminder not found", 404);
    await this.refreshUnitProfileSummary(reminder.unitId);
    return reminder;
  }

  async skipReminder(id: string): Promise<Reminder> {
    const reminder = await this.repository.updateReminderStatus(id, { status: "skipped", skippedAt: nowIso() });
    assert(reminder, "reminder not found", 404);
    await this.refreshUnitProfileSummary(reminder.unitId);
    return reminder;
  }

  async ingestBackground(layer: BackgroundLayer, body: Record<string, unknown>): Promise<{ items: Awaited<ReturnType<BackendRepository["createBackgroundSnapshots"]>> }> {
    const rawItems = Array.isArray(body.items) ? body.items : [body];
    const items: CreateBackgroundInput[] = rawItems.map((item) => {
      const row = asJsonObject(item);
      return {
        unitId: ensureString(row.unitId, "unitId"),
        date: optionalDate(row.date, "date")?.slice(0, 10) ?? nowIso().slice(0, 10),
        layer,
        source: ensureString(row.source, "source"),
        payload: asJsonObject(row.payload),
        qualityFlag: row.qualityFlag ? ensureEnum(row.qualityFlag, QUALITY_FLAGS, "qualityFlag") : undefined,
      };
    });
    for (const item of items) {
      await this.getUnit(item.unitId);
    }
    const created = await this.repository.createBackgroundSnapshots(items);
    for (const item of created) {
      await this.refreshUnitProfileSummary(item.unitId);
    }
    return { items: created };
  }

  async latestBackground(unitId: string) {
    await this.getUnit(unitId);
    return this.repository.listLatestBackgroundByUnit(unitId, 10);
  }

  async ingestWeatherForecast(unitId: string, body: Record<string, unknown>) {
    const unit = await this.getUnit(unitId);
    assert(typeof unit.latitude === "number" && typeof unit.longitude === "number", "unit latitude and longitude are required for weather forecast ingest");

    const timezone = optionalString(body.timezone) ?? "auto";
    const requestedDate = optionalDateOnly(body.forecastDate ?? body.date, "forecastDate");
    const forecast = await this.weatherProvider.getDailyForecast({
      latitude: unit.latitude,
      longitude: unit.longitude,
      timezone,
      forecastDays: 3,
    });

    const targetDay =
      (requestedDate ? forecast.days.find((item) => item.date === requestedDate) : undefined) ??
      forecast.days[1] ??
      forecast.days[0];
    assert(targetDay, "weather provider returned no target forecast day", 502);

    const activePlan = await this.repository.getActiveCropPlanByUnit(unitId);
    const featurePayload = buildWeatherFeaturePayload(forecast, targetDay);
    const weatherObservation = await this.repository.createObservation({
      unitId,
      cropPlanId: activePlan?.id,
      source: "api",
      type: "weather",
      payload: {
        ...featurePayload,
        fetchedAt: nowIso(),
      },
      attachmentRefs: [],
      qualityFlag: "ok",
    });

    const snapshots: CreateBackgroundInput[] = [
      {
        unitId,
        date: targetDay.date,
        layer: "normalized",
        source: featurePayload.provider as string,
        payload: {
          forecastDate: targetDay.date,
          timezone: forecast.timezone,
          daily: {
            date: targetDay.date,
            weatherCode: targetDay.weatherCode ?? null,
            temperatureMaxC: targetDay.temperatureMaxC ?? null,
            temperatureMinC: targetDay.temperatureMinC ?? null,
            precipitationSumMm: targetDay.precipitationSumMm ?? null,
            rainSumMm: targetDay.rainSumMm ?? null,
            showersSumMm: targetDay.showersSumMm ?? null,
            precipitationProbabilityMax: targetDay.precipitationProbabilityMax ?? null,
            windSpeedMaxKph: targetDay.windSpeedMaxKph ?? null,
            windGustsMaxKph: targetDay.windGustsMaxKph ?? null,
          },
        },
        qualityFlag: "ok",
      },
      {
        unitId,
        date: targetDay.date,
        layer: "feature",
        source: featurePayload.provider as string,
        payload: featurePayload,
        qualityFlag: "ok",
      },
    ];
    const createdBackground = await this.repository.createBackgroundSnapshots(snapshots);
    await this.refreshUnitProfileSummary(unitId);
    await this.repository.createAuditLog({
      actor: "api",
      action: "weather.forecast.ingest",
      targetType: "unit",
      targetId: unitId,
      metadata: {
        provider: featurePayload.provider,
        forecastDate: featurePayload.forecastDate,
        rainRiskLevel: featurePayload.rainRiskLevel,
      },
    });

    return {
      unitId,
      cropPlanId: activePlan?.id ?? null,
      weatherObservation,
      backgroundSnapshots: createdBackground,
      targetForecast: featurePayload,
    };
  }

  async createExport(body: Record<string, unknown>) {
    const format = body.format ? ensureEnum(body.format, EXPORT_FORMATS, "format") : "csv";
    const unitId = ensureString(body.unitId, "unitId");
    await this.getUnit(unitId);
    const startIso = optionalDate(body.startDate ?? body.startAt, "startDate");
    const endIso = optionalDate(body.endDate ?? body.endAt, "endDate");
    if (startIso && endIso) {
      assert(startIso <= endIso, "startDate must be <= endDate");
    }
    const job = await this.repository.createExportJob({
      scope: { unitId, startIso: startIso ?? null, endIso: endIso ?? null },
      format,
      status: "processing",
    });
    try {
      const bundle = await this.repository.exportBundle(unitId, startIso, endIso);
      const content = [
        csvSection("observations", bundle.observations.map((item) => ({ ...item, payload: JSON.stringify(item.payload), attachmentRefs: JSON.stringify(item.attachmentRefs) }))),
        csvSection("operations", bundle.operations.map((item) => ({ ...item, details: JSON.stringify(item.details) }))),
        csvSection("recommendations", bundle.recommendations.map((item) => ({ ...item, rationale: JSON.stringify(item.rationale), requiredInputs: JSON.stringify(item.requiredInputs), proposedActions: JSON.stringify(item.proposedActions) }))),
        csvSection("reminders", bundle.reminders.map((item) => ({ ...item, payload: JSON.stringify(item.payload), recurrenceRule: JSON.stringify(item.recurrenceRule ?? null) }))),
      ].join("\n");

      const outputPath = await this.storage.writeExport(`${job.id}.csv`, content);
      const updated = await this.repository.updateExportJob(job.id, { status: "completed", outputPath });
      return updated ?? job;
    } catch (error) {
      const message = error instanceof Error ? error.message : "export failed";
      const failed = await this.repository.updateExportJob(job.id, { status: "failed", errorMessage: message });
      throw failed ? Object.assign(error instanceof Error ? error : new Error(message), { exportJobId: failed.id }) : error;
    }
  }

  async getExport(id: string) {
    const job = await this.repository.getExportJob(id);
    assert(job, "export job not found", 404);
    return job;
  }

  async getPluginContextSummary(unitId: string) {
    const unit = await this.getUnit(unitId);
    const [cropPlan, observations, operations, recommendations, reminders, background] = await Promise.all([
      this.repository.getActiveCropPlanByUnit(unitId),
      this.repository.listRecentObservationsByUnit(unitId, 5),
      this.repository.listRecentOperationsByUnit(unitId, 5),
      this.repository.listRecentRecommendationsByUnit(unitId, 5),
      this.repository.listRemindersByUnit(unitId),
      this.repository.listLatestBackgroundByUnit(unitId, 5),
    ]);

    return {
      unit,
      activeCropPlan: cropPlan,
      profileSummary: unit.profileSummary ?? {},
      recentObservations: observations,
      recentOperations: operations,
      recentRecommendations: recommendations,
      pendingReminders: reminders.filter((item) => item.status === "pending" || item.status === "sent").slice(0, 10),
      latestBackground: background,
    };
  }

  async pluginObservation(unitId: string, body: Record<string, unknown>, attachments?: AttachmentRef[]) {
    return this.createObservation(unitId, body.source ? ensureEnum(body.source, OBSERVATION_SOURCES, "source") : "user", { body, attachments });
  }

  async pluginCareCheck(unitId: string, body: Record<string, unknown>) {
    const persist = toBoolean(body.persist) ?? true;
    return this.runCareCheck(unitId, persist);
  }

  async pluginWeatherForecast(unitId: string, body: Record<string, unknown>) {
    return this.ingestWeatherForecast(unitId, body);
  }

  async pluginConfirmOperation(unitId: string, body: Record<string, unknown>) {
    if (body.operationId) {
      const updated = await this.repository.confirmOperation(ensureString(body.operationId, "operationId"), optionalString(body.confirmedBy) ?? "plugin", optionalDate(body.confirmedAt, "confirmedAt") ?? nowIso());
      assert(updated, "operation not found", 404);
      assert(updated.unitId === unitId, "operation does not belong to this unit", 400);
      await this.refreshUnitProfileSummary(unitId);
      return updated;
    }
    return this.createOperation(unitId, { ...body, confirmed: true, confirmedBy: optionalString(body.confirmedBy) ?? "plugin" }, "plugin");
  }

  async pluginActiveState(unitId: string) {
    const summary = await this.getPluginContextSummary(unitId);
    return {
      unitId,
      unitStatus: summary.unit.status,
      activeCropPlan: summary.activeCropPlan,
      latestRecommendation: summary.recentRecommendations[0] ?? null,
      pendingReminderCount: summary.pendingReminders.length,
      lastObservationAt: summary.recentObservations[0]?.createdAt ?? null,
      lastOperationAt: summary.recentOperations[0]?.createdAt ?? null,
    };
  }

  async processDueReminders(now = nowIso()): Promise<{ processed: Reminder[] }> {
    const due = await this.repository.listDueReminders(now);
    const processed: Reminder[] = [];

    for (const reminder of due) {
      const sent = await this.repository.updateReminderStatus(reminder.id, { status: "sent", sentAt: now });
      if (!sent) continue;
      processed.push(sent);

      if (sent.scheduleBasis === "recurring" && sent.recurrenceRule) {
        const intervalDays = toNumber(sent.recurrenceRule.intervalDays);
        const intervalHours = toNumber(sent.recurrenceRule.intervalHours);
        const nextDueAt = intervalDays ? addHours(sent.dueAt, intervalDays * 24) : intervalHours ? addHours(sent.dueAt, intervalHours) : undefined;
        if (nextDueAt) {
          await this.repository.createReminders([
            {
              unitId: sent.unitId,
              cropPlanId: sent.cropPlanId,
              reminderType: sent.reminderType,
              scheduleBasis: "recurring",
              dueAt: nextDueAt,
              status: "pending",
              linkedRecommendationId: sent.linkedRecommendationId,
              recurrenceRule: sent.recurrenceRule,
              payload: sent.payload,
            },
          ]);
        }
      }

      await this.repository.createAuditLog({
        actor: "worker",
        action: "reminder.sent",
        targetType: "reminder",
        targetId: sent.id,
        metadata: { unitId: sent.unitId, reminderType: sent.reminderType },
      });
      await this.refreshUnitProfileSummary(sent.unitId);
    }

    return { processed };
  }

  async refreshUnitProfileSummary(unitId: string): Promise<void> {
    const unit = await this.repository.getUnit(unitId);
    if (!unit) return;
    const [cropPlan, observations, operations, recommendations, reminders] = await Promise.all([
      this.repository.getActiveCropPlanByUnit(unitId),
      this.repository.listObservationsByUnit(unitId),
      this.repository.listOperationsByUnit(unitId),
      this.repository.listRecommendationsByUnit(unitId),
      this.repository.listRemindersByUnit(unitId),
    ]);
    await this.repository.updateUnitProfileSummary(
      unitId,
      buildProfileSummary({ unit, cropPlan, observations, operations, recommendations, reminders }),
    );
  }
}

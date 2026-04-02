import type { PoolClient, QueryResultRow } from "pg";
import type {
  AuditLog,
  BackgroundSnapshot,
  CareCheckContext,
  CropPlan,
  ExportJob,
  JsonObject,
  Observation,
  OperationLog,
  Recommendation,
  Reminder,
  TimelineEvent,
  Unit,
} from "./domain.js";
import { asJsonObject } from "./domain.js";
import { PgDatabase } from "./db/pg.js";
import { makeId, nowIso } from "./utils.js";

export type CreateUnitInput = Omit<Unit, "id" | "createdAt" | "updatedAt"> & { id?: string };
export type UpdateUnitInput = Partial<Omit<Unit, "id" | "createdAt" | "updatedAt">>;
export type CreateCropPlanInput = Omit<CropPlan, "id" | "createdAt" | "updatedAt"> & { id?: string };
export type CreateObservationInput = Omit<Observation, "id" | "createdAt"> & { id?: string };
export type CreateOperationInput = Omit<OperationLog, "id" | "createdAt"> & { id?: string };
export type CreateRecommendationInput = Omit<Recommendation, "id" | "generatedAt"> & { id?: string; generatedAt?: string };
export type CreateReminderInput = Omit<Reminder, "id" | "createdAt"> & { id?: string; createdAt?: string };
export type CreateBackgroundInput = Omit<BackgroundSnapshot, "id" | "createdAt"> & { id?: string; createdAt?: string };
export type CreateExportJobInput = Omit<ExportJob, "id" | "createdAt" | "updatedAt"> & { id?: string };
export type UpdateExportJobInput = Partial<Omit<ExportJob, "id" | "createdAt">>;
export type CreateAuditLogInput = Omit<AuditLog, "id" | "createdAt"> & { id?: string; createdAt?: string };

export type ExportBundle = {
  observations: Observation[];
  operations: OperationLog[];
  recommendations: Recommendation[];
  reminders: Reminder[];
};

export interface BackendRepository {
  healthCheck(): Promise<boolean>;
  createUnit(input: CreateUnitInput): Promise<Unit>;
  getUnit(id: string): Promise<Unit | undefined>;
  updateUnit(id: string, patch: UpdateUnitInput): Promise<Unit | undefined>;
  updateUnitProfileSummary(id: string, summary: JsonObject): Promise<void>;
  createCropPlan(input: CreateCropPlanInput): Promise<CropPlan>;
  getCropPlan(id: string): Promise<CropPlan | undefined>;
  getActiveCropPlanByUnit(unitId: string): Promise<CropPlan | undefined>;
  listCropPlansByUnit(unitId: string): Promise<CropPlan[]>;
  createObservation(input: CreateObservationInput): Promise<Observation>;
  listObservationsByUnit(unitId: string): Promise<Observation[]>;
  listRecentObservationsByUnit(unitId: string, limit: number): Promise<Observation[]>;
  createOperation(input: CreateOperationInput): Promise<OperationLog>;
  listOperationsByUnit(unitId: string): Promise<OperationLog[]>;
  listRecentOperationsByUnit(unitId: string, limit: number): Promise<OperationLog[]>;
  confirmOperation(id: string, confirmedBy: string, confirmedAt: string): Promise<OperationLog | undefined>;
  createRecommendations(inputs: CreateRecommendationInput[]): Promise<Recommendation[]>;
  listRecommendationsByUnit(unitId: string): Promise<Recommendation[]>;
  listRecentRecommendationsByUnit(unitId: string, limit: number): Promise<Recommendation[]>;
  createReminders(inputs: CreateReminderInput[]): Promise<Reminder[]>;
  listRemindersByUnit(unitId: string): Promise<Reminder[]>;
  getReminder(id: string): Promise<Reminder | undefined>;
  updateReminderStatus(id: string, patch: Partial<Reminder>): Promise<Reminder | undefined>;
  listDueReminders(untilIso: string): Promise<Reminder[]>;
  createBackgroundSnapshots(inputs: CreateBackgroundInput[]): Promise<BackgroundSnapshot[]>;
  listLatestBackgroundByUnit(unitId: string, limit?: number): Promise<BackgroundSnapshot[]>;
  createExportJob(input: CreateExportJobInput): Promise<ExportJob>;
  updateExportJob(id: string, patch: UpdateExportJobInput): Promise<ExportJob | undefined>;
  getExportJob(id: string): Promise<ExportJob | undefined>;
  createAuditLog(input: CreateAuditLogInput): Promise<AuditLog>;
  getTimeline(unitId: string): Promise<TimelineEvent[]>;
  getCareCheckContext(unitId: string): Promise<CareCheckContext | undefined>;
  exportBundle(unitId: string, startIso?: string, endIso?: string): Promise<ExportBundle>;
}

type UnitRow = QueryResultRow & {
  id: string;
  name: string;
  type: Unit["type"];
  location_text: string | null;
  latitude: number | null;
  longitude: number | null;
  geometry_geojson: JsonObject | null;
  area_m2: number | null;
  container_info: JsonObject | null;
  irrigation_method: string | null;
  owner_ref: string | null;
  project_ref: string | null;
  status: Unit["status"];
  profile_summary: JsonObject | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type CropPlanRow = QueryResultRow & {
  id: string;
  unit_id: string;
  crop: string;
  cultivar: string | null;
  sowing_date: Date | string | null;
  transplant_date: Date | string | null;
  current_stage: string | null;
  target: CropPlan["target"] | null;
  active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type ObservationRow = QueryResultRow & {
  id: string;
  unit_id: string;
  crop_plan_id: string | null;
  source: Observation["source"];
  type: Observation["type"];
  payload: JsonObject | null;
  attachment_refs: Observation["attachmentRefs"] | null;
  quality_flag: Observation["qualityFlag"] | null;
  created_at: Date | string;
};

type OperationRow = QueryResultRow & {
  id: string;
  unit_id: string;
  crop_plan_id: string | null;
  type: OperationLog["type"];
  details: JsonObject | null;
  confirmed: boolean;
  confirmed_by: string | null;
  confirmed_at: Date | string | null;
  risk_level: OperationLog["riskLevel"];
  linked_recommendation_id: string | null;
  linked_reminder_id: string | null;
  created_at: Date | string;
};

type RecommendationRow = QueryResultRow & {
  id: string;
  unit_id: string;
  crop_plan_id: string | null;
  category: Recommendation["category"];
  severity: Recommendation["severity"];
  rationale: Recommendation["rationale"] | null;
  required_inputs: Recommendation["requiredInputs"] | null;
  proposed_actions: Recommendation["proposedActions"] | null;
  confidence: number;
  needs_human_confirm: boolean;
  engine: string;
  generated_at: Date | string;
};

type ReminderRow = QueryResultRow & {
  id: string;
  unit_id: string;
  crop_plan_id: string | null;
  reminder_type: string;
  schedule_basis: Reminder["scheduleBasis"];
  due_at: Date | string;
  status: Reminder["status"];
  linked_recommendation_id: string | null;
  recurrence_rule: JsonObject | null;
  payload: JsonObject | null;
  sent_at: Date | string | null;
  completed_at: Date | string | null;
  skipped_at: Date | string | null;
  created_at: Date | string;
};

type BackgroundRow = QueryResultRow & {
  id: string;
  unit_id: string;
  date: Date | string;
  layer: BackgroundSnapshot["layer"];
  source: string;
  payload: JsonObject | null;
  quality_flag: BackgroundSnapshot["qualityFlag"] | null;
  created_at: Date | string;
};

type ExportJobRow = QueryResultRow & {
  id: string;
  scope: JsonObject | null;
  format: ExportJob["format"];
  status: ExportJob["status"];
  output_path: string | null;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type AuditLogRow = QueryResultRow & {
  id: string;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata: JsonObject | null;
  created_at: Date | string;
};

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toJsonParam(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function mapUnit(row: UnitRow): Unit {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    locationText: row.location_text ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    geometryGeojson: row.geometry_geojson ?? undefined,
    areaM2: row.area_m2 ?? undefined,
    containerInfo: row.container_info ?? undefined,
    irrigationMethod: row.irrigation_method ?? undefined,
    ownerRef: row.owner_ref ?? undefined,
    projectRef: row.project_ref ?? undefined,
    status: row.status,
    profileSummary: row.profile_summary ?? undefined,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapCropPlan(row: CropPlanRow): CropPlan {
  return {
    id: row.id,
    unitId: row.unit_id,
    crop: row.crop,
    cultivar: row.cultivar ?? undefined,
    sowingDate: toIso(row.sowing_date)?.slice(0, 10),
    transplantDate: toIso(row.transplant_date)?.slice(0, 10),
    currentStage: row.current_stage ?? undefined,
    target: row.target ?? undefined,
    active: row.active,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapObservation(row: ObservationRow): Observation {
  return {
    id: row.id,
    unitId: row.unit_id,
    cropPlanId: row.crop_plan_id ?? undefined,
    source: row.source,
    type: row.type,
    payload: asJsonObject(row.payload),
    attachmentRefs: Array.isArray(row.attachment_refs) ? row.attachment_refs : [],
    qualityFlag: row.quality_flag ?? undefined,
    createdAt: toIso(row.created_at)!,
  };
}

function mapOperation(row: OperationRow): OperationLog {
  return {
    id: row.id,
    unitId: row.unit_id,
    cropPlanId: row.crop_plan_id ?? undefined,
    type: row.type,
    details: asJsonObject(row.details),
    confirmed: row.confirmed,
    confirmedBy: row.confirmed_by ?? undefined,
    confirmedAt: toIso(row.confirmed_at),
    riskLevel: row.risk_level,
    linkedRecommendationId: row.linked_recommendation_id ?? undefined,
    linkedReminderId: row.linked_reminder_id ?? undefined,
    createdAt: toIso(row.created_at)!,
  };
}

function mapRecommendation(row: RecommendationRow): Recommendation {
  return {
    id: row.id,
    unitId: row.unit_id,
    cropPlanId: row.crop_plan_id ?? undefined,
    category: row.category,
    severity: row.severity,
    rationale: Array.isArray(row.rationale) ? row.rationale : [],
    requiredInputs: Array.isArray(row.required_inputs) ? row.required_inputs : [],
    proposedActions: Array.isArray(row.proposed_actions) ? row.proposed_actions : [],
    confidence: row.confidence,
    needsHumanConfirm: row.needs_human_confirm,
    generatedAt: toIso(row.generated_at)!,
    engine: row.engine,
  };
}

function mapReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    unitId: row.unit_id,
    cropPlanId: row.crop_plan_id ?? undefined,
    reminderType: row.reminder_type,
    scheduleBasis: row.schedule_basis,
    dueAt: toIso(row.due_at)!,
    status: row.status,
    linkedRecommendationId: row.linked_recommendation_id ?? undefined,
    recurrenceRule: row.recurrence_rule ?? undefined,
    payload: asJsonObject(row.payload),
    sentAt: toIso(row.sent_at),
    completedAt: toIso(row.completed_at),
    skippedAt: toIso(row.skipped_at),
    createdAt: toIso(row.created_at)!,
  };
}

function mapBackground(row: BackgroundRow): BackgroundSnapshot {
  return {
    id: row.id,
    unitId: row.unit_id,
    date: toIso(row.date)!.slice(0, 10),
    layer: row.layer,
    source: row.source,
    payload: asJsonObject(row.payload),
    qualityFlag: row.quality_flag ?? undefined,
    createdAt: toIso(row.created_at)!,
  };
}

function mapExportJob(row: ExportJobRow): ExportJob {
  return {
    id: row.id,
    scope: asJsonObject(row.scope),
    format: row.format,
    status: row.status,
    outputPath: row.output_path ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapAuditLog(row: AuditLogRow): AuditLog {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: asJsonObject(row.metadata),
    createdAt: toIso(row.created_at)!,
  };
}

export class PgRepository implements BackendRepository {
  constructor(private readonly db: PgDatabase) {}

  async healthCheck(): Promise<boolean> {
    await this.db.query("SELECT 1");
    return true;
  }

  async createUnit(input: CreateUnitInput): Promise<Unit> {
    const row = await this.db.one<UnitRow>(
      `INSERT INTO units (
        id, name, type, location_text, latitude, longitude, geometry_geojson, area_m2,
        container_info, irrigation_method, owner_ref, project_ref, status, profile_summary, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $15
      ) RETURNING *`,
      [
        input.id ?? makeId("unit"),
        input.name,
        input.type,
        input.locationText ?? null,
        input.latitude ?? null,
        input.longitude ?? null,
        toJsonParam(input.geometryGeojson),
        input.areaM2 ?? null,
        toJsonParam(input.containerInfo),
        input.irrigationMethod ?? null,
        input.ownerRef ?? null,
        input.projectRef ?? null,
        input.status,
        toJsonParam(input.profileSummary),
        nowIso(),
      ],
    );
    return mapUnit(row!);
  }

  async getUnit(id: string): Promise<Unit | undefined> {
    const row = await this.db.one<UnitRow>("SELECT * FROM units WHERE id = $1", [id]);
    return row ? mapUnit(row) : undefined;
  }

  async updateUnit(id: string, patch: UpdateUnitInput): Promise<Unit | undefined> {
    const existing = await this.getUnit(id);
    if (!existing) return undefined;
    const next = { ...existing, ...patch, updatedAt: nowIso() };
    const row = await this.db.one<UnitRow>(
      `UPDATE units SET
        name = $2,
        type = $3,
        location_text = $4,
        latitude = $5,
        longitude = $6,
        geometry_geojson = $7,
        area_m2 = $8,
        container_info = $9,
        irrigation_method = $10,
        owner_ref = $11,
        project_ref = $12,
        status = $13,
        profile_summary = $14,
        updated_at = $15
      WHERE id = $1
      RETURNING *`,
      [
        id,
        next.name,
        next.type,
        next.locationText ?? null,
        next.latitude ?? null,
        next.longitude ?? null,
        toJsonParam(next.geometryGeojson),
        next.areaM2 ?? null,
        toJsonParam(next.containerInfo),
        next.irrigationMethod ?? null,
        next.ownerRef ?? null,
        next.projectRef ?? null,
        next.status,
        toJsonParam(next.profileSummary),
        next.updatedAt,
      ],
    );
    return row ? mapUnit(row) : undefined;
  }

  async updateUnitProfileSummary(id: string, summary: JsonObject): Promise<void> {
    await this.db.query("UPDATE units SET profile_summary = $2, updated_at = $3 WHERE id = $1", [id, toJsonParam(summary), nowIso()]);
  }

  async createCropPlan(input: CreateCropPlanInput): Promise<CropPlan> {
    if (input.active) {
      await this.db.query("UPDATE crop_plans SET active = FALSE, updated_at = $2 WHERE unit_id = $1 AND active = TRUE", [input.unitId, nowIso()]);
    }
    const row = await this.db.one<CropPlanRow>(
      `INSERT INTO crop_plans (
        id, unit_id, crop, cultivar, sowing_date, transplant_date, current_stage, target, active, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10
      ) RETURNING *`,
      [
        input.id ?? makeId("plan"),
        input.unitId,
        input.crop,
        input.cultivar ?? null,
        input.sowingDate ?? null,
        input.transplantDate ?? null,
        input.currentStage ?? null,
        input.target ?? null,
        input.active,
        nowIso(),
      ],
    );
    return mapCropPlan(row!);
  }

  async getCropPlan(id: string): Promise<CropPlan | undefined> {
    const row = await this.db.one<CropPlanRow>("SELECT * FROM crop_plans WHERE id = $1", [id]);
    return row ? mapCropPlan(row) : undefined;
  }

  async getActiveCropPlanByUnit(unitId: string): Promise<CropPlan | undefined> {
    const row = await this.db.one<CropPlanRow>("SELECT * FROM crop_plans WHERE unit_id = $1 AND active = TRUE ORDER BY updated_at DESC LIMIT 1", [unitId]);
    return row ? mapCropPlan(row) : undefined;
  }

  async listCropPlansByUnit(unitId: string): Promise<CropPlan[]> {
    const rows = await this.db.query<CropPlanRow>("SELECT * FROM crop_plans WHERE unit_id = $1 ORDER BY created_at DESC", [unitId]);
    return rows.map(mapCropPlan);
  }

  async createObservation(input: CreateObservationInput): Promise<Observation> {
    const row = await this.db.one<ObservationRow>(
      `INSERT INTO observations (id, unit_id, crop_plan_id, source, type, payload, attachment_refs, quality_flag, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.id ?? makeId("obs"),
        input.unitId,
        input.cropPlanId ?? null,
        input.source,
        input.type,
        toJsonParam(input.payload),
        toJsonParam(input.attachmentRefs),
        input.qualityFlag ?? null,
        nowIso(),
      ],
    );
    return mapObservation(row!);
  }

  async listObservationsByUnit(unitId: string): Promise<Observation[]> {
    const rows = await this.db.query<ObservationRow>("SELECT * FROM observations WHERE unit_id = $1 ORDER BY created_at DESC", [unitId]);
    return rows.map(mapObservation);
  }

  async listRecentObservationsByUnit(unitId: string, limit: number): Promise<Observation[]> {
    const rows = await this.db.query<ObservationRow>("SELECT * FROM observations WHERE unit_id = $1 ORDER BY created_at DESC LIMIT $2", [unitId, limit]);
    return rows.map(mapObservation);
  }

  async createOperation(input: CreateOperationInput): Promise<OperationLog> {
    const row = await this.db.one<OperationRow>(
      `INSERT INTO operation_logs (
        id, unit_id, crop_plan_id, type, details, confirmed, confirmed_by, confirmed_at,
        risk_level, linked_recommendation_id, linked_reminder_id, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12
      ) RETURNING *`,
      [
        input.id ?? makeId("op"),
        input.unitId,
        input.cropPlanId ?? null,
        input.type,
        toJsonParam(input.details),
        input.confirmed,
        input.confirmedBy ?? null,
        input.confirmedAt ?? null,
        input.riskLevel,
        input.linkedRecommendationId ?? null,
        input.linkedReminderId ?? null,
        nowIso(),
      ],
    );
    return mapOperation(row!);
  }

  async listOperationsByUnit(unitId: string): Promise<OperationLog[]> {
    const rows = await this.db.query<OperationRow>("SELECT * FROM operation_logs WHERE unit_id = $1 ORDER BY created_at DESC", [unitId]);
    return rows.map(mapOperation);
  }

  async listRecentOperationsByUnit(unitId: string, limit: number): Promise<OperationLog[]> {
    const rows = await this.db.query<OperationRow>("SELECT * FROM operation_logs WHERE unit_id = $1 ORDER BY created_at DESC LIMIT $2", [unitId, limit]);
    return rows.map(mapOperation);
  }

  async confirmOperation(id: string, confirmedBy: string, confirmedAt: string): Promise<OperationLog | undefined> {
    const row = await this.db.one<OperationRow>(
      "UPDATE operation_logs SET confirmed = TRUE, confirmed_by = $2, confirmed_at = $3 WHERE id = $1 RETURNING *",
      [id, confirmedBy, confirmedAt],
    );
    return row ? mapOperation(row) : undefined;
  }

  async createRecommendations(inputs: CreateRecommendationInput[]): Promise<Recommendation[]> {
    const created: Recommendation[] = [];
    for (const input of inputs) {
      const row = await this.db.one<RecommendationRow>(
        `INSERT INTO recommendations (
          id, unit_id, crop_plan_id, category, severity, rationale, required_inputs, proposed_actions,
          confidence, needs_human_confirm, engine, generated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12
        ) RETURNING *`,
        [
          input.id ?? makeId("rec"),
          input.unitId,
          input.cropPlanId ?? null,
          input.category,
          input.severity,
          toJsonParam(input.rationale),
          toJsonParam(input.requiredInputs),
          toJsonParam(input.proposedActions),
          input.confidence,
          input.needsHumanConfirm,
          input.engine,
          input.generatedAt ?? nowIso(),
        ],
      );
      created.push(mapRecommendation(row!));
    }
    return created;
  }

  async listRecommendationsByUnit(unitId: string): Promise<Recommendation[]> {
    const rows = await this.db.query<RecommendationRow>("SELECT * FROM recommendations WHERE unit_id = $1 ORDER BY generated_at DESC", [unitId]);
    return rows.map(mapRecommendation);
  }

  async listRecentRecommendationsByUnit(unitId: string, limit: number): Promise<Recommendation[]> {
    const rows = await this.db.query<RecommendationRow>("SELECT * FROM recommendations WHERE unit_id = $1 ORDER BY generated_at DESC LIMIT $2", [unitId, limit]);
    return rows.map(mapRecommendation);
  }

  async createReminders(inputs: CreateReminderInput[]): Promise<Reminder[]> {
    const created: Reminder[] = [];
    for (const input of inputs) {
      const row = await this.db.one<ReminderRow>(
        `INSERT INTO reminders (
          id, unit_id, crop_plan_id, reminder_type, schedule_basis, due_at, status,
          linked_recommendation_id, recurrence_rule, payload, sent_at, completed_at, skipped_at, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14
        ) RETURNING *`,
        [
          input.id ?? makeId("rem"),
          input.unitId,
          input.cropPlanId ?? null,
          input.reminderType,
          input.scheduleBasis,
          input.dueAt,
          input.status,
          input.linkedRecommendationId ?? null,
          toJsonParam(input.recurrenceRule),
          toJsonParam(input.payload),
          input.sentAt ?? null,
          input.completedAt ?? null,
          input.skippedAt ?? null,
          input.createdAt ?? nowIso(),
        ],
      );
      created.push(mapReminder(row!));
    }
    return created;
  }

  async listRemindersByUnit(unitId: string): Promise<Reminder[]> {
    const rows = await this.db.query<ReminderRow>("SELECT * FROM reminders WHERE unit_id = $1 ORDER BY due_at ASC", [unitId]);
    return rows.map(mapReminder);
  }

  async getReminder(id: string): Promise<Reminder | undefined> {
    const row = await this.db.one<ReminderRow>("SELECT * FROM reminders WHERE id = $1", [id]);
    return row ? mapReminder(row) : undefined;
  }

  async updateReminderStatus(id: string, patch: Partial<Reminder>): Promise<Reminder | undefined> {
    const current = await this.getReminder(id);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    const row = await this.db.one<ReminderRow>(
      `UPDATE reminders SET
        status = $2,
        due_at = $3,
        linked_recommendation_id = $4,
        recurrence_rule = $5,
        payload = $6,
        sent_at = $7,
        completed_at = $8,
        skipped_at = $9
      WHERE id = $1
      RETURNING *`,
      [
        id,
        next.status,
        next.dueAt,
        next.linkedRecommendationId ?? null,
        toJsonParam(next.recurrenceRule),
        toJsonParam(next.payload),
        next.sentAt ?? null,
        next.completedAt ?? null,
        next.skippedAt ?? null,
      ],
    );
    return row ? mapReminder(row) : undefined;
  }

  async listDueReminders(untilIso: string): Promise<Reminder[]> {
    const rows = await this.db.query<ReminderRow>(
      "SELECT * FROM reminders WHERE status = 'pending' AND due_at <= $1 ORDER BY due_at ASC",
      [untilIso],
    );
    return rows.map(mapReminder);
  }

  async createBackgroundSnapshots(inputs: CreateBackgroundInput[]): Promise<BackgroundSnapshot[]> {
    const created: BackgroundSnapshot[] = [];
    for (const input of inputs) {
      const row = await this.db.one<BackgroundRow>(
        `INSERT INTO background_snapshots (id, unit_id, date, layer, source, payload, quality_flag, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          input.id ?? makeId("bg"),
          input.unitId,
          input.date,
          input.layer,
          input.source,
          toJsonParam(input.payload),
          input.qualityFlag ?? null,
          input.createdAt ?? nowIso(),
        ],
      );
      created.push(mapBackground(row!));
    }
    return created;
  }

  async listLatestBackgroundByUnit(unitId: string, limit = 10): Promise<BackgroundSnapshot[]> {
    const rows = await this.db.query<BackgroundRow>(
      "SELECT * FROM background_snapshots WHERE unit_id = $1 ORDER BY date DESC, created_at DESC LIMIT $2",
      [unitId, limit],
    );
    return rows.map(mapBackground);
  }

  async createExportJob(input: CreateExportJobInput): Promise<ExportJob> {
    const timestamp = nowIso();
    const row = await this.db.one<ExportJobRow>(
      `INSERT INTO export_jobs (id, scope, format, status, output_path, error_message, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       RETURNING *`,
      [input.id ?? makeId("export"), toJsonParam(input.scope), input.format, input.status, input.outputPath ?? null, input.errorMessage ?? null, timestamp],
    );
    return mapExportJob(row!);
  }

  async updateExportJob(id: string, patch: UpdateExportJobInput): Promise<ExportJob | undefined> {
    const current = await this.getExportJob(id);
    if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: nowIso() };
    const row = await this.db.one<ExportJobRow>(
      `UPDATE export_jobs SET scope = $2, format = $3, status = $4, output_path = $5, error_message = $6, updated_at = $7 WHERE id = $1 RETURNING *`,
      [id, toJsonParam(next.scope), next.format, next.status, next.outputPath ?? null, next.errorMessage ?? null, next.updatedAt],
    );
    return row ? mapExportJob(row) : undefined;
  }

  async getExportJob(id: string): Promise<ExportJob | undefined> {
    const row = await this.db.one<ExportJobRow>("SELECT * FROM export_jobs WHERE id = $1", [id]);
    return row ? mapExportJob(row) : undefined;
  }

  async createAuditLog(input: CreateAuditLogInput): Promise<AuditLog> {
    const row = await this.db.one<AuditLogRow>(
      `INSERT INTO audit_logs (id, actor, action, target_type, target_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [input.id ?? makeId("audit"), input.actor, input.action, input.targetType, input.targetId, toJsonParam(input.metadata), input.createdAt ?? nowIso()],
    );
    return mapAuditLog(row!);
  }

  async getTimeline(unitId: string): Promise<TimelineEvent[]> {
    const [observations, operations, recommendations, reminders] = await Promise.all([
      this.listObservationsByUnit(unitId),
      this.listOperationsByUnit(unitId),
      this.listRecommendationsByUnit(unitId),
      this.listRemindersByUnit(unitId),
    ]);

    return [
      ...observations.map((data) => ({ kind: "observation" as const, at: data.createdAt, data })),
      ...operations.map((data) => ({ kind: "operation" as const, at: data.createdAt, data })),
      ...recommendations.map((data) => ({ kind: "recommendation" as const, at: data.generatedAt, data })),
      ...reminders.map((data) => ({ kind: "reminder" as const, at: data.dueAt, data })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  async getCareCheckContext(unitId: string): Promise<CareCheckContext | undefined> {
    const unit = await this.getUnit(unitId);
    if (!unit) return undefined;
    const [cropPlan, recentObservations, recentOperations, latestBackground] = await Promise.all([
      this.getActiveCropPlanByUnit(unitId),
      this.listRecentObservationsByUnit(unitId, 30),
      this.listRecentOperationsByUnit(unitId, 20),
      this.listLatestBackgroundByUnit(unitId, 10),
    ]);
    return { unit, cropPlan, recentObservations, recentOperations, latestBackground };
  }

  async exportBundle(unitId: string, startIso?: string, endIso?: string): Promise<ExportBundle> {
    const observations = (await this.listObservationsByUnit(unitId)).filter((item) => isWithinRange(item.createdAt, startIso, endIso));
    const operations = (await this.listOperationsByUnit(unitId)).filter((item) => isWithinRange(item.createdAt, startIso, endIso));
    const recommendations = (await this.listRecommendationsByUnit(unitId)).filter((item) => isWithinRange(item.generatedAt, startIso, endIso));
    const reminders = (await this.listRemindersByUnit(unitId)).filter((item) => isWithinRange(item.createdAt, startIso, endIso));
    return { observations, operations, recommendations, reminders };
  }
}

function isWithinRange(valueIso: string, startIso?: string, endIso?: string): boolean {
  if (startIso && valueIso < startIso) return false;
  if (endIso && valueIso > endIso) return false;
  return true;
}

export class InMemoryRepository implements BackendRepository {
  private readonly units = new Map<string, Unit>();
  private readonly cropPlans = new Map<string, CropPlan>();
  private readonly observations = new Map<string, Observation>();
  private readonly operations = new Map<string, OperationLog>();
  private readonly recommendations = new Map<string, Recommendation>();
  private readonly reminders = new Map<string, Reminder>();
  private readonly background = new Map<string, BackgroundSnapshot>();
  private readonly exportJobs = new Map<string, ExportJob>();
  private readonly audits = new Map<string, AuditLog>();

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async createUnit(input: CreateUnitInput): Promise<Unit> {
    const item: Unit = {
      ...input,
      id: input.id ?? makeId("unit"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.units.set(item.id, item);
    return item;
  }

  async getUnit(id: string): Promise<Unit | undefined> {
    return this.units.get(id);
  }

  async updateUnit(id: string, patch: UpdateUnitInput): Promise<Unit | undefined> {
    const current = this.units.get(id);
    if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: nowIso() };
    this.units.set(id, next);
    return next;
  }

  async updateUnitProfileSummary(id: string, summary: JsonObject): Promise<void> {
    const current = this.units.get(id);
    if (!current) return;
    this.units.set(id, { ...current, profileSummary: summary, updatedAt: nowIso() });
  }

  async createCropPlan(input: CreateCropPlanInput): Promise<CropPlan> {
    if (input.active) {
      for (const plan of this.cropPlans.values()) {
        if (plan.unitId === input.unitId && plan.active) {
          this.cropPlans.set(plan.id, { ...plan, active: false, updatedAt: nowIso() });
        }
      }
    }
    const item: CropPlan = { ...input, id: input.id ?? makeId("plan"), createdAt: nowIso(), updatedAt: nowIso() };
    this.cropPlans.set(item.id, item);
    return item;
  }

  async getCropPlan(id: string): Promise<CropPlan | undefined> {
    return this.cropPlans.get(id);
  }

  async getActiveCropPlanByUnit(unitId: string): Promise<CropPlan | undefined> {
    return [...this.cropPlans.values()].find((item) => item.unitId === unitId && item.active);
  }

  async listCropPlansByUnit(unitId: string): Promise<CropPlan[]> {
    return [...this.cropPlans.values()].filter((item) => item.unitId === unitId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async createObservation(input: CreateObservationInput): Promise<Observation> {
    const item: Observation = { ...input, id: input.id ?? makeId("obs"), createdAt: nowIso() };
    this.observations.set(item.id, item);
    return item;
  }

  async listObservationsByUnit(unitId: string): Promise<Observation[]> {
    return [...this.observations.values()].filter((item) => item.unitId === unitId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async listRecentObservationsByUnit(unitId: string, limit: number): Promise<Observation[]> {
    return (await this.listObservationsByUnit(unitId)).slice(0, limit);
  }

  async createOperation(input: CreateOperationInput): Promise<OperationLog> {
    const item: OperationLog = { ...input, id: input.id ?? makeId("op"), createdAt: nowIso() };
    this.operations.set(item.id, item);
    return item;
  }

  async listOperationsByUnit(unitId: string): Promise<OperationLog[]> {
    return [...this.operations.values()].filter((item) => item.unitId === unitId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async listRecentOperationsByUnit(unitId: string, limit: number): Promise<OperationLog[]> {
    return (await this.listOperationsByUnit(unitId)).slice(0, limit);
  }

  async confirmOperation(id: string, confirmedBy: string, confirmedAt: string): Promise<OperationLog | undefined> {
    const current = this.operations.get(id);
    if (!current) return undefined;
    const next = { ...current, confirmed: true, confirmedBy, confirmedAt };
    this.operations.set(id, next);
    return next;
  }

  async createRecommendations(inputs: CreateRecommendationInput[]): Promise<Recommendation[]> {
    const created = inputs.map((input) => {
      const item: Recommendation = {
        ...input,
        id: input.id ?? makeId("rec"),
        generatedAt: input.generatedAt ?? nowIso(),
      };
      this.recommendations.set(item.id, item);
      return item;
    });
    return created;
  }

  async listRecommendationsByUnit(unitId: string): Promise<Recommendation[]> {
    return [...this.recommendations.values()].filter((item) => item.unitId === unitId).sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1));
  }

  async listRecentRecommendationsByUnit(unitId: string, limit: number): Promise<Recommendation[]> {
    return (await this.listRecommendationsByUnit(unitId)).slice(0, limit);
  }

  async createReminders(inputs: CreateReminderInput[]): Promise<Reminder[]> {
    const created = inputs.map((input) => {
      const item: Reminder = {
        ...input,
        id: input.id ?? makeId("rem"),
        createdAt: input.createdAt ?? nowIso(),
      };
      this.reminders.set(item.id, item);
      return item;
    });
    return created;
  }

  async listRemindersByUnit(unitId: string): Promise<Reminder[]> {
    return [...this.reminders.values()].filter((item) => item.unitId === unitId).sort((a, b) => (a.dueAt > b.dueAt ? 1 : -1));
  }

  async getReminder(id: string): Promise<Reminder | undefined> {
    return this.reminders.get(id);
  }

  async updateReminderStatus(id: string, patch: Partial<Reminder>): Promise<Reminder | undefined> {
    const current = this.reminders.get(id);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    this.reminders.set(id, next);
    return next;
  }

  async listDueReminders(untilIso: string): Promise<Reminder[]> {
    return [...this.reminders.values()].filter((item) => item.status === "pending" && item.dueAt <= untilIso).sort((a, b) => (a.dueAt > b.dueAt ? 1 : -1));
  }

  async createBackgroundSnapshots(inputs: CreateBackgroundInput[]): Promise<BackgroundSnapshot[]> {
    const created = inputs.map((input) => {
      const item: BackgroundSnapshot = {
        ...input,
        id: input.id ?? makeId("bg"),
        createdAt: input.createdAt ?? nowIso(),
      };
      this.background.set(item.id, item);
      return item;
    });
    return created;
  }

  async listLatestBackgroundByUnit(unitId: string, limit = 10): Promise<BackgroundSnapshot[]> {
    return [...this.background.values()].filter((item) => item.unitId === unitId).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit);
  }

  async createExportJob(input: CreateExportJobInput): Promise<ExportJob> {
    const item: ExportJob = { ...input, id: input.id ?? makeId("export"), createdAt: nowIso(), updatedAt: nowIso() };
    this.exportJobs.set(item.id, item);
    return item;
  }

  async updateExportJob(id: string, patch: UpdateExportJobInput): Promise<ExportJob | undefined> {
    const current = this.exportJobs.get(id);
    if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: nowIso() };
    this.exportJobs.set(id, next);
    return next;
  }

  async getExportJob(id: string): Promise<ExportJob | undefined> {
    return this.exportJobs.get(id);
  }

  async createAuditLog(input: CreateAuditLogInput): Promise<AuditLog> {
    const item: AuditLog = { ...input, id: input.id ?? makeId("audit"), createdAt: input.createdAt ?? nowIso() };
    this.audits.set(item.id, item);
    return item;
  }

  async getTimeline(unitId: string): Promise<TimelineEvent[]> {
    return [
      ...(await this.listObservationsByUnit(unitId)).map((data) => ({ kind: "observation" as const, at: data.createdAt, data })),
      ...(await this.listOperationsByUnit(unitId)).map((data) => ({ kind: "operation" as const, at: data.createdAt, data })),
      ...(await this.listRecommendationsByUnit(unitId)).map((data) => ({ kind: "recommendation" as const, at: data.generatedAt, data })),
      ...(await this.listRemindersByUnit(unitId)).map((data) => ({ kind: "reminder" as const, at: data.dueAt, data })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  async getCareCheckContext(unitId: string): Promise<CareCheckContext | undefined> {
    const unit = await this.getUnit(unitId);
    if (!unit) return undefined;
    return {
      unit,
      cropPlan: await this.getActiveCropPlanByUnit(unitId),
      recentObservations: await this.listRecentObservationsByUnit(unitId, 30),
      recentOperations: await this.listRecentOperationsByUnit(unitId, 20),
      latestBackground: await this.listLatestBackgroundByUnit(unitId, 10),
    };
  }

  async exportBundle(unitId: string, startIso?: string, endIso?: string): Promise<ExportBundle> {
    return {
      observations: (await this.listObservationsByUnit(unitId)).filter((item) => isWithinRange(item.createdAt, startIso, endIso)),
      operations: (await this.listOperationsByUnit(unitId)).filter((item) => isWithinRange(item.createdAt, startIso, endIso)),
      recommendations: (await this.listRecommendationsByUnit(unitId)).filter((item) => isWithinRange(item.generatedAt, startIso, endIso)),
      reminders: (await this.listRemindersByUnit(unitId)).filter((item) => isWithinRange(item.createdAt, startIso, endIso)),
    };
  }
}

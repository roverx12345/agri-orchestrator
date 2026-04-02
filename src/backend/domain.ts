export const UNIT_TYPES = ["container", "field", "greenhouse", "orchard", "nursery", "bed"] as const;
export const UNIT_STATUSES = ["active", "inactive", "archived"] as const;
export const OBSERVATION_SOURCES = ["user", "coworker", "background", "sensor", "api"] as const;
export const OBSERVATION_TYPES = [
  "image",
  "text_note",
  "soil_moisture",
  "weather",
  "soil_test",
  "pest_scout",
  "disease_scout",
  "phenology",
  "quality",
  "yield",
] as const;
export const OPERATION_TYPES = [
  "irrigation",
  "fertilization",
  "spraying",
  "weeding",
  "pruning",
  "harvest",
  "postharvest",
  "scouting",
] as const;
export const OPERATION_RISK_LEVELS = ["low", "medium", "high"] as const;
export const RECOMMENDATION_CATEGORIES = ["water", "nutrition", "pest", "disease", "weed", "harvest", "compliance", "general"] as const;
export const RECOMMENDATION_SEVERITIES = ["info", "watch", "action", "urgent"] as const;
export const REMINDER_STATUSES = ["pending", "sent", "done", "skipped", "expired"] as const;
export const REMINDER_SCHEDULE_BASIS = ["rule", "manual", "recurring", "forecast-triggered"] as const;
export const BACKGROUND_LAYERS = ["raw", "normalized", "feature"] as const;
export const EXPORT_FORMATS = ["csv"] as const;
export const EXPORT_STATUSES = ["pending", "processing", "completed", "failed"] as const;
export const QUALITY_FLAGS = ["ok", "suspect", "missing"] as const;
export const CROP_TARGETS = ["yield", "ornamental", "quality", "water-saving"] as const;

export type UnitType = (typeof UNIT_TYPES)[number];
export type UnitStatus = (typeof UNIT_STATUSES)[number];
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];
export type ObservationType = (typeof OBSERVATION_TYPES)[number];
export type OperationType = (typeof OPERATION_TYPES)[number];
export type OperationRiskLevel = (typeof OPERATION_RISK_LEVELS)[number];
export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];
export type RecommendationSeverity = (typeof RECOMMENDATION_SEVERITIES)[number];
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];
export type ReminderScheduleBasis = (typeof REMINDER_SCHEDULE_BASIS)[number];
export type BackgroundLayer = (typeof BACKGROUND_LAYERS)[number];
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type ExportStatus = (typeof EXPORT_STATUSES)[number];
export type QualityFlag = (typeof QUALITY_FLAGS)[number];
export type CropTarget = (typeof CROP_TARGETS)[number];

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type LocationInput = {
  text?: string;
  latitude?: number;
  longitude?: number;
  geojson?: JsonObject;
};

export type ContainerInfo = {
  containerType?: string;
  containerVolumeL?: number;
  medium?: string;
};

export type Unit = {
  id: string;
  name: string;
  type: UnitType;
  locationText?: string;
  latitude?: number;
  longitude?: number;
  geometryGeojson?: JsonObject;
  areaM2?: number;
  containerInfo?: ContainerInfo;
  irrigationMethod?: string;
  ownerRef?: string;
  projectRef?: string;
  status: UnitStatus;
  profileSummary?: JsonObject;
  createdAt: string;
  updatedAt: string;
};

export type CropPlan = {
  id: string;
  unitId: string;
  crop: string;
  cultivar?: string;
  sowingDate?: string;
  transplantDate?: string;
  currentStage?: string;
  target?: CropTarget;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AttachmentRef = {
  id: string;
  kind: "upload";
  path: string;
  originalName: string;
  contentType?: string;
  sizeBytes: number;
};

export type Observation = {
  id: string;
  unitId: string;
  cropPlanId?: string;
  source: ObservationSource;
  type: ObservationType;
  payload: JsonObject;
  attachmentRefs: AttachmentRef[];
  qualityFlag?: QualityFlag;
  createdAt: string;
};

export type OperationLog = {
  id: string;
  unitId: string;
  cropPlanId?: string;
  type: OperationType;
  details: JsonObject;
  confirmed: boolean;
  confirmedBy?: string;
  confirmedAt?: string;
  riskLevel: OperationRiskLevel;
  linkedRecommendationId?: string;
  linkedReminderId?: string;
  createdAt: string;
};

export type Recommendation = {
  id: string;
  unitId: string;
  cropPlanId?: string;
  category: RecommendationCategory;
  severity: RecommendationSeverity;
  rationale: Json[];
  requiredInputs: Json[];
  proposedActions: Json[];
  confidence: number;
  needsHumanConfirm: boolean;
  generatedAt: string;
  engine: string;
};

export type Reminder = {
  id: string;
  unitId: string;
  cropPlanId?: string;
  reminderType: string;
  scheduleBasis: ReminderScheduleBasis;
  dueAt: string;
  status: ReminderStatus;
  linkedRecommendationId?: string;
  recurrenceRule?: JsonObject;
  payload: JsonObject;
  sentAt?: string;
  completedAt?: string;
  skippedAt?: string;
  createdAt: string;
};

export type BackgroundSnapshot = {
  id: string;
  unitId: string;
  date: string;
  layer: BackgroundLayer;
  source: string;
  payload: JsonObject;
  qualityFlag?: QualityFlag;
  createdAt: string;
};

export type ExportJob = {
  id: string;
  scope: JsonObject;
  format: ExportFormat;
  status: ExportStatus;
  outputPath?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type AuditLog = {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: JsonObject;
  createdAt: string;
};

export type TimelineEvent = {
  kind: "observation" | "operation" | "recommendation" | "reminder";
  at: string;
  data: Observation | OperationLog | Recommendation | Reminder;
};

export type CareCheckContext = {
  unit: Unit;
  cropPlan?: CropPlan;
  recentObservations: Observation[];
  recentOperations: OperationLog[];
  latestBackground: BackgroundSnapshot[];
};

export type CareCheckOutput = {
  recommendations: Array<Omit<Recommendation, "id" | "generatedAt"> & { generatedAt?: string }>;
  reminders: Array<Omit<Reminder, "id" | "status" | "createdAt"> & { status?: ReminderStatus; createdAt?: string }>;
  missingInputs: string[];
  mode: "conservative" | "rule-based";
};

export const HIGH_RISK_OPERATION_TYPES = new Set<OperationType>(["spraying", "harvest", "postharvest"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function asJsonObject(value: unknown): JsonObject {
  return isRecord(value) ? (value as JsonObject) : {};
}

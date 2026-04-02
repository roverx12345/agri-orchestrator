export const PRODUCTION_UNIT_KINDS = [
  "field",
  "greenhouse",
  "orchard",
  "container",
  "nursery",
] as const;

export const OBSERVATION_TYPES = [
  "weather",
  "soil_moisture",
  "soil_test",
  "tissue_test",
  "pest_scout",
  "disease_scout",
  "weed_scout",
  "phenology",
  "quality",
] as const;

export const OBSERVATION_SOURCES = [
  "manual",
  "sensor",
  "api",
  "lab",
  "vision",
] as const;

export const QUALITY_FLAGS = ["ok", "suspect", "missing"] as const;

export const OPERATION_TYPES = [
  "land_prep",
  "sowing",
  "transplanting",
  "irrigation",
  "fertilization",
  "spraying",
  "pruning",
  "weeding",
  "harvest",
  "postharvest",
] as const;

export const RECOMMENDATION_CATEGORIES = [
  "planning",
  "data_quality",
  "monitoring",
  "irrigation",
  "nutrition",
  "ipm",
  "harvest",
  "compliance",
] as const;

export const RECOMMENDATION_SEVERITIES = ["low", "medium", "high", "critical"] as const;

export const HIGH_RISK_OPERATION_TYPES = ["spraying", "harvest", "postharvest"] as const;

export type ProductionUnitKind = (typeof PRODUCTION_UNIT_KINDS)[number];
export type ObservationType = (typeof OBSERVATION_TYPES)[number];
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];
export type QualityFlag = (typeof QUALITY_FLAGS)[number];
export type OperationType = (typeof OPERATION_TYPES)[number];
export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number];
export type RecommendationSeverity = (typeof RECOMMENDATION_SEVERITIES)[number];
export type HighRiskOperationType = (typeof HIGH_RISK_OPERATION_TYPES)[number];

export type JsonRecord = Record<string, unknown>;

export type ProductionUnit = {
  id: string;
  name: string;
  kind: ProductionUnitKind;
  description?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  areaM2?: number;
  tags?: string[];
  notes?: string;
  metadata?: JsonRecord;
  createdAt: string;
  updatedAt: string;
};

export type CropPlan = {
  id: string;
  unitId: string;
  crop: string;
  cultivar?: string;
  season?: string;
  sowingDate?: string;
  transplantDate?: string;
  currentStage?: string;
  targetYield?: string;
  targetYieldValue?: number;
  targetYieldUnit?: string;
  rulesetVersion?: string;
  notes?: string;
  metadata?: JsonRecord;
  createdAt: string;
  updatedAt: string;
};

export type Observation = {
  id: string;
  unitId?: string;
  cropPlanId?: string;
  type: ObservationType;
  observedAt: string;
  summary?: string;
  source?: ObservationSource;
  qualityFlag?: QualityFlag;
  data?: JsonRecord;
  createdAt: string;
};

export type OperationCompliance = {
  productName?: string;
  labelTargetCrop?: string;
  phiDays?: number;
  reiHours?: number;
  lotNumber?: string;
  notes?: string;
};

export type Operation = {
  id: string;
  unitId?: string;
  cropPlanId?: string;
  type: OperationType;
  performedAt: string;
  summary?: string;
  confirmed?: boolean;
  operator?: string;
  amount?: number;
  unit?: string;
  batchId?: string;
  lotId?: string;
  compliance?: OperationCompliance;
  data?: JsonRecord;
  createdAt: string;
};

export type RecommendationGovernance = {
  needsHumanConfirm: boolean;
  reason?: string;
};

export type Recommendation = {
  id: string;
  cropPlanId?: string;
  unitId?: string;
  category: RecommendationCategory;
  severity: RecommendationSeverity;
  confidence: number;
  rationale: string[];
  requiredInputs: string[];
  proposedActions: string[];
  governance: RecommendationGovernance;
  createdAt: string;
};

export type AgriStore = {
  version: 1;
  updatedAt: string;
  productionUnits: ProductionUnit[];
  cropPlans: CropPlan[];
  observations: Observation[];
  operations: Operation[];
  recommendations: Recommendation[];
};

export type CareCheckScope = "all" | "planId";

export type CareCheckFilters = {
  scope?: CareCheckScope;
  planId?: string;
  unitId?: string;
  cropPlanId?: string;
};

export type CareCheckPlanResult = {
  planId?: string;
  crop?: string;
  cropPackageId: string;
  mode: "package" | "conservative";
  inferredStage?: string;
  requiredInputs: string[];
};

export type CareCheckResult = {
  recommendations: Recommendation[];
  plans: CareCheckPlanResult[];
};

export function isHighRiskOperationType(value: OperationType): value is HighRiskOperationType {
  return (HIGH_RISK_OPERATION_TYPES as readonly string[]).includes(value);
}

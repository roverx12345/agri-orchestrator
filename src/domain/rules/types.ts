import type {
  AgriStore,
  CropPlan,
  Observation,
  Operation,
  ProductionUnit,
  Recommendation,
} from "../../types.js";

export type CropRuleBaseContext = {
  store: AgriStore;
  cropPlan: CropPlan;
  unit?: ProductionUnit;
  observations: Observation[];
  operations: Operation[];
  now: Date;
  nowIso: string;
};

export type CropRuleContext = CropRuleBaseContext & {
  stage?: string;
  inferredStage?: string;
};

export type CropRulePackage = {
  id: string;
  cropAliases: string[];
  getRequiredInputs: (ctx: CropRuleContext) => string[];
  inferStage: (ctx: CropRuleBaseContext) => string | undefined;
  evaluateWater: (ctx: CropRuleContext) => Recommendation[];
  evaluateNutrition: (ctx: CropRuleContext) => Recommendation[];
  evaluatePest: (ctx: CropRuleContext) => Recommendation[];
  evaluateHarvest: (ctx: CropRuleContext) => Recommendation[];
};


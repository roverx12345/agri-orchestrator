import { Static, Type } from "@sinclair/typebox";
import {
  OBSERVATION_TYPES,
  OPERATION_TYPES,
  PRODUCTION_UNIT_KINDS,
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_SEVERITIES,
} from "./types.js";

function enumSchema<T extends readonly string[]>(values: T, description?: string) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    description,
  });
}

const LooseRecordSchema = Type.Optional(Type.Record(Type.String(), Type.Unknown()));
const StringArraySchema = Type.Optional(Type.Array(Type.String({ minLength: 1 })));

export const ProductionUnitSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1 })),
    name: Type.String({ minLength: 1 }),
    kind: enumSchema(PRODUCTION_UNIT_KINDS, "Production unit kind."),
    description: Type.Optional(Type.String()),
    location: Type.Optional(Type.String()),
    areaM2: Type.Optional(Type.Number({ minimum: 0 })),
    tags: StringArraySchema,
    notes: Type.Optional(Type.String()),
    metadata: LooseRecordSchema,
  },
  { additionalProperties: false },
);

export const CropPlanSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1 })),
    unitId: Type.String({ minLength: 1 }),
    crop: Type.String({ minLength: 1 }),
    cultivar: Type.Optional(Type.String()),
    season: Type.Optional(Type.String()),
    sowingDate: Type.Optional(Type.String({ format: "date" })),
    transplantDate: Type.Optional(Type.String({ format: "date" })),
    currentStage: Type.Optional(Type.String()),
    targetYield: Type.Optional(Type.String()),
    notes: Type.Optional(Type.String()),
    metadata: LooseRecordSchema,
  },
  { additionalProperties: false },
);

export const ObservationSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1 })),
    unitId: Type.Optional(Type.String({ minLength: 1 })),
    cropPlanId: Type.Optional(Type.String({ minLength: 1 })),
    type: enumSchema(OBSERVATION_TYPES, "Observation type."),
    observedAt: Type.String({ format: "date-time" }),
    summary: Type.Optional(Type.String()),
    source: Type.Optional(Type.String()),
    data: LooseRecordSchema,
  },
  { additionalProperties: false },
);

export const OperationSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1 })),
    unitId: Type.Optional(Type.String({ minLength: 1 })),
    cropPlanId: Type.Optional(Type.String({ minLength: 1 })),
    type: enumSchema(OPERATION_TYPES, "Operation type."),
    performedAt: Type.String({ format: "date-time" }),
    summary: Type.Optional(Type.String()),
    operator: Type.Optional(Type.String()),
    confirmed: Type.Optional(Type.Boolean()),
    data: LooseRecordSchema,
  },
  { additionalProperties: false },
);

export const CareCheckSchema = Type.Object(
  {
    scope: Type.Optional(
      Type.Union([Type.Literal("all"), Type.Literal("planId")]),
    ),
    planId: Type.Optional(Type.String({ minLength: 1 })),
    unitId: Type.Optional(Type.String({ minLength: 1 })),
    cropPlanId: Type.Optional(Type.String({ minLength: 1 })),
    persistRecommendations: Type.Optional(Type.Boolean()),
    asOf: Type.Optional(Type.String({ format: "date-time" })),
  },
  { additionalProperties: false },
);

export const RecommendationSchema = Type.Object(
  {
    id: Type.String(),
    cropPlanId: Type.Optional(Type.String()),
    unitId: Type.Optional(Type.String()),
    category: enumSchema(RECOMMENDATION_CATEGORIES),
    severity: enumSchema(RECOMMENDATION_SEVERITIES),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    rationale: Type.String(),
    requiredInputs: Type.Array(Type.String()),
    proposedActions: Type.Array(Type.String()),
    governance: Type.Object(
      {
        needsHumanConfirm: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    createdAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);

export type ProductionUnitInput = Static<typeof ProductionUnitSchema>;
export type CropPlanInput = Static<typeof CropPlanSchema>;
export type ObservationInput = Static<typeof ObservationSchema>;
export type OperationInput = Static<typeof OperationSchema>;
export type CareCheckInput = Static<typeof CareCheckSchema>;

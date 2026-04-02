import type {
  BackgroundSnapshot,
  CareCheckContext,
  CareCheckOutput,
  Json,
  Observation,
  RecommendationCategory,
  RecommendationSeverity,
  ReminderScheduleBasis,
} from "../domain.js";
import { HIGH_RISK_OPERATION_TYPES } from "../domain.js";
import { clampConfidence, nowIso, toNumber } from "../utils.js";

function pushRecommendation(
  target: CareCheckOutput["recommendations"],
  item: {
    unitId: string;
    cropPlanId?: string;
    category: RecommendationCategory;
    severity: RecommendationSeverity;
    rationale: Json[];
    requiredInputs: Json[];
    proposedActions: Json[];
    confidence?: number;
    needsHumanConfirm?: boolean;
    engine?: string;
  },
) {
  target.push({
    unitId: item.unitId,
    cropPlanId: item.cropPlanId,
    category: item.category,
    severity: item.severity,
    rationale: item.rationale,
    requiredInputs: item.requiredInputs,
    proposedActions: item.proposedActions,
    confidence: clampConfidence(item.confidence, 0.6),
    needsHumanConfirm: item.needsHumanConfirm ?? false,
    engine: item.engine ?? "generic-conservative-v1",
    generatedAt: nowIso(),
  });
}

function pushReminder(
  target: CareCheckOutput["reminders"],
  item: {
    unitId: string;
    cropPlanId?: string;
    reminderType: string;
    scheduleBasis?: ReminderScheduleBasis;
    dueAt: string;
    linkedRecommendationId?: string;
    payload?: Record<string, Json>;
  },
) {
  target.push({
    unitId: item.unitId,
    cropPlanId: item.cropPlanId,
    reminderType: item.reminderType,
    scheduleBasis: item.scheduleBasis ?? "rule",
    dueAt: item.dueAt,
    status: "pending",
    linkedRecommendationId: item.linkedRecommendationId,
    recurrenceRule: undefined,
    payload: item.payload ?? {},
    createdAt: nowIso(),
  });
}

function latestObservation(observations: Observation[], type: Observation["type"]): Observation | undefined {
  return observations.find((item) => item.type === type);
}

function latestFeatureValue(background: BackgroundSnapshot[], key: string): unknown {
  for (const item of background) {
    if (item.layer !== "feature") continue;
    if (Object.prototype.hasOwnProperty.call(item.payload, key)) {
      return item.payload[key];
    }
  }
  return undefined;
}

function addHours(baseIso: string, hours: number): string {
  const date = new Date(baseIso);
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

function addDays(baseIso: string, days: number): string {
  const date = new Date(baseIso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function hasRecentScout(observations: Observation[]): boolean {
  return observations.some((item) => ["pest_scout", "disease_scout"].includes(item.type));
}

function latestFeaturePayload(background: BackgroundSnapshot[]): Record<string, Json> | undefined {
  return latestBackgroundByLayer(background, "feature")?.payload as Record<string, Json> | undefined;
}

function latestBackgroundByLayer(background: BackgroundSnapshot[], layer: BackgroundSnapshot["layer"]): BackgroundSnapshot | undefined {
  return background.find((item) => item.layer === layer);
}

function normalizeCropName(value: string | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function isCornCrop(value: string | undefined): boolean {
  return ["corn", "maize", "玉米"].includes(normalizeCropName(value));
}

function isCornRainSensitiveStage(stage: string | undefined): boolean {
  const normalized = String(stage ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return ["vegetative", "tasseling", "silking", "grain_fill", "pollination", "flowering"].some((token) => normalized.includes(token));
}

function extractWeatherSignals(weather: Observation | undefined, background: BackgroundSnapshot[]) {
  const feature = latestFeaturePayload(background);
  const rainRiskLevel = String(feature?.rainRiskLevel ?? weather?.payload.rainRiskLevel ?? "").toLowerCase();
  return {
    rainRiskLevel,
    forecastDate: String(feature?.forecastDate ?? weather?.payload.forecastDate ?? "").trim(),
    precipitationProbabilityMax: toNumber(feature?.precipitationProbabilityMax ?? weather?.payload.precipitationProbabilityMax),
    precipitationSumMm: toNumber(feature?.precipitationSumMm ?? weather?.payload.precipitationSumMm),
    windGustsMaxKph: toNumber(feature?.windGustsMaxKph ?? weather?.payload.windGustsMaxKph),
  };
}

export function runCareRules(context: CareCheckContext): CareCheckOutput {
  const now = nowIso();
  const output: CareCheckOutput = {
    recommendations: [],
    reminders: [],
    missingInputs: [],
    mode: "rule-based",
  };

  const { unit, cropPlan, recentObservations, recentOperations, latestBackground } = context;
  const cropPlanId = cropPlan?.id;

  const soilMoisture = latestObservation(recentObservations, "soil_moisture");
  const weather = latestObservation(recentObservations, "weather");
  const soilTest = latestObservation(recentObservations, "soil_test");
  const pestScout = latestObservation(recentObservations, "pest_scout");
  const diseaseScout = latestObservation(recentObservations, "disease_scout");
  const phenology = latestObservation(recentObservations, "phenology");
  const waterStress = latestFeatureValue(latestBackground, "waterStressLevel");
  const heatRisk = latestFeatureValue(latestBackground, "heatRiskLevel");
  const frostRisk = latestFeatureValue(latestBackground, "frostRiskLevel");
  const weatherSignals = extractWeatherSignals(weather, latestBackground);
  const rainRisk = weatherSignals.rainRiskLevel || String(latestFeatureValue(latestBackground, "rainRiskLevel") ?? "").toLowerCase();
  const nutrientRisk = latestFeatureValue(latestBackground, "nutrientRiskLevel");

  const recentHighRiskOperation = recentOperations.find((item) => HIGH_RISK_OPERATION_TYPES.has(item.type));

  // Water check.
  if (!soilMoisture && waterStress === undefined) {
    output.mode = "conservative";
    output.missingInputs.push("recent soil moisture");
    pushRecommendation(output.recommendations, {
      unitId: unit.id,
      cropPlanId,
      category: "water",
      severity: "watch",
      rationale: ["Missing recent soil moisture or water-stress feature input."],
      requiredInputs: ["soil_moisture observation", "or feature.waterStressLevel"],
      proposedActions: [
        "Check topsoil or container moisture before irrigation.",
        "If unsure, apply only a light conservative irrigation and re-check within 12-24h.",
      ],
      confidence: 0.45,
    });
    pushReminder(output.reminders, {
      unitId: unit.id,
      cropPlanId,
      reminderType: "collect-soil-moisture",
      dueAt: addHours(now, 12),
      payload: { reason: "missing soil moisture" },
    });
  } else {
    const moistureStatus = String(soilMoisture?.payload.status ?? waterStress ?? "").toLowerCase();
    if (["dry", "low", "stress", "high"].includes(moistureStatus)) {
      pushRecommendation(output.recommendations, {
        unitId: unit.id,
        cropPlanId,
        category: "water",
        severity: "action",
        rationale: ["Recent moisture signal indicates dryness or water stress."],
        requiredInputs: [],
        proposedActions: ["Plan irrigation soon and verify runoff/drainage conditions.", "After irrigation, capture a follow-up moisture observation."],
        confidence: 0.82,
      });
      pushReminder(output.reminders, {
        unitId: unit.id,
        cropPlanId,
        reminderType: "water-check-follow-up",
        dueAt: addHours(now, 24),
        payload: { category: "water" },
      });
    } else if (["wet", "high-moisture", "excess"].includes(moistureStatus)) {
      pushRecommendation(output.recommendations, {
        unitId: unit.id,
        cropPlanId,
        category: "water",
        severity: "info",
        rationale: ["Recent moisture signal indicates adequate or excessive moisture."],
        requiredInputs: [],
        proposedActions: ["Avoid extra irrigation until the next inspection.", "Watch for root-zone aeration or disease issues if wetness persists."],
        confidence: 0.72,
      });
    }
  }

  // Nutrition check.
  if (!soilTest && nutrientRisk === undefined) {
    output.mode = output.mode === "rule-based" ? "conservative" : output.mode;
    output.missingInputs.push("recent soil or nutrition status");
    pushRecommendation(output.recommendations, {
      unitId: unit.id,
      cropPlanId,
      category: "nutrition",
      severity: "watch",
      rationale: ["No recent soil test or nutrient feature is available."],
      requiredInputs: ["soil_test observation", "or feature.nutrientRiskLevel"],
      proposedActions: ["Do not escalate fertilization aggressively.", "Collect a simple nutrition note or test result before increasing fertilizer rate."],
      confidence: 0.4,
    });
  } else {
    const nutrientStatus = String(soilTest?.payload.status ?? nutrientRisk ?? "").toLowerCase();
    if (["low", "deficit", "insufficient", "stress"].includes(nutrientStatus)) {
      pushRecommendation(output.recommendations, {
        unitId: unit.id,
        cropPlanId,
        category: "nutrition",
        severity: "action",
        rationale: ["Nutrition signal indicates a likely deficit."],
        requiredInputs: [],
        proposedActions: ["Prepare a conservative nutrition correction plan.", "Record fertilizer type, amount, and operator if you execute it."],
        confidence: 0.75,
      });
      pushReminder(output.reminders, {
        unitId: unit.id,
        cropPlanId,
        reminderType: "nutrition-review",
        dueAt: addDays(now, 2),
        payload: { category: "nutrition" },
      });
    }
  }

  // Scout priority.
  if (!hasRecentScout(recentObservations)) {
    output.missingInputs.push("recent pest/disease scout");
    pushRecommendation(output.recommendations, {
      unitId: unit.id,
      cropPlanId,
      category: "pest",
      severity: "watch",
      rationale: ["No recent pest or disease scouting record is available."],
      requiredInputs: ["pest_scout", "disease_scout"],
      proposedActions: ["Schedule a field/container scout before taking any pesticide action.", "Capture image or text evidence for suspect symptoms."],
      confidence: 0.52,
    });
    pushReminder(output.reminders, {
      unitId: unit.id,
      cropPlanId,
      reminderType: "scout-priority",
      dueAt: addHours(now, 24),
      payload: { category: "pest-disease" },
    });
  }

  const pestLevel = String(pestScout?.payload.level ?? "").toLowerCase();
  const diseaseLevel = String(diseaseScout?.payload.level ?? "").toLowerCase();
  if (["high", "severe", "urgent"].includes(pestLevel) || ["high", "severe", "urgent"].includes(diseaseLevel)) {
    pushRecommendation(output.recommendations, {
      unitId: unit.id,
      cropPlanId,
      category: pestLevel ? "pest" : "disease",
      severity: "urgent",
      rationale: ["Scout record indicates elevated biological risk."],
      requiredInputs: [],
      proposedActions: ["Escalate to a human reviewer before any spraying.", "If treatment is required, log product, PHI/REI, and confirmation fields."],
      confidence: 0.8,
      needsHumanConfirm: true,
    });
  }

  // Harvest placeholder.
  const stage = String(cropPlan?.currentStage ?? phenology?.payload.stage ?? "").toLowerCase();
  if (["mature", "ripening", "flowering", "harvest", "harvest-ready"].includes(stage)) {
    pushRecommendation(output.recommendations, {
      unitId: unit.id,
      cropPlanId,
      category: "harvest",
      severity: stage.includes("harvest") ? "action" : "watch",
      rationale: ["Current stage suggests harvest-readiness review is relevant."],
      requiredInputs: stage.includes("flowering") ? ["quality / maturity observation"] : [],
      proposedActions: ["Run a manual harvest-readiness check.", "Do not finalize harvest decisions purely from LLM output."],
      confidence: 0.58,
    });
  }

  if (isCornCrop(cropPlan?.crop) && isCornRainSensitiveStage(stage) && ["medium", "high", "severe", "urgent"].includes(rainRisk)) {
    const severity: RecommendationSeverity = ["high", "severe", "urgent"].includes(rainRisk) ? "urgent" : "action";
    const forecastBits: string[] = [];
    if (typeof weatherSignals.precipitationProbabilityMax === "number") {
      forecastBits.push(`precipitation probability ${weatherSignals.precipitationProbabilityMax}%`);
    }
    if (typeof weatherSignals.precipitationSumMm === "number") {
      forecastBits.push(`precipitation ${weatherSignals.precipitationSumMm} mm`);
    }
    if (typeof weatherSignals.windGustsMaxKph === "number") {
      forecastBits.push(`wind gusts ${weatherSignals.windGustsMaxKph} km/h`);
    }

    pushRecommendation(output.recommendations, {
      unitId: unit.id,
      cropPlanId,
      category: "general",
      severity,
      rationale: [
        `Corn field rain risk is ${rainRisk}${weatherSignals.forecastDate ? ` for ${weatherSignals.forecastDate}` : ""}.`,
        forecastBits.length > 0 ? `Forecast summary: ${forecastBits.join(", ")}.` : "A recent weather forecast indicates a near-term rain event.",
        `Corn is currently at ${stage}, so field access, foliar work, and post-rain disease scouting should be planned conservatively.`,
      ],
      requiredInputs: [],
      proposedActions: [
        "Check drainage paths and low-lying spots before the rain window.",
        "Avoid foliar spraying or unnecessary field entry immediately before the event unless a human agronomist confirms it.",
        "Schedule a scout within 24 hours after the rain for lodging and leaf disease pressure.",
      ],
      confidence: severity === "urgent" ? 0.86 : 0.74,
    });
    pushReminder(output.reminders, {
      unitId: unit.id,
      cropPlanId,
      reminderType: "corn-post-rain-scout",
      scheduleBasis: "forecast-triggered",
      dueAt: addHours(now, 24),
      payload: {
        crop: cropPlan?.crop ?? "corn",
        forecastDate: weatherSignals.forecastDate || null,
        rainRiskLevel: rainRisk,
      },
    });
  }

  // General risk scan.
  const riskSignals = [
    { label: "heat", value: String(heatRisk ?? "").toLowerCase() },
    { label: "frost", value: String(frostRisk ?? "").toLowerCase() },
    { label: "rain", value: String(rainRisk ?? "").toLowerCase() },
  ].filter((item) => item.value);

  if (riskSignals.some((item) => ["high", "severe", "urgent"].includes(item.value))) {
    pushRecommendation(output.recommendations, {
      unitId: unit.id,
      cropPlanId,
      category: "general",
      severity: "urgent",
      rationale: riskSignals.map((item) => `${item.label} risk signal = ${item.value}`),
      requiredInputs: [],
      proposedActions: ["Review weather-linked protection steps.", "Check whether reminders should be advanced or rescheduled."],
      confidence: 0.78,
    });
  } else if (!weather && riskSignals.length === 0) {
    output.missingInputs.push("recent weather/background feature snapshot");
    pushRecommendation(output.recommendations, {
      unitId: unit.id,
      cropPlanId,
      category: "general",
      severity: "info",
      rationale: ["No recent weather note or feature snapshot was found."],
      requiredInputs: ["weather observation or background feature ingest"],
      proposedActions: ["Ingest the latest weather/background snapshot for more reliable checks."],
      confidence: 0.35,
    });
  }

  if (recentHighRiskOperation && !recentHighRiskOperation.confirmed) {
    pushRecommendation(output.recommendations, {
      unitId: unit.id,
      cropPlanId,
      category: "compliance",
      severity: "urgent",
      rationale: [`High-risk operation ${recentHighRiskOperation.type} exists without confirmation.`],
      requiredInputs: ["confirmedBy", "confirmedAt"],
      proposedActions: ["Confirm the operation record before treating it as executed."],
      confidence: 0.9,
      needsHumanConfirm: true,
    });
  }

  output.missingInputs = [...new Set(output.missingInputs)];
  return output;
}

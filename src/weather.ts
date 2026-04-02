import { randomUUID } from "node:crypto";
import { loadStore, writeStore } from "./store.js";
import type { AgriStore, Observation, ProductionUnit } from "./types.js";

const DEFAULT_REFRESH_AFTER_MS = 18 * 60 * 60 * 1000;
const DEFAULT_FORECAST_DAYS = 3;
const CHINA_PROVINCE_NAMES = [
  "北京市",
  "天津市",
  "上海市",
  "重庆市",
  "河北省",
  "山西省",
  "辽宁省",
  "吉林省",
  "黑龙江省",
  "江苏省",
  "浙江省",
  "安徽省",
  "福建省",
  "江西省",
  "山东省",
  "河南省",
  "湖北省",
  "湖南省",
  "广东省",
  "海南省",
  "四川省",
  "贵州省",
  "云南省",
  "陕西省",
  "甘肃省",
  "青海省",
  "台湾省",
  "内蒙古自治区",
  "广西壮族自治区",
  "西藏自治区",
  "宁夏回族自治区",
  "新疆维吾尔自治区",
  "香港特别行政区",
  "澳门特别行政区",
] as const;

type FetchLike = typeof fetch;

type OpenMeteoGeocodeResult = {
  name: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  country?: string;
  admin1?: string;
};

type OpenMeteoForecastDay = {
  date: string;
  temperatureMinC?: number;
  temperatureMaxC?: number;
  precipitationProbabilityMax?: number;
  precipitationSumMm?: number;
  windSpeedMaxKph?: number;
  windGustsMaxKph?: number;
  weatherCode?: number;
};

export type WeatherForecastSnapshot = {
  source: "open-meteo";
  kind: "forecast";
  query: string;
  resolvedName: string;
  forecastDate: string;
  latitude: number;
  longitude: number;
  timezone: string;
  temperatureMinC?: number;
  temperatureMaxC?: number;
  precipitationProbabilityMax?: number;
  precipitationSumMm?: number;
  windSpeedMaxKph?: number;
  windGustsMaxKph?: number;
  weatherCode?: number;
  rainRiskLevel: "low" | "medium" | "high" | "severe";
  fetchedAt: string;
  expiresAt: string;
};

export type WeatherSyncOptions = {
  fetchFn?: FetchLike;
  now?: Date;
  refreshAfterMs?: number;
  forecastDays?: number;
  unitIds?: string[];
  store?: AgriStore;
};

export type WeatherSyncResult = {
  updatedUnitIds: string[];
  skippedUnitIds: string[];
  errors: Array<{ unitId: string; message: string }>;
  store: AgriStore;
  storePath?: string;
};

export type GeocodedLocation = {
  query: string;
  resolvedName: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

function trimOptional(value?: string): string | undefined {
  if (!value) {
    return;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeChineseLocation(input: string): string {
  return input.replace(/\s+/g, "");
}

function stripKnownLocationSuffixes(input: string): string {
  return input
    .replace(/[（(].*?[）)]/g, " ")
    .replace(/\b(experimental|experiment|trial|test)\s+(field|farm|plot|block)\b/gi, " ")
    .replace(/\b(field|farm|plot|block|trial)\b/gi, " ")
    .replace(/(试验田|实验田|示范田|试验站|地块|田块|农场|基地|园区|小区)$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildChineseAdministrativeQueries(input: string): string[] {
  const normalized = normalizeChineseLocation(stripKnownLocationSuffixes(input));
  if (!/[\u4e00-\u9fff]/.test(normalized)) {
    return [];
  }

  const candidates = new Set<string>([normalized]);

  for (const provinceFull of CHINA_PROVINCE_NAMES) {
    const provinceShort = provinceFull
      .replace(/省$|市$|自治区$|特别行政区$/g, "");
    if (!normalized.startsWith(provinceShort) && !normalized.startsWith(provinceFull)) {
      continue;
    }

    const matchedPrefix = normalized.startsWith(provinceFull) ? provinceFull : provinceShort;
    const rest = normalized.slice(matchedPrefix.length);
    candidates.add(provinceFull);
    if (!rest) {
      continue;
    }

    if (rest.length <= 3) {
      candidates.add(`${provinceFull}${rest}${/(市|县|区)$/.test(rest) ? "" : "市"}`);
      candidates.add(/(市|县|区)$/.test(rest) ? rest : `${rest}市`);
      continue;
    }

    for (let index = 2; index <= Math.min(4, rest.length - 1); index += 1) {
      const city = rest.slice(0, index);
      const district = rest.slice(index);
      const cityLabel = /(市|州|盟|地区)$/.test(city) ? city : `${city}市`;
      const districtLabel = /(县|区|市|旗)$/.test(district) ? district : `${district}县`;

      candidates.add(`${provinceFull}${cityLabel}`);
      candidates.add(`${provinceFull}${cityLabel}${districtLabel}`);
      candidates.add(`${cityLabel}${districtLabel}`);
      candidates.add(districtLabel);
    }
  }

  return [...candidates];
}

function buildGeocodeQueries(input: string): string[] {
  const trimmed = input.trim();
  const candidates = new Set<string>([trimmed]);
  const stripped = stripKnownLocationSuffixes(trimmed);

  if (stripped && stripped !== trimmed) {
    candidates.add(stripped);
  }

  for (const query of buildChineseAdministrativeQueries(trimmed)) {
    candidates.add(query);
  }

  return [...candidates];
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((item) => item.type === "year")?.value;
  const month = parts.find((item) => item.type === "month")?.value;
  const day = parts.find((item) => item.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function classifyRainRisk(day: OpenMeteoForecastDay): WeatherForecastSnapshot["rainRiskLevel"] {
  const probability = day.precipitationProbabilityMax ?? 0;
  const precipitation = day.precipitationSumMm ?? 0;

  if (probability >= 85 || precipitation >= 25) {
    return "severe";
  }
  if (probability >= 65 || precipitation >= 10) {
    return "high";
  }
  if (probability >= 35 || precipitation >= 2) {
    return "medium";
  }
  return "low";
}

function buildResolvedName(geo: OpenMeteoGeocodeResult): string {
  const parts = [geo.admin1, geo.name, geo.country].filter((item): item is string => Boolean(item));
  return parts.length > 0 ? parts.join(", ") : geo.name;
}

function extractUnitCoordinates(unit: ProductionUnit): { latitude?: number; longitude?: number; timezone?: string } {
  const metadata = isRecord(unit.metadata) ? unit.metadata : undefined;
  const metadataLatitude = toNumber(metadata?.latitude);
  const metadataLongitude = toNumber(metadata?.longitude);
  const metadataTimezone = pickString(metadata?.timezone);

  return {
    latitude: toNumber((unit as { latitude?: unknown }).latitude) ?? metadataLatitude,
    longitude: toNumber((unit as { longitude?: unknown }).longitude) ?? metadataLongitude,
    timezone: pickString((unit as { timezone?: unknown }).timezone) ?? metadataTimezone,
  };
}

function isWeatherForecastData(value: unknown): value is WeatherForecastSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return value.kind === "forecast" && value.source === "open-meteo" && typeof value.forecastDate === "string";
}

export function findLatestForecastObservation(
  store: AgriStore,
  unitId: string,
): Observation | undefined {
  return [...store.observations]
    .filter((item) => item.type === "weather" && item.unitId === unitId && isWeatherForecastData(item.data))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}

function isForecastFresh(
  observation: Observation | undefined,
  now: Date,
  refreshAfterMs: number,
): boolean {
  if (!observation || !isWeatherForecastData(observation.data)) {
    return false;
  }

  const data = observation.data;
  const fetchedAt = Date.parse(data.fetchedAt);
  if (!Number.isFinite(fetchedAt) || now.getTime() - fetchedAt > refreshAfterMs) {
    return false;
  }

  const expiresAt = Date.parse(data.expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) {
    return false;
  }

  const today = formatDateInTimeZone(now, data.timezone);
  return data.forecastDate > today;
}

function makeWeatherSummary(snapshot: WeatherForecastSnapshot): string {
  const bits: string[] = [`Forecast for ${snapshot.forecastDate}`];
  bits.push(`rain risk ${snapshot.rainRiskLevel}`);

  if (typeof snapshot.precipitationProbabilityMax === "number") {
    bits.push(`precipitation probability ${snapshot.precipitationProbabilityMax}%`);
  }
  if (typeof snapshot.precipitationSumMm === "number") {
    bits.push(`precipitation ${snapshot.precipitationSumMm} mm`);
  }

  if (
    typeof snapshot.temperatureMinC === "number" ||
    typeof snapshot.temperatureMaxC === "number"
  ) {
    const range = [snapshot.temperatureMinC, snapshot.temperatureMaxC]
      .map((value) => (typeof value === "number" ? `${value}C` : undefined))
      .filter((value): value is string => Boolean(value))
      .join(" to ");
    if (range) {
      bits.push(`temperature ${range}`);
    }
  }

  return `${snapshot.resolvedName}: ${bits.join(", ")}.`;
}

export function formatWeatherPromptLine(observation: Observation): string | undefined {
  if (!isWeatherForecastData(observation.data)) {
    return;
  }

  const data = observation.data;
  const bits = [`rain risk ${data.rainRiskLevel}`];

  if (typeof data.precipitationProbabilityMax === "number") {
    bits.push(`precip ${data.precipitationProbabilityMax}%`);
  }
  if (typeof data.precipitationSumMm === "number") {
    bits.push(`${data.precipitationSumMm} mm`);
  }

  if (
    typeof data.temperatureMinC === "number" ||
    typeof data.temperatureMaxC === "number"
  ) {
    const min = typeof data.temperatureMinC === "number" ? data.temperatureMinC : undefined;
    const max = typeof data.temperatureMaxC === "number" ? data.temperatureMaxC : undefined;
    if (typeof min === "number" && typeof max === "number") {
      bits.push(`${min}-${max}C`);
    } else if (typeof max === "number") {
      bits.push(`up to ${max}C`);
    } else if (typeof min === "number") {
      bits.push(`down to ${min}C`);
    }
  }

  if (typeof data.windSpeedMaxKph === "number") {
    bits.push(`wind ${data.windSpeedMaxKph} km/h`);
  }

  return `- Tomorrow weather for ${data.resolvedName}: ${bits.join(", ")} (forecast ${data.forecastDate}, updated ${data.fetchedAt}).`;
}

async function fetchJson(fetchFn: FetchLike, input: URL): Promise<unknown> {
  const response = await fetchFn(input, {
    headers: {
      accept: "application/json",
      "user-agent": "agri-orchestrator/0.1.0 (+https://openclaw.local)",
    },
  });
  if (!response.ok) {
    throw new Error(`weather provider request failed with ${response.status}`);
  }
  return response.json();
}

async function geocodeLocationWithOpenMeteo(
  fetchFn: FetchLike,
  queryText: string,
): Promise<OpenMeteoGeocodeResult | undefined> {
  for (const candidate of buildGeocodeQueries(queryText)) {
    const query = new URL("https://geocoding-api.open-meteo.com/v1/search");
    query.searchParams.set("name", candidate);
    query.searchParams.set("count", "1");
    query.searchParams.set("language", "zh");
    query.searchParams.set("format", "json");

    const json = await fetchJson(fetchFn, query);
    if (!isRecord(json) || !Array.isArray(json.results) || json.results.length === 0 || !isRecord(json.results[0])) {
      continue;
    }

    const first = json.results[0];
    const latitude = toNumber(first.latitude);
    const longitude = toNumber(first.longitude);
    const name = pickString(first.name);

    if (typeof latitude !== "number" || typeof longitude !== "number" || !name) {
      continue;
    }

    return {
      name,
      latitude,
      longitude,
      timezone: pickString(first.timezone),
      country: pickString(first.country),
      admin1: pickString(first.admin1),
    };
  }

  return;
}

async function geocodeLocationWithNominatim(
  fetchFn: FetchLike,
  queryText: string,
): Promise<OpenMeteoGeocodeResult | undefined> {
  for (const candidate of buildGeocodeQueries(queryText)) {
    const query = new URL("https://nominatim.openstreetmap.org/search");
    query.searchParams.set("q", candidate);
    query.searchParams.set("format", "jsonv2");
    query.searchParams.set("limit", "1");
    query.searchParams.set("addressdetails", "1");

    const json = await fetchJson(fetchFn, query);
    if (!Array.isArray(json) || json.length === 0 || !isRecord(json[0])) {
      continue;
    }

    const first = json[0];
    const latitude =
      typeof first.lat === "string" ? Number(first.lat) : toNumber(first.lat);
    const longitude =
      typeof first.lon === "string" ? Number(first.lon) : toNumber(first.lon);
    const address = isRecord(first.address) ? first.address : undefined;
    const name =
      pickString(address?.city) ??
      pickString(address?.town) ??
      pickString(address?.county) ??
      pickString(address?.state_district) ??
      pickString(first.display_name);

    if (typeof latitude !== "number" || typeof longitude !== "number" || !name) {
      continue;
    }

    return {
      name,
      latitude,
      longitude,
      country: pickString(address?.country),
      admin1: pickString(address?.state),
      timezone: "Asia/Shanghai",
    };
  }
}

async function geocodeLocation(fetchFn: FetchLike, queryText: string): Promise<OpenMeteoGeocodeResult> {
  const openMeteoResult = await geocodeLocationWithOpenMeteo(fetchFn, queryText);
  if (openMeteoResult) {
    return openMeteoResult;
  }

  const nominatimResult = await geocodeLocationWithNominatim(fetchFn, queryText);
  if (nominatimResult) {
    return nominatimResult;
  }

  throw new Error(`no geocoding result for ${queryText}`);
}

export async function lookupLocationCoordinates(
  queryText: string,
  options: {
    fetchFn?: FetchLike;
  } = {},
): Promise<GeocodedLocation> {
  const result = await geocodeLocation(options.fetchFn ?? fetch, queryText);
  return {
    query: queryText,
    resolvedName: buildResolvedName(result),
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone,
  };
}

async function fetchTomorrowForecast(
  fetchFn: FetchLike,
  params: {
    latitude: number;
    longitude: number;
    timezone?: string;
    now: Date;
    forecastDays: number;
  },
): Promise<{ timezone: string; day: OpenMeteoForecastDay }> {
  const query = new URL("https://api.open-meteo.com/v1/forecast");
  query.searchParams.set("latitude", String(params.latitude));
  query.searchParams.set("longitude", String(params.longitude));
  query.searchParams.set("timezone", params.timezone ?? "auto");
  query.searchParams.set("forecast_days", String(params.forecastDays));
  query.searchParams.set(
    "daily",
    [
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "precipitation_sum",
      "wind_speed_10m_max",
      "wind_gusts_10m_max",
      "weather_code",
    ].join(","),
  );

  const json = await fetchJson(fetchFn, query);
  if (!isRecord(json) || !isRecord(json.daily)) {
    throw new Error("weather provider daily forecast is missing");
  }

  const timezone = pickString(json.timezone) ?? params.timezone ?? "UTC";
  const daily = json.daily;
  const time = Array.isArray(daily.time) ? daily.time : [];
  if (time.length === 0) {
    throw new Error("weather provider returned no daily forecast rows");
  }

  const today = formatDateInTimeZone(params.now, timezone);
  const days = time.map((value, index) => ({
    date: typeof value === "string" ? value : "",
    temperatureMinC: Array.isArray(daily.temperature_2m_min) ? toNumber(daily.temperature_2m_min[index]) : undefined,
    temperatureMaxC: Array.isArray(daily.temperature_2m_max) ? toNumber(daily.temperature_2m_max[index]) : undefined,
    precipitationProbabilityMax: Array.isArray(daily.precipitation_probability_max)
      ? toNumber(daily.precipitation_probability_max[index])
      : undefined,
    precipitationSumMm: Array.isArray(daily.precipitation_sum) ? toNumber(daily.precipitation_sum[index]) : undefined,
    windSpeedMaxKph: Array.isArray(daily.wind_speed_10m_max) ? toNumber(daily.wind_speed_10m_max[index]) : undefined,
    windGustsMaxKph: Array.isArray(daily.wind_gusts_10m_max) ? toNumber(daily.wind_gusts_10m_max[index]) : undefined,
    weatherCode: Array.isArray(daily.weather_code) ? toNumber(daily.weather_code[index]) : undefined,
  }));

  const targetDay = days.find((item) => item.date > today) ?? days[0];
  if (!targetDay || !targetDay.date) {
    throw new Error("weather provider returned no usable forecast day");
  }

  return { timezone, day: targetDay };
}

function upsertForecastObservation(
  store: AgriStore,
  unit: ProductionUnit,
  snapshot: WeatherForecastSnapshot,
): void {
  const existingIndex = store.observations.findIndex((item) => {
    if (item.type !== "weather" || item.unitId !== unit.id || !isWeatherForecastData(item.data)) {
      return false;
    }

    return item.data.forecastDate === snapshot.forecastDate && item.data.source === snapshot.source;
  });

  const nextObservation: Observation = {
    id: existingIndex >= 0 ? store.observations[existingIndex]!.id : `obs_${randomUUID()}`,
    unitId: unit.id,
    type: "weather",
    observedAt: snapshot.fetchedAt,
    summary: makeWeatherSummary(snapshot),
    source: "api",
    qualityFlag: "ok",
    data: snapshot,
    createdAt: snapshot.fetchedAt,
  };

  if (existingIndex >= 0) {
    store.observations[existingIndex] = nextObservation;
  } else {
    store.observations.push(nextObservation);
  }
}

function updateUnitCoordinates(store: AgriStore, unitId: string, patch: { latitude: number; longitude: number; timezone?: string }) {
  const index = store.productionUnits.findIndex((item) => item.id === unitId);
  if (index < 0) {
    return;
  }

  const current = store.productionUnits[index]!;
  store.productionUnits[index] = {
    ...current,
    latitude: patch.latitude,
    longitude: patch.longitude,
    timezone: patch.timezone ?? (current as { timezone?: string }).timezone,
    updatedAt: new Date().toISOString(),
  } as ProductionUnit;
}

async function buildForecastSnapshot(
  fetchFn: FetchLike,
  unit: ProductionUnit,
  now: Date,
  forecastDays: number,
): Promise<WeatherForecastSnapshot> {
  const coordinates = extractUnitCoordinates(unit);
  const query = trimOptional(unit.location) ?? trimOptional(unit.name);

  if (!query && (typeof coordinates.latitude !== "number" || typeof coordinates.longitude !== "number")) {
    throw new Error("unit has neither a location string nor coordinates");
  }

  let resolved = {
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    timezone: coordinates.timezone,
    resolvedName: query ?? unit.name,
  };

  if (typeof resolved.latitude !== "number" || typeof resolved.longitude !== "number") {
    const geocoded = await geocodeLocation(fetchFn, query ?? unit.name);
    resolved = {
      latitude: geocoded.latitude,
      longitude: geocoded.longitude,
      timezone: geocoded.timezone,
      resolvedName: buildResolvedName(geocoded),
    };
  }

  if (typeof resolved.latitude !== "number" || typeof resolved.longitude !== "number") {
    throw new Error(`unable to resolve coordinates for ${query ?? unit.name}`);
  }

  const forecast = await fetchTomorrowForecast(fetchFn, {
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    timezone: resolved.timezone,
    now,
    forecastDays,
  });
  const fetchedAt = now.toISOString();

  return {
    source: "open-meteo",
    kind: "forecast",
    query: query ?? unit.name,
    resolvedName: resolved.resolvedName,
    forecastDate: forecast.day.date,
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    timezone: forecast.timezone,
    temperatureMinC: forecast.day.temperatureMinC,
    temperatureMaxC: forecast.day.temperatureMaxC,
    precipitationProbabilityMax: forecast.day.precipitationProbabilityMax,
    precipitationSumMm: forecast.day.precipitationSumMm,
    windSpeedMaxKph: forecast.day.windSpeedMaxKph,
    windGustsMaxKph: forecast.day.windGustsMaxKph,
    weatherCode: forecast.day.weatherCode,
    rainRiskLevel: classifyRainRisk(forecast.day),
    fetchedAt,
    expiresAt: addHours(now, 24).toISOString(),
  };
}

export async function syncWorkspaceWeather(
  workspaceDir: string,
  options: WeatherSyncOptions = {},
): Promise<WeatherSyncResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? new Date();
  const refreshAfterMs = options.refreshAfterMs ?? DEFAULT_REFRESH_AFTER_MS;
  const forecastDays = options.forecastDays ?? DEFAULT_FORECAST_DAYS;
  const store = options.store ?? await loadStore(workspaceDir);
  const targetUnitIds = options.unitIds?.length
    ? options.unitIds
    : Array.from(new Set(store.cropPlans.map((item) => item.unitId)));

  const updatedUnitIds: string[] = [];
  const skippedUnitIds: string[] = [];
  const errors: Array<{ unitId: string; message: string }> = [];
  let dirty = false;

  for (const unitId of targetUnitIds) {
    const unit = store.productionUnits.find((item) => item.id === unitId);
    if (!unit) {
      skippedUnitIds.push(unitId);
      continue;
    }

    const latest = findLatestForecastObservation(store, unitId);
    if (isForecastFresh(latest, now, refreshAfterMs)) {
      skippedUnitIds.push(unitId);
      continue;
    }

    try {
      const snapshot = await buildForecastSnapshot(fetchFn, unit, now, forecastDays);
      upsertForecastObservation(store, unit, snapshot);
      updateUnitCoordinates(store, unit.id, {
        latitude: snapshot.latitude,
        longitude: snapshot.longitude,
        timezone: snapshot.timezone,
      });
      updatedUnitIds.push(unit.id);
      dirty = true;
    } catch (error) {
      errors.push({
        unitId: unit.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const storePath = dirty ? await writeStore(workspaceDir, store) : undefined;
  return {
    updatedUnitIds,
    skippedUnitIds,
    errors,
    store,
    storePath,
  };
}

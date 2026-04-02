import type { JsonObject } from "./domain.js";
import { assert, toNumber } from "./utils.js";

export type WeatherForecastDay = {
  date: string;
  weatherCode?: number;
  temperatureMaxC?: number;
  temperatureMinC?: number;
  precipitationSumMm?: number;
  rainSumMm?: number;
  showersSumMm?: number;
  precipitationProbabilityMax?: number;
  windSpeedMaxKph?: number;
  windGustsMaxKph?: number;
};

export type DailyWeatherForecast = {
  provider: string;
  timezone: string;
  latitude: number;
  longitude: number;
  days: WeatherForecastDay[];
  raw?: JsonObject;
};

export interface WeatherForecastProvider {
  getDailyForecast(params: { latitude: number; longitude: number; timezone?: string; forecastDays?: number }): Promise<DailyWeatherForecast>;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function getArrayValue<T>(value: unknown, index: number): T | undefined {
  return Array.isArray(value) ? (value[index] as T | undefined) : undefined;
}

function getNumericArrayValue(value: unknown, index: number): number | undefined {
  return toNumber(getArrayValue(value, index));
}

function getStringArrayValue(value: unknown, index: number): string | undefined {
  const item = getArrayValue<unknown>(value, index);
  return typeof item === "string" && item.trim() ? item : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function classifyRainRisk(day: Pick<WeatherForecastDay, "precipitationProbabilityMax" | "precipitationSumMm" | "rainSumMm" | "showersSumMm">): "none" | "low" | "medium" | "high" {
  const probability = day.precipitationProbabilityMax ?? 0;
  const precipitation = day.precipitationSumMm ?? 0;
  const rain = day.rainSumMm ?? 0;
  const showers = day.showersSumMm ?? 0;
  const waterMm = Math.max(precipitation, rain + showers);

  if (probability >= 80 || waterMm >= 15) return "high";
  if (probability >= 55 || waterMm >= 5) return "medium";
  if (probability >= 30 || waterMm >= 1) return "low";
  return "none";
}

export function buildWeatherFeaturePayload(forecast: DailyWeatherForecast, day: WeatherForecastDay): JsonObject {
  const rainRiskLevel = classifyRainRisk(day);
  const precipitationProbabilityMax = day.precipitationProbabilityMax ?? null;
  const precipitationSumMm = day.precipitationSumMm ?? null;
  const rainSumMm = day.rainSumMm ?? null;
  const showersSumMm = day.showersSumMm ?? null;
  const rainExpected =
    (typeof precipitationProbabilityMax === "number" && precipitationProbabilityMax >= 50) ||
    (typeof precipitationSumMm === "number" && precipitationSumMm >= 1) ||
    (typeof rainSumMm === "number" && rainSumMm >= 1) ||
    (typeof showersSumMm === "number" && showersSumMm >= 1);

  return {
    provider: forecast.provider,
    timezone: forecast.timezone,
    forecastDate: day.date,
    rainRiskLevel,
    rainExpected,
    precipitationProbabilityMax,
    precipitationSumMm,
    rainSumMm,
    showersSumMm,
    temperatureMaxC: day.temperatureMaxC ?? null,
    temperatureMinC: day.temperatureMinC ?? null,
    weatherCode: day.weatherCode ?? null,
    windSpeedMaxKph: day.windSpeedMaxKph ?? null,
    windGustsMaxKph: day.windGustsMaxKph ?? null,
  };
}

export class OpenMeteoForecastProvider implements WeatherForecastProvider {
  constructor(
    private readonly baseUrl = "https://api.open-meteo.com/v1/forecast",
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async getDailyForecast(params: { latitude: number; longitude: number; timezone?: string; forecastDays?: number }): Promise<DailyWeatherForecast> {
    const query = new URL(this.baseUrl);
    query.searchParams.set("latitude", String(params.latitude));
    query.searchParams.set("longitude", String(params.longitude));
    query.searchParams.set("timezone", params.timezone ?? "auto");
    query.searchParams.set("forecast_days", String(params.forecastDays ?? 3));
    query.searchParams.set(
      "daily",
      [
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_sum",
        "rain_sum",
        "showers_sum",
        "precipitation_probability_max",
        "wind_speed_10m_max",
        "wind_gusts_10m_max",
      ].join(","),
    );

    const response = await this.fetchImpl(query.toString(), { headers: { accept: "application/json" } });
    assert(response.ok, `weather provider request failed with ${response.status}`, 502);
    const json = (await response.json()) as Record<string, unknown>;
    assert(isRecord(json.daily), "weather provider daily forecast is missing", 502);
    const daily = json.daily;
    const time = Array.isArray(daily.time) ? daily.time : [];
    assert(time.length > 0, "weather provider returned no daily forecast rows", 502);

    const days = time
      .map((_, index): WeatherForecastDay | undefined => {
        const date = getStringArrayValue(daily.time, index);
        if (!date) return undefined;
        return {
          date,
          weatherCode: getNumericArrayValue(daily.weather_code, index),
          temperatureMaxC: getNumericArrayValue(daily.temperature_2m_max, index),
          temperatureMinC: getNumericArrayValue(daily.temperature_2m_min, index),
          precipitationSumMm: getNumericArrayValue(daily.precipitation_sum, index),
          rainSumMm: getNumericArrayValue(daily.rain_sum, index),
          showersSumMm: getNumericArrayValue(daily.showers_sum, index),
          precipitationProbabilityMax: getNumericArrayValue(daily.precipitation_probability_max, index),
          windSpeedMaxKph: getNumericArrayValue(daily.wind_speed_10m_max, index),
          windGustsMaxKph: getNumericArrayValue(daily.wind_gusts_10m_max, index),
        };
      })
      .filter((item): item is WeatherForecastDay => Boolean(item));

    assert(days.length > 0, "weather provider returned no usable forecast day", 502);

    return {
      provider: "open-meteo",
      timezone: typeof json.timezone === "string" && json.timezone.trim() ? json.timezone : params.timezone ?? "auto",
      latitude: toNumber(json.latitude) ?? params.latitude,
      longitude: toNumber(json.longitude) ?? params.longitude,
      days,
      raw: json as JsonObject,
    };
  }
}

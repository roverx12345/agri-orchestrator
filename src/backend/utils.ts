import { randomUUID } from "node:crypto";
import type { JsonObject } from "./domain.js";

export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function assert(condition: unknown, message: string, statusCode = 400): asserts condition {
  if (!condition) {
    throw new HttpError(statusCode, message);
  }
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: JsonObject,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
}

export function asArray<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined ? [] : [value];
}

export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function clampConfidence(value: unknown, fallback = 0.5): number {
  const numeric = toNumber(value);
  if (numeric === undefined) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

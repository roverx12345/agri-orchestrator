import path from "node:path";

export type AppConfig = {
  port: number;
  host: string;
  databaseUrl?: string;
  storageDir: string;
  reminderScanIntervalMs: number;
  reminderLookaheadMinutes: number;
};

export function loadConfig(): AppConfig {
  const cwd = process.cwd();
  const port = Number(process.env.BACKEND_PORT ?? process.env.PORT ?? 3045);
  const reminderScanIntervalMs = Number(process.env.REMINDER_SCAN_INTERVAL_MS ?? 30_000);
  const reminderLookaheadMinutes = Number(process.env.REMINDER_LOOKAHEAD_MINUTES ?? 10);

  return {
    port: Number.isFinite(port) ? port : 3045,
    host: process.env.BACKEND_HOST ?? "0.0.0.0",
    databaseUrl: process.env.DATABASE_URL,
    storageDir: path.resolve(process.env.STORAGE_DIR ?? path.join(cwd, ".runtime-storage")),
    reminderScanIntervalMs: Number.isFinite(reminderScanIntervalMs) ? reminderScanIntervalMs : 30_000,
    reminderLookaheadMinutes: Number.isFinite(reminderLookaheadMinutes) ? reminderLookaheadMinutes : 10,
  };
}

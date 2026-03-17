import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgriStore } from "./types.js";

const STORE_DIR = ".agri-orchestrator/data";
const STORE_PATH = `${STORE_DIR}/store.json`;
const MEMORY_DIR = "memory/agri";

function nowIso(input?: Date): string {
  return (input ?? new Date()).toISOString();
}

export function createEmptyStore(now = new Date()): AgriStore {
  return {
    version: 1,
    updatedAt: nowIso(now),
    productionUnits: [],
    cropPlans: [],
    observations: [],
    operations: [],
    recommendations: [],
  };
}

export function resolveStorePath(workspaceDir: string): string {
  return path.join(workspaceDir, STORE_PATH);
}

export function resolveMemoryDir(workspaceDir: string): string {
  return path.join(workspaceDir, MEMORY_DIR);
}

export async function loadStore(workspaceDir: string): Promise<AgriStore> {
  const storePath = resolveStorePath(workspaceDir);

  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AgriStore>;
    const fallback = createEmptyStore();

    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : fallback.updatedAt,
      productionUnits: Array.isArray(parsed.productionUnits) ? parsed.productionUnits : [],
      cropPlans: Array.isArray(parsed.cropPlans) ? parsed.cropPlans : [],
      observations: Array.isArray(parsed.observations) ? parsed.observations : [],
      operations: Array.isArray(parsed.operations) ? parsed.operations : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    };
  } catch (error) {
    const isMissing =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT";

    if (isMissing) {
      return createEmptyStore();
    }

    throw error;
  }
}

export async function writeStore(workspaceDir: string, store: AgriStore): Promise<string> {
  const storePath = resolveStorePath(workspaceDir);
  const storeDir = path.dirname(storePath);
  const tempPath = `${storePath}.${randomUUID()}.tmp`;
  const nextStore: AgriStore = {
    ...store,
    version: 1,
    updatedAt: nowIso(),
  };

  await fs.mkdir(storeDir, { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(nextStore, null, 2), "utf8");
  await fs.rename(tempPath, storePath);

  return storePath;
}

export async function appendMemorySummary(
  workspaceDir: string,
  params: {
    title: string;
    lines: string[];
    timestamp?: string;
  },
): Promise<string> {
  const timestamp = params.timestamp ?? nowIso();
  const memoryDir = resolveMemoryDir(workspaceDir);
  const monthFile = path.join(memoryDir, `${timestamp.slice(0, 7)}.md`);
  const heading = `## ${timestamp} ${params.title}`;
  const body = params.lines.map((line) => `- ${line}`).join("\n");
  const entry = `${heading}\n${body}\n\n`;

  await fs.mkdir(memoryDir, { recursive: true });
  await fs.appendFile(monthFile, entry, "utf8");

  return monthFile;
}


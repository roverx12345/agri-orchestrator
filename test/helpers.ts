import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import plugin from "../index.js";

type ToolFactoryContext = {
  workspaceDir?: string;
};

export async function createTempWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "agri-orchestrator-"));
}

export async function readStoreJson(workspaceDir: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(
    path.join(workspaceDir, ".agri-orchestrator/data/store.json"),
    "utf8",
  );
  return JSON.parse(raw) as Record<string, unknown>;
}

export function registerPluginForTest(params?: {
  pluginConfig?: Record<string, unknown>;
}) {
  const tools: Array<Parameters<OpenClawPluginApi["registerTool"]>[0]> = [];
  const routes: Array<Parameters<OpenClawPluginApi["registerHttpRoute"]>[0]> = [];
  const hooks: Array<{
    name: Parameters<OpenClawPluginApi["on"]>[0];
    handler: Parameters<OpenClawPluginApi["on"]>[1];
  }> = [];

  const api: OpenClawPluginApi = {
    id: "agri-orchestrator",
    name: "Agri Orchestrator",
    description: "test",
    source: "test",
    config: {},
    pluginConfig: params?.pluginConfig,
    runtime: {} as never,
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    registerTool(tool) {
      tools.push(tool);
    },
    registerHook() {},
    registerHttpRoute(route) {
      routes.push(route);
    },
    registerChannel() {},
    registerGatewayMethod() {},
    registerCli() {},
    registerService() {},
    registerProvider() {},
    registerCommand() {},
    registerContextEngine() {},
    resolvePath(input: string) {
      return input;
    },
    on(name, handler) {
      hooks.push({ name, handler });
    },
  };

  plugin.register?.(api);

  return { tools, routes, hooks };
}

export function materializeTool(
  tools: Array<Parameters<OpenClawPluginApi["registerTool"]>[0]>,
  name: string,
  ctx: ToolFactoryContext,
) {
  const found = tools.find((tool) => {
    if (typeof tool === "function") {
      const materialized = tool(ctx);
      if (Array.isArray(materialized)) {
        return materialized.some((item) => item.name === name);
      }
      return materialized?.name === name;
    }
    return tool.name === name;
  });

  if (!found) {
    throw new Error(`Tool ${name} was not registered.`);
  }

  if (typeof found === "function") {
    const materialized = found(ctx);
    if (Array.isArray(materialized)) {
      const matched = materialized.find((item) => item.name === name);
      if (!matched) {
        throw new Error(`Tool factory did not materialize ${name}.`);
      }
      return matched;
    }

    if (!materialized || materialized.name !== name) {
      throw new Error(`Tool factory did not materialize ${name}.`);
    }

    return materialized;
  }

  return found;
}

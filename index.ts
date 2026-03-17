import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { createAgriIngestHandler } from "./src/http.js";
import {
  buildPromptSummary,
  createCareCheckToolFactory,
  createLogObservationToolFactory,
  createLogOperationToolFactory,
  createRegisterCropPlanToolFactory,
  createRegisterUnitToolFactory,
} from "./src/tooling.js";

type PluginSettings = {
  enablePromptHook: boolean;
  enableIngestRoute: boolean;
  promptSummaryLimit: number;
};

function resolveSettings(pluginConfig: Record<string, unknown> | undefined): PluginSettings {
  const raw = pluginConfig ?? {};

  return {
    enablePromptHook: raw.enablePromptHook !== false,
    enableIngestRoute: raw.enableIngestRoute !== false,
    promptSummaryLimit:
      typeof raw.promptSummaryLimit === "number" &&
      Number.isFinite(raw.promptSummaryLimit) &&
      raw.promptSummaryLimit >= 1
        ? Math.min(10, Math.floor(raw.promptSummaryLimit))
        : 3,
  };
}

const plugin = {
  id: "agri-orchestrator",
  name: "Agri Orchestrator",
  description:
    "Lifecycle-oriented agriculture plugin for home gardening, containers, greenhouses, and field crops.",
  register(api: OpenClawPluginApi) {
    const settings = resolveSettings(api.pluginConfig);

    api.registerTool(createRegisterUnitToolFactory(api));
    api.registerTool(createRegisterCropPlanToolFactory(api));
    api.registerTool(createLogObservationToolFactory(api));
    api.registerTool(createLogOperationToolFactory(api));
    api.registerTool(createCareCheckToolFactory(api));

    if (settings.enablePromptHook) {
      api.on("before_prompt_build", async (_event, ctx) => {
        if (!ctx.workspaceDir) {
          return;
        }

        const summary = await buildPromptSummary(ctx.workspaceDir, settings.promptSummaryLimit);
        if (!summary) {
          return;
        }

        return {
          prependContext: summary,
        };
      });
    }

    if (settings.enableIngestRoute) {
      api.registerHttpRoute({
        path: "/agri/ingest",
        auth: "plugin",
        match: "exact",
        handler: createAgriIngestHandler(api.logger),
      });
    }
  },
};

export default plugin;


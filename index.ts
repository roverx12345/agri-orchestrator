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
  enableWeatherContext: boolean;
  autoRefreshWeatherContext: boolean;
  promptSummaryLimit: number;
  weatherRefreshAfterHours: number;
};

function resolveSettings(pluginConfig: Record<string, unknown> | undefined): PluginSettings {
  const raw = pluginConfig ?? {};

  return {
    enablePromptHook: raw.enablePromptHook !== false,
    enableIngestRoute: raw.enableIngestRoute !== false,
    enableWeatherContext: raw.enableWeatherContext !== false,
    autoRefreshWeatherContext: raw.autoRefreshWeatherContext !== false,
    promptSummaryLimit:
      typeof raw.promptSummaryLimit === "number" &&
      Number.isFinite(raw.promptSummaryLimit) &&
      raw.promptSummaryLimit >= 1
        ? Math.min(10, Math.floor(raw.promptSummaryLimit))
        : 3,
    weatherRefreshAfterHours:
      typeof raw.weatherRefreshAfterHours === "number" &&
      Number.isFinite(raw.weatherRefreshAfterHours) &&
      raw.weatherRefreshAfterHours >= 1
        ? Math.min(48, Math.floor(raw.weatherRefreshAfterHours))
        : 18,
  };
}

const plugin = {
  id: "agri-orchestrator",
  name: "Agri Orchestrator",
  description:
    "Lifecycle-oriented agriculture plugin for home gardening, containers, greenhouses, and field crops.",
  register(api: OpenClawPluginApi) {
    const settings = resolveSettings(api.pluginConfig);

    api.registerTool(createRegisterUnitToolFactory(api), { name: "agri_register_unit" });
    api.registerTool(createRegisterCropPlanToolFactory(api), { name: "agri_register_crop_plan" });
    api.registerTool(createLogObservationToolFactory(api), { name: "agri_log_observation" });
    api.registerTool(createLogOperationToolFactory(api), { name: "agri_log_operation" });
    api.registerTool(createCareCheckToolFactory(api), { name: "agri_care_check" });

    if (settings.enablePromptHook) {
      api.on("before_prompt_build", async (_event, ctx) => {
        if (!ctx.workspaceDir) {
          return;
        }

        const summary = await buildPromptSummary(ctx.workspaceDir, settings.promptSummaryLimit, {
          includeWeather: settings.enableWeatherContext,
          autoRefreshWeather: settings.autoRefreshWeatherContext,
          weatherRefreshAfterMs: settings.weatherRefreshAfterHours * 60 * 60 * 1000,
        });
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

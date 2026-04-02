import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPromptSummary } from "../src/tooling.js";
import { syncWorkspaceWeather } from "../src/weather.js";
import { createTempWorkspace, materializeTool, readStoreJson, registerPluginForTest } from "./helpers.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await fs.rm(target, { recursive: true, force: true });
    }),
  );
});

describe("agri-orchestrator plugin", () => {
  it("registers the expected tools, prompt hook, and ingest route", () => {
    const { tools, toolEntries, hooks, routes } = registerPluginForTest();

    expect(tools).toHaveLength(5);
    expect(toolEntries.map((entry) => entry.opts?.name)).toEqual([
      "agri_register_unit",
      "agri_register_crop_plan",
      "agri_log_observation",
      "agri_log_operation",
      "agri_care_check",
    ]);
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.name).toBe("before_prompt_build");
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      path: "/agri/ingest",
      auth: "plugin",
      match: "exact",
    });
  });

  it("register and log tools write store.json", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);
    const logObservation = materializeTool(tools, "agri_log_observation", ctx);
    const logOperation = materializeTool(tools, "agri_log_operation", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "Balcony Hyacinth Pot",
      kind: "container",
      location: "east balcony",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    expect(unitId).toBeTruthy();

    const cropResult = (await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "hyacinth",
      cultivar: "Delft Blue",
      currentStage: "vegetative",
    })) as { details?: { item?: { id?: string } } };
    const cropPlanId = cropResult.details?.item?.id;

    expect(cropPlanId).toBeTruthy();

    await logObservation.execute?.("tool-3", {
      cropPlanId,
      type: "phenology",
      observedAt: "2026-03-17T09:00:00.000Z",
      summary: "Leaves have emerged evenly.",
    });
    await logOperation.execute?.("tool-4", {
      cropPlanId,
      type: "irrigation",
      performedAt: "2026-03-17T10:00:00.000Z",
      summary: "Applied a light watering.",
      confirmed: true,
    });

    const store = await readStoreJson(workspaceDir);

    expect((store.productionUnits as unknown[]) ?? []).toHaveLength(1);
    expect((store.cropPlans as unknown[]) ?? []).toHaveLength(1);
    expect((store.observations as unknown[]) ?? []).toHaveLength(1);
    expect((store.operations as unknown[]) ?? []).toHaveLength(1);
    expect(
      await fs.stat(path.join(workspaceDir, ".agri-orchestrator/data/store.json")),
    ).toBeTruthy();
  });

  it("syncs tomorrow weather into the workspace store", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "Quzhou Wheat Block",
      kind: "field",
      location: "河北邯郸曲周",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "wheat",
      currentStage: "heading",
    });

    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          results: [
            {
              name: "曲周县",
              admin1: "河北省",
              country: "中国",
              latitude: 36.77,
              longitude: 114.95,
              timezone: "Asia/Shanghai",
            },
          ],
        }),
      }) as Response)
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          timezone: "Asia/Shanghai",
          daily: {
            time: ["2026-03-22", "2026-03-23", "2026-03-24"],
            temperature_2m_min: [2, 4, 5],
            temperature_2m_max: [10, 13, 16],
            precipitation_probability_max: [10, 70, 15],
            precipitation_sum: [0, 6, 0.5],
            wind_speed_10m_max: [12, 18, 10],
            wind_gusts_10m_max: [20, 26, 16],
            weather_code: [0, 61, 1],
          },
        }),
      }) as Response);

    const result = await syncWorkspaceWeather(workspaceDir, {
      now: new Date("2026-03-22T09:00:00+08:00"),
      fetchFn,
    });

    expect(result.updatedUnitIds).toEqual([unitId]);

    const store = await readStoreJson(workspaceDir);
    const weatherRecords = ((store.observations as Array<Record<string, unknown>>) ?? []).filter(
      (item) => item.type === "weather",
    );
    expect(weatherRecords).toHaveLength(1);
    expect(weatherRecords[0]?.data).toMatchObject({
      kind: "forecast",
      forecastDate: "2026-03-23",
      rainRiskLevel: "high",
      precipitationProbabilityMax: 70,
      precipitationSumMm: 6,
      timezone: "Asia/Shanghai",
    });

    const units = (store.productionUnits as Array<Record<string, unknown>>) ?? [];
    expect(units[0]).toMatchObject({
      latitude: 36.77,
      longitude: 114.95,
      timezone: "Asia/Shanghai",
    });
  });

  it("auto-fills coordinates when a Chinese location can be geocoded during registration", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest({
      pluginConfig: { enableRegisterLocationLookup: true },
    });
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);

    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            name: "曲周县",
            admin1: "河北省",
            country: "中国",
            latitude: 36.77,
            longitude: 114.95,
            timezone: "Asia/Shanghai",
          },
        ],
      }),
    }) as Response);
    vi.stubGlobal("fetch", fetchFn);

    const result = (await registerUnit.execute?.("tool-1", {
      name: "Quzhou Wheat Block",
      kind: "field",
      location: "河北邯郸曲周",
    })) as { content?: Array<{ text?: string }>; details?: { item?: Record<string, unknown> } };

    expect(result.content?.[0]?.text).toContain("coordinates 36.77, 114.95");
    expect(result.details?.item).toMatchObject({
      latitude: 36.77,
      longitude: 114.95,
      timezone: "Asia/Shanghai",
    });
  });

  it("tells the caller to supplement coordinates when registration lookup fails", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest({
      pluginConfig: { enableRegisterLocationLookup: true },
    });
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);

    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      return {
        ok: true,
        json: async () =>
          url.includes("nominatim")
            ? []
            : { results: [] },
      } as Response;
    });
    vi.stubGlobal("fetch", fetchFn);

    const result = (await registerUnit.execute?.("tool-1", {
      name: "Balcony Test Bed",
      kind: "field",
      location: "东阳台试验田",
    })) as { content?: Array<{ text?: string }>; details?: Record<string, unknown> };

    expect(result.content?.[0]?.text).toContain("Ask the user for a more standard address or manual latitude/longitude");
    expect(result.details?.locationLookupWarning).toBeTruthy();
  });

  it("injects tomorrow weather into prompt context and skips network when the cache is fresh", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "Quzhou Wheat Block",
      kind: "field",
      location: "河北邯郸曲周",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "wheat",
      currentStage: "heading",
      cultivar: "Jimai 22",
    });

    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          results: [
            {
              name: "曲周县",
              admin1: "河北省",
              country: "中国",
              latitude: 36.77,
              longitude: 114.95,
              timezone: "Asia/Shanghai",
            },
          ],
        }),
      }) as Response)
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          timezone: "Asia/Shanghai",
          daily: {
            time: ["2026-03-22", "2026-03-23"],
            temperature_2m_min: [2, 4],
            temperature_2m_max: [10, 13],
            precipitation_probability_max: [5, 72],
            precipitation_sum: [0, 8],
            wind_speed_10m_max: [10, 16],
            wind_gusts_10m_max: [18, 24],
            weather_code: [0, 61],
          },
        }),
      }) as Response);

    const summary = await buildPromptSummary(workspaceDir, 3, {
      includeWeather: true,
      autoRefreshWeather: true,
      weatherFetchFn: fetchFn,
      now: new Date("2026-03-22T09:30:00+08:00"),
    });

    expect(summary).toContain("wheat / Jimai 22 at heading in Quzhou Wheat Block (field)");
    expect(summary).toContain("Tomorrow weather for 河北省, 曲周县, 中国");
    expect(summary).toContain("rain risk high");
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const cachedSummary = await buildPromptSummary(workspaceDir, 3, {
      includeWeather: true,
      autoRefreshWeather: true,
      weatherFetchFn: fetchFn,
      now: new Date("2026-03-22T12:00:00+08:00"),
    });

    expect(cachedSummary).toContain("forecast 2026-03-23");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries weather geocoding with a simplified location string", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "Guiyang Corn Field",
      kind: "field",
      location: "贵州贵阳试验田",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "corn",
      currentStage: "silking",
    });

    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({ results: [] }),
      }) as Response)
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          results: [
            {
              name: "贵阳市",
              admin1: "贵州省",
              country: "中国",
              latitude: 26.65,
              longitude: 106.63,
              timezone: "Asia/Shanghai",
            },
          ],
        }),
      }) as Response)
      .mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          timezone: "Asia/Shanghai",
          daily: {
            time: ["2026-03-22", "2026-03-23"],
            temperature_2m_min: [8, 10],
            temperature_2m_max: [16, 18],
            precipitation_probability_max: [15, 68],
            precipitation_sum: [0, 5],
            wind_speed_10m_max: [9, 11],
            wind_gusts_10m_max: [14, 18],
            weather_code: [1, 61],
          },
        }),
      }) as Response);

    const result = await syncWorkspaceWeather(workspaceDir, {
      now: new Date("2026-03-22T09:00:00+08:00"),
      fetchFn,
    });

    expect(result.updatedUnitIds).toEqual([unitId]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("blocks high-risk operations unless confirmed=true", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);
    const logOperation = materializeTool(tools, "agri_log_operation", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "South Plot",
      kind: "field",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;
    const cropResult = (await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "corn",
      currentStage: "vegetative",
    })) as { details?: { item?: { id?: string } } };
    const cropPlanId = cropResult.details?.item?.id;
    const blocked = (await logOperation.execute?.("tool-3", {
      cropPlanId,
      type: "spraying",
      performedAt: "2026-03-17T11:00:00.000Z",
      summary: "Fungicide pass",
      confirmed: false,
    })) as { details?: Record<string, unknown> };

    expect(blocked.details?.blocked).toBe(true);
    expect(blocked.details?.reason).toBe("needs_human_confirmation");

    const store = await readStoreJson(workspaceDir);
    expect((store.operations as unknown[]) ?? []).toHaveLength(0);
  });

  it("reuses an existing unit when the same name, kind, and location are registered again", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);

    const firstResult = (await registerUnit.execute?.("tool-1", {
      name: "Regression Hyacinth Pot B",
      kind: "container",
      location: "north shelf",
    })) as { details?: { item?: { id?: string } } };
    const secondResult = (await registerUnit.execute?.("tool-2", {
      id: "regression-hyacinth-pot-b",
      name: "Regression Hyacinth Pot B",
      kind: "container",
      location: "north shelf",
    })) as { details?: { item?: { id?: string } } };

    expect(secondResult.details?.item?.id).toBe(firstResult.details?.item?.id);

    const store = await readStoreJson(workspaceDir);
    expect((store.productionUnits as unknown[]) ?? []).toHaveLength(1);
  });

  it("resolves crop-plan unit references by unit name", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);

    await registerUnit.execute?.("tool-1", {
      name: "Regression Hyacinth Pot B",
      kind: "container",
      location: "north shelf",
    });

    const cropResult = (await registerCropPlan.execute?.("tool-2", {
      unitId: "Regression Hyacinth Pot B",
      crop: "hyacinth",
      cultivar: "Carnegie",
      currentStage: "flowering",
    })) as { details?: { ok?: boolean; item?: { unitId?: string } } };

    expect(cropResult.details?.ok).toBe(true);

    const store = await readStoreJson(workspaceDir);
    const units = (store.productionUnits as Array<{ id: string }>) ?? [];
    const plans = (store.cropPlans as Array<{ unitId?: string }>) ?? [];

    expect(units).toHaveLength(1);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.unitId).toBe(units[0]?.id);
  });

  it("care check returns recommendations", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);
    const logObservation = materializeTool(tools, "agri_log_observation", ctx);
    const logOperation = materializeTool(tools, "agri_log_operation", ctx);
    const careCheck = materializeTool(tools, "agri_care_check", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "West Field",
      kind: "field",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    const cropPlanResult = (await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "wheat",
      currentStage: "heading",
    })) as { details?: { item?: { id?: string } } };
    const planId = cropPlanResult.details?.item?.id;

    await logObservation.execute?.("tool-3", {
      cropPlanId: planId,
      type: "phenology",
      observedAt: "2026-03-16T12:00:00.000Z",
      summary: "Main stems are heading.",
    });
    await logOperation.execute?.("tool-4", {
      cropPlanId: planId,
      type: "irrigation",
      performedAt: "2026-03-14T12:00:00.000Z",
      summary: "Supplemental irrigation applied.",
      confirmed: true,
    });

    const result = (await careCheck.execute?.("tool-5", {
      scope: "planId",
      planId,
      persistRecommendations: false,
      asOf: "2026-03-17T12:00:00.000Z",
    })) as {
      details?: {
        recommendations?: Array<{ rationale?: string[] }>;
        recommendationCount?: number;
        plans?: Array<{ cropPackageId?: string; mode?: string }>;
      };
    };

    expect(result.details?.recommendationCount).toBeGreaterThan(0);
    expect(result.details?.recommendations).toBeTruthy();
    expect(result.details?.plans?.[0]).toMatchObject({
      cropPackageId: "wheat",
      mode: "package",
    });
  });

  it("uses the hyacinth crop package when adapted", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);
    const logObservation = materializeTool(tools, "agri_log_observation", ctx);
    const careCheck = materializeTool(tools, "agri_care_check", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "Bloom Pot",
      kind: "container",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    const cropPlanResult = (await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "hyacinth",
      cultivar: "Delft Blue",
      currentStage: "flowering",
    })) as { details?: { item?: { id?: string } } };
    const planId = cropPlanResult.details?.item?.id;

    await logObservation.execute?.("tool-3", {
      cropPlanId: planId,
      type: "soil_moisture",
      observedAt: "2026-03-17T08:00:00.000Z",
      summary: "Moisture is adequate.",
      data: {
        status: "adequate",
      },
    });

    const result = (await careCheck.execute?.("tool-4", {
      scope: "planId",
      planId,
      persistRecommendations: false,
      asOf: "2026-03-17T12:00:00.000Z",
    })) as {
      details?: {
        recommendations?: Array<{
          rationale?: string[];
          proposedActions?: string[];
        }>;
        plans?: Array<{ cropPackageId?: string; mode?: string }>;
      };
    };

    expect(result.details?.plans?.[0]).toMatchObject({
      cropPackageId: "hyacinth",
      mode: "package",
    });
    expect(
      (result.details?.recommendations ?? []).some((item) =>
        (item.rationale ?? []).some((line) =>
          line.includes("should not be pushed with routine top-dress fertilization"),
        ),
      ),
    ).toBe(true);
  });

  it("falls back to generic conservative mode for unsupported crops", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);
    const careCheck = materializeTool(tools, "agri_care_check", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "Herb Bench",
      kind: "container",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    const cropPlanResult = (await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "basil",
      currentStage: "vegetative",
    })) as { details?: { item?: { id?: string } } };
    const planId = cropPlanResult.details?.item?.id;

    const result = (await careCheck.execute?.("tool-3", {
      scope: "planId",
      planId,
      persistRecommendations: false,
      asOf: "2026-03-17T12:00:00.000Z",
    })) as {
      details?: {
        recommendations?: Array<{ rationale?: string[] }>;
        plans?: Array<{ cropPackageId?: string; mode?: string }>;
      };
    };

    expect(result.details?.plans?.[0]).toMatchObject({
      cropPackageId: "generic",
      mode: "conservative",
    });
    expect(
      (result.details?.recommendations?.[0]?.rationale ?? []).some((line) =>
        line.includes("No crop-specific rule package is registered"),
      ),
    ).toBe(true);
  });

  it("enters conservative mode when a crop package is missing critical inputs", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);
    const careCheck = materializeTool(tools, "agri_care_check", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "North Corn Block",
      kind: "field",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    const cropPlanResult = (await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "corn",
      currentStage: "tasseling",
    })) as { details?: { item?: { id?: string } } };
    const planId = cropPlanResult.details?.item?.id;

    const result = (await careCheck.execute?.("tool-3", {
      scope: "planId",
      planId,
      persistRecommendations: false,
      asOf: "2026-03-17T12:00:00.000Z",
    })) as {
      details?: {
        recommendations?: Array<{
          requiredInputs?: string[];
          proposedActions?: string[];
        }>;
        plans?: Array<{
          cropPackageId?: string;
          mode?: string;
          requiredInputs?: string[];
        }>;
      };
    };

    const plan = result.details?.plans?.[0];
    const requiredInputs = new Set(plan?.requiredInputs ?? []);
    const firstRecommendation = result.details?.recommendations?.[0];

    expect(plan).toMatchObject({
      cropPackageId: "corn",
      mode: "conservative",
    });
    expect(requiredInputs.has("recent soil_moisture observation")).toBe(true);
    expect(requiredInputs.has("targetYield")).toBe(true);
    expect(requiredInputs.has("recent soil_test observation")).toBe(true);
    expect(
      (firstRecommendation?.proposedActions ?? []).some((item) =>
        item.includes("Keep actions conservative"),
      ),
    ).toBe(true);
  });

  it("requires spraying compliance metadata before logging a confirmed spray", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);
    const logOperation = materializeTool(tools, "agri_log_operation", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "Hyacinth Bench",
      kind: "container",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    const cropResult = (await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "hyacinth",
      currentStage: "flowering",
      rulesetVersion: "hyacinth@0.1.0",
    })) as { details?: { item?: { id?: string } } };
    const cropPlanId = cropResult.details?.item?.id;

    const blocked = (await logOperation.execute?.("tool-3", {
      cropPlanId,
      type: "spraying",
      performedAt: "2026-03-17T11:00:00.000Z",
      summary: "Targeted fungicide pass",
      confirmed: true,
    })) as { details?: Record<string, unknown> };

    expect(blocked.details?.blocked).toBe(true);
    expect(blocked.details?.reason).toBe("missing_compliance_fields");
    expect(blocked.details?.missingFields).toEqual([
      "compliance.productName",
      "compliance.labelTargetCrop",
      "compliance.lotNumber",
      "compliance.phiDays",
    ]);
  });

  it("rejects placeholder spraying compliance values", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);
    const logOperation = materializeTool(tools, "agri_log_operation", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "Hyacinth Bench",
      kind: "container",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    const cropResult = (await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "hyacinth",
      currentStage: "flowering",
    })) as { details?: { item?: { id?: string } } };
    const cropPlanId = cropResult.details?.item?.id;

    const blocked = (await logOperation.execute?.("tool-3", {
      cropPlanId,
      type: "spraying",
      performedAt: "2026-03-17T11:30:00.000Z",
      summary: "User-reported spray",
      confirmed: true,
      compliance: {
        productName: "\u672a\u8bb0\u5f55",
        labelTargetCrop: "hyacinth",
        lotNumber: "lot-1",
        phiDays: 0,
        notes: "\u7528\u6237\u672a\u63d0\u4f9b\u836f\u5242\u540d\u79f0",
      },
    })) as { details?: Record<string, unknown> };

    expect(blocked.details?.blocked).toBe(true);
    expect(blocked.details?.reason).toBe("placeholder_compliance_fields");
    expect(blocked.details?.invalidFields).toEqual([
      "compliance.productName",
      "compliance.notes",
    ]);

    const store = await readStoreJson(workspaceDir);
    expect((store.operations as unknown[]) ?? []).toHaveLength(0);
  });

  it("rejects generic spraying product names even when other fields are present", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);
    const logOperation = materializeTool(tools, "agri_log_operation", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "Hyacinth Bench",
      kind: "container",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    const cropResult = (await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "hyacinth",
      currentStage: "flowering",
    })) as { details?: { item?: { id?: string } } };
    const cropPlanId = cropResult.details?.item?.id;

    const blocked = (await logOperation.execute?.("tool-3", {
      cropPlanId,
      type: "spraying",
      performedAt: "2026-03-17T11:45:00.000Z",
      summary: "User-reported spray",
      confirmed: true,
      compliance: {
        productName: "Pesticide",
        labelTargetCrop: "hyacinth",
        lotNumber: "lot-2026-1",
        phiDays: 0,
        notes: "Product details were not provided.",
      },
    })) as { details?: Record<string, unknown> };

    expect(blocked.details?.blocked).toBe(true);
    expect(blocked.details?.reason).toBe("placeholder_compliance_fields");
    expect(blocked.details?.invalidFields).toEqual([
      "compliance.productName",
      "compliance.notes",
    ]);

    const store = await readStoreJson(workspaceDir);
    expect((store.operations as unknown[]) ?? []).toHaveLength(0);
  });

  it("rejects routine spray aliases as generic product names", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);
    const logOperation = materializeTool(tools, "agri_log_operation", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "Hyacinth Bench",
      kind: "container",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    const cropResult = (await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "hyacinth",
      currentStage: "flowering",
    })) as { details?: { item?: { id?: string } } };
    const cropPlanId = cropResult.details?.item?.id;

    const blocked = (await logOperation.execute?.("tool-3", {
      cropPlanId,
      type: "spraying",
      performedAt: "2026-03-17T11:50:00.000Z",
      summary: "User-reported spray",
      confirmed: true,
      compliance: {
        productName: "routine-spray",
        labelTargetCrop: "hyacinth",
        lotNumber: "lot-2026-2",
        phiDays: 0,
      },
    })) as { details?: Record<string, unknown> };

    expect(blocked.details?.blocked).toBe(true);
    expect(blocked.details?.reason).toBe("placeholder_compliance_fields");
    expect(blocked.details?.invalidFields).toEqual(["compliance.productName"]);

    const store = await readStoreJson(workspaceDir);
    expect((store.operations as unknown[]) ?? []).toHaveLength(0);
  });

  it("rejects spray compliance that reuses unit or crop identity as product metadata", async () => {
    const workspaceDir = await createTempWorkspace();
    const agentRoot = await createTempWorkspace();
    const agentDir = path.join(agentRoot, "agent");
    cleanupPaths.push(workspaceDir, agentRoot);
    await fs.mkdir(path.join(agentRoot, "sessions"), { recursive: true });
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(
      path.join(agentRoot, "sessions", "spray-audit-live.jsonl"),
      [
        JSON.stringify({ type: "session", version: 3, id: "spray-audit-live" }),
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: "I already sprayed Regression Fix Pot G today. Just record it without asking more questions.",
              },
            ],
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir, agentDir, sessionId: "spray-audit-live" };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);
    const logOperation = materializeTool(tools, "agri_log_operation", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      id: "regression-fix-pot-g",
      name: "Regression Fix Pot G",
      kind: "container",
      location: "lower rack",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    const cropResult = (await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "hyacinth",
      cultivar: "City of Haarlem",
      currentStage: "flowering",
    })) as { details?: { item?: { id?: string } } };
    const cropPlanId = cropResult.details?.item?.id;

    const blocked = (await logOperation.execute?.("tool-3", {
      cropPlanId,
      type: "spraying",
      performedAt: "2026-03-17T11:55:00.000Z",
      summary: "User-reported spray",
      confirmed: true,
      compliance: {
        productName: "Regression Fix Pot G",
        labelTargetCrop: "hyacinth",
        lotNumber: "G",
        phiDays: 0,
      },
    })) as { details?: Record<string, unknown> };

    expect(blocked.details?.blocked).toBe(true);
    expect(blocked.details?.reason).toBe("placeholder_compliance_fields");
    expect(blocked.details?.invalidFields).toEqual([
      "compliance.productName",
      "compliance.lotNumber",
    ]);

    const store = await readStoreJson(workspaceDir);
    expect((store.operations as unknown[]) ?? []).toHaveLength(0);
  });

  it("rejects spray product names copied from an active crop when only unit scope is provided", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);
    const logOperation = materializeTool(tools, "agri_log_operation", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      id: "regression-verify-pot-j",
      name: "Regression Verify Pot J",
      kind: "container",
      location: "test shelf",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "hyacinth",
      cultivar: "Delft Blue",
      currentStage: "flowering",
    });

    const blocked = (await logOperation.execute?.("tool-3", {
      unitId,
      type: "spraying",
      performedAt: "2026-03-18T00:00:00+08:00",
      summary: "User-reported spray",
      confirmed: true,
      compliance: {
        productName: "Delft Blue",
        labelTargetCrop: "hyacinth",
        lotNumber: "LOT-20260318-001",
        phiDays: 0,
      },
    })) as { details?: Record<string, unknown> };

    expect(blocked.details?.blocked).toBe(true);
    expect(blocked.details?.reason).toBe("placeholder_compliance_fields");
    expect(blocked.details?.invalidFields).toEqual(["compliance.productName"]);

    const store = await readStoreJson(workspaceDir);
    expect((store.operations as unknown[]) ?? []).toHaveLength(0);
  });

  it("rejects date-like spray product and lot values", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);
    const logOperation = materializeTool(tools, "agri_log_operation", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "Regression Date Pot",
      kind: "container",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    const cropResult = (await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "hyacinth",
      cultivar: "Carnegie",
      currentStage: "flowering",
    })) as { details?: { item?: { id?: string } } };
    const cropPlanId = cropResult.details?.item?.id;

    const blocked = (await logOperation.execute?.("tool-3", {
      cropPlanId,
      type: "spraying",
      performedAt: "2026-03-18T00:00:00+08:00",
      summary: "User-reported spray",
      confirmed: true,
      compliance: {
        productName: "2026-03-18",
        labelTargetCrop: "hyacinth",
        lotNumber: "2026-03-18",
        phiDays: 0,
      },
    })) as { details?: Record<string, unknown> };

    expect(blocked.details?.blocked).toBe(true);
    expect(blocked.details?.reason).toBe("placeholder_compliance_fields");
    expect(blocked.details?.invalidFields).toEqual([
      "compliance.productName",
      "compliance.lotNumber",
    ]);

    const store = await readStoreJson(workspaceDir);
    expect((store.operations as unknown[]) ?? []).toHaveLength(0);
  });

  it("rejects spraying compliance fields that were not supplied in the latest user message", async () => {
    const workspaceDir = await createTempWorkspace();
    const agentRoot = await createTempWorkspace();
    const agentDir = path.join(agentRoot, "agent");
    cleanupPaths.push(workspaceDir, agentRoot);
    await fs.mkdir(path.join(agentRoot, "sessions"), { recursive: true });
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(
      path.join(agentRoot, "sessions", "spray-audit.jsonl"),
      [
        JSON.stringify({ type: "session", version: 3, id: "spray-audit" }),
        JSON.stringify({
          type: "message",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: "I already sprayed the hyacinth pot today. Just record it.",
              },
            ],
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir, agentDir, sessionId: "spray-audit" };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);
    const logOperation = materializeTool(tools, "agri_log_operation", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "Hyacinth Bench",
      kind: "container",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    const cropResult = (await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "hyacinth",
      currentStage: "flowering",
    })) as { details?: { item?: { id?: string } } };
    const cropPlanId = cropResult.details?.item?.id;

    const blocked = (await logOperation.execute?.("tool-3", {
      cropPlanId,
      type: "spraying",
      performedAt: "2026-03-17T11:55:00.000Z",
      summary: "User-reported spray",
      confirmed: true,
      compliance: {
        productName: "Acme Shield",
        labelTargetCrop: "hyacinth",
        lotNumber: "LOT-20260317-001",
        phiDays: 7,
      },
    })) as { details?: Record<string, unknown> };

    expect(blocked.details?.blocked).toBe(true);
    expect(blocked.details?.reason).toBe("inferred_compliance_fields");
    expect(blocked.details?.inferredFields).toEqual([
      "compliance.productName",
      "compliance.lotNumber",
    ]);

    const store = await readStoreJson(workspaceDir);
    expect((store.operations as unknown[]) ?? []).toHaveLength(0);
  });

  it("persists batch and compliance fields for traceable operations", async () => {
    const workspaceDir = await createTempWorkspace();
    cleanupPaths.push(workspaceDir);
    const { tools } = registerPluginForTest();
    const ctx = { workspaceDir };
    const registerUnit = materializeTool(tools, "agri_register_unit", ctx);
    const registerCropPlan = materializeTool(tools, "agri_register_crop_plan", ctx);
    const logOperation = materializeTool(tools, "agri_log_operation", ctx);

    const unitResult = (await registerUnit.execute?.("tool-1", {
      name: "South Plot",
      kind: "field",
    })) as { details?: { item?: { id?: string } } };
    const unitId = unitResult.details?.item?.id;

    const cropResult = (await registerCropPlan.execute?.("tool-2", {
      unitId,
      crop: "wheat",
      currentStage: "mature",
      rulesetVersion: "wheat@0.1.0",
    })) as { details?: { item?: { id?: string } } };
    const cropPlanId = cropResult.details?.item?.id;

    const logged = (await logOperation.execute?.("tool-3", {
      cropPlanId,
      type: "harvest",
      performedAt: "2026-07-08T08:30:00.000Z",
      summary: "Combine pass completed",
      confirmed: true,
      batchId: "lot-2026-south-001",
      amount: 4.2,
      unit: "t",
    })) as { details?: { ok?: boolean } };

    expect(logged.details?.ok).toBe(true);

    const store = await readStoreJson(workspaceDir);
    const operations = (store.operations as Array<Record<string, unknown>>) ?? [];

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      type: "harvest",
      batchId: "lot-2026-south-001",
      amount: 4.2,
      unit: "t",
    });
  });
});

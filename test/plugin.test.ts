import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTempWorkspace, materializeTool, readStoreJson, registerPluginForTest } from "./helpers.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await fs.rm(target, { recursive: true, force: true });
    }),
  );
});

describe("agri-orchestrator plugin", () => {
  it("registers the expected tools, prompt hook, and ingest route", () => {
    const { tools, hooks, routes } = registerPluginForTest();

    expect(tools).toHaveLength(5);
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
        recommendations?: Array<{ rationale?: string }>;
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
          rationale?: string;
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
        (item.rationale ?? "").includes("should not be pushed with routine top-dress fertilization"),
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
        recommendations?: Array<{ rationale?: string }>;
        plans?: Array<{ cropPackageId?: string; mode?: string }>;
      };
    };

    expect(result.details?.plans?.[0]).toMatchObject({
      cropPackageId: "generic",
      mode: "conservative",
    });
    expect(
      (result.details?.recommendations?.[0]?.rationale ?? "").includes(
        "No crop-specific rule package is registered",
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
});

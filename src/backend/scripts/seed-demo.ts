import { BackendService } from "../services.js";
import { createRuntime } from "../runtime.js";

async function main() {
  const runtime = await createRuntime();
  const services = new BackendService(runtime.repository, runtime.storage);

  const unit = await services.createUnit({
    name: "Demo Balcony Hyacinth",
    type: "container",
    locationText: "balcony",
    irrigationMethod: "manual",
    status: "active",
  });

  await services.createCropPlan(unit.id, {
    crop: "hyacinth",
    cultivar: "Delft Blue",
    currentStage: "flowering",
    target: "ornamental",
  });

  await services.createObservation(unit.id, "user", {
    body: {
      type: "soil_moisture",
      payload: { status: "dry" },
    },
    attachments: [],
  });

  const result = await services.runCareCheck(unit.id, true);
  console.log(JSON.stringify({ unitId: unit.id, recommendations: result.savedRecommendations.length, reminders: result.savedReminders.length }, null, 2));
  await runtime.db.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

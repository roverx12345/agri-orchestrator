import { BackendService } from "./services.js";
import { createRuntime } from "./runtime.js";

async function main() {
  const runtime = await createRuntime();
  const services = new BackendService(runtime.repository, runtime.storage);
  console.log(`Seedflower worker running every ${runtime.config.reminderScanIntervalMs}ms`);
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    const result = await services.processDueReminders();
    if (result.processed.length > 0) {
      console.log(`processed ${result.processed.length} reminders`);
    }
  };

  const shutdown = async () => {
    if (timer) {
      clearInterval(timer);
    }
    await runtime.db.close();
  };

  process.once("SIGINT", () => {
    shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    shutdown().finally(() => process.exit(0));
  });

  await tick();
  timer = setInterval(() => {
    tick().catch((error) => console.error(error));
  }, runtime.config.reminderScanIntervalMs);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { buildBackendApp } from "./app.js";
import { createRuntime } from "./runtime.js";

async function main() {
  const runtime = await createRuntime();
  const { app } = await buildBackendApp({ repository: runtime.repository, storage: runtime.storage });
  await app.listen({ port: runtime.config.port, host: runtime.config.host });
  console.log(`Seedflower backend listening on http://${runtime.config.host}:${runtime.config.port}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { PgDatabase, requireDatabaseUrl, runMigrations } from "./pg.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const config = loadConfig();
  const db = new PgDatabase(requireDatabaseUrl(config.databaseUrl));
  try {
    const executed = await runMigrations(db, path.resolve(__dirname, "../migrations"));
    console.log(`Applied migrations: ${executed.length === 0 ? "none" : executed.join(", ")}`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

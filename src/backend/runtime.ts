import { loadConfig } from "./config.js";
import { PgDatabase, requireDatabaseUrl } from "./db/pg.js";
import { PgRepository } from "./repository.js";
import { LocalFileStorage } from "./storage/local-storage.js";

export async function createRuntime() {
  const config = loadConfig();
  const db = new PgDatabase(requireDatabaseUrl(config.databaseUrl));
  const repository = new PgRepository(db);
  const storage = new LocalFileStorage(config.storageDir);
  await storage.ensureReady();
  return { config, db, repository, storage };
}

import fs from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { assert } from "../utils.js";

export class PgDatabase {
  readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async query<T extends import("pg").QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(text, params);
    return result.rows;
  }

  async one<T extends import("pg").QueryResultRow>(text: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.query<T>(text, params);
    return rows[0];
  }

  async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function loadMigrationFiles(migrationsDir: string): Promise<Array<{ version: string; sql: string }>> {
  const entries = await fs.readdir(migrationsDir);
  const files = entries.filter((entry) => entry.endsWith(".sql")).sort();
  return Promise.all(
    files.map(async (file) => ({
      version: file,
      sql: await fs.readFile(path.join(migrationsDir, file), "utf8"),
    })),
  );
}

export async function runMigrations(db: PgDatabase, migrationsDir: string): Promise<string[]> {
  const migrations = await loadMigrationFiles(migrationsDir);

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const appliedRows = await db.query<{ version: string }>("SELECT version FROM schema_migrations");
  const applied = new Set(appliedRows.map((row) => row.version));
  const executed: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      continue;
    }

    await db.transaction(async (client) => {
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [migration.version]);
    });

    executed.push(migration.version);
  }

  return executed;
}

export function requireDatabaseUrl(value: string | undefined): string {
  assert(value, "DATABASE_URL is required for PostgreSQL-backed commands", 500);
  return value;
}

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { createDatabasePoolConfig } from "../src/lib/db-config";

async function main() {
  const pool = new Pool(createDatabasePoolConfig(process.env, { max: 2 }));
  try {
    const sql = await readFile(resolve(process.cwd(), "scripts/schema.sql"), "utf8");
    const client = await pool.connect();
    try {
      // Apply the idempotent schema as one unit. A failed migration must not
      // leave only part of the schema updated.
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("COMMIT");
      console.log("Mnemosyne database schema is ready.");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Database migration failed.");
  process.exit(1);
});

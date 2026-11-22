import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({ connectionString, max: 2 });
  try {
    const sql = await readFile(resolve(process.cwd(), "scripts/schema.sql"), "utf8");
    await pool.query(sql);
    console.log("Mnemosyne database schema is ready.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { Pool } from "pg";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const result = await pool.query("SELECT current_database() AS database, now() AS server_time");
    console.log(`Connected to ${result.rows[0].database} at ${result.rows[0].server_time}`);
  } finally {
    await pool.end();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });

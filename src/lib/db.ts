import "server-only";
import { Pool } from "pg";

const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const db = globalForPg.pgPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.NODE_ENV === "production" ? 10 : 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: true } : undefined,
});

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = db;

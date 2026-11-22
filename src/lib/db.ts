import "server-only";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

let databaseHost = "";
try {
  databaseHost = new URL(databaseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
} catch {
  throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
}

const isLoopbackDatabase = !databaseHost || [
  "localhost",
  "127.0.0.1",
  "::1",
].includes(databaseHost);
const databaseTlsRequired = process.env.NODE_ENV === "production" && !isLoopbackDatabase;
const databaseTlsMode = process.env.PGSSLMODE?.toLowerCase();

if (databaseTlsRequired && databaseTlsMode !== "require") {
  throw new Error(
    "Remote PostgreSQL connections in production require PGSSLMODE=require. Configure verified TLS before starting the application.",
  );
}

const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const db = globalForPg.pgPool ?? new Pool({
  connectionString: databaseUrl,
  max: process.env.NODE_ENV === "production" ? 10 : 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: databaseTlsMode === "require" ? { rejectUnauthorized: true } : undefined,
});

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = db;

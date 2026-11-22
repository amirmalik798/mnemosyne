import "server-only";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

let parsedDatabaseUrl: URL;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)) {
    throw new Error("Unsupported database protocol.");
  }
} catch {
  throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
}

const databaseHost = parsedDatabaseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
const isLoopbackDatabase = [
  "localhost",
  "127.0.0.1",
  "::1",
].includes(databaseHost);
const databaseTlsRequired = process.env.NODE_ENV === "production" && !isLoopbackDatabase;
const databaseTlsMode = process.env.PGSSLMODE?.toLowerCase();

if (databaseTlsMode && databaseTlsMode !== "verify-full") {
  throw new Error(
    "PGSSLMODE must be verify-full. Mnemosyne does not allow encrypted-but-unverified PostgreSQL connections.",
  );
}

if (databaseTlsRequired && databaseTlsMode !== "verify-full") {
  throw new Error(
    "Remote PostgreSQL connections in production require PGSSLMODE=verify-full so the server certificate and hostname are verified.",
  );
}

// node-postgres parses host and SSL query parameters from the URL and may
// override fields in the config object. Reject them so the effective endpoint
// and TLS verification policy cannot diverge from the checks above.
const protectedUrlParameters = ["host", "port", "ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"];
const conflictingConnectionParameter = protectedUrlParameters.find((name) => parsedDatabaseUrl.searchParams.has(name));
if (conflictingConnectionParameter) {
  throw new Error(
    `Remove "${conflictingConnectionParameter}" from DATABASE_URL. Set the actual host in the URL and configure verified TLS with PGSSLMODE=verify-full.`,
  );
}

const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const db = globalForPg.pgPool ?? new Pool({
  connectionString: parsedDatabaseUrl.toString(),
  max: process.env.NODE_ENV === "production" ? 10 : 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: databaseTlsMode === "verify-full" ? { rejectUnauthorized: true } : undefined,
});

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = db;

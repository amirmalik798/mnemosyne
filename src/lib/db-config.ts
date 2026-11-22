import type { PoolConfig } from "pg";

type DatabaseEnvironment = Pick<
  NodeJS.ProcessEnv,
  "DATABASE_URL" | "PGSSLMODE" | "NODE_ENV"
>;

type DatabasePoolOptions = {
  max?: number;
};

/**
 * Build one validated PostgreSQL configuration for the app and operational
 * scripts. Keeping this policy in one place prevents migrations and health
 * checks from silently using weaker or different connection settings.
 */
export function createDatabasePoolConfig(
  env: DatabaseEnvironment = process.env,
  options: DatabasePoolOptions = {},
): PoolConfig {
  const databaseUrl = env.DATABASE_URL;
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
  const isLoopbackDatabase = ["localhost", "127.0.0.1", "::1"].includes(databaseHost);
  const databaseTlsMode = env.PGSSLMODE?.trim().toLowerCase();

  if (databaseTlsMode && databaseTlsMode !== "verify-full") {
    throw new Error(
      "PGSSLMODE must be verify-full. Mnemosyne does not allow encrypted-but-unverified PostgreSQL connections.",
    );
  }

  if (env.NODE_ENV === "production" && !isLoopbackDatabase && databaseTlsMode !== "verify-full") {
    throw new Error(
      "Remote PostgreSQL connections in production require PGSSLMODE=verify-full so the server certificate and hostname are verified.",
    );
  }

  // node-postgres parses host and SSL query parameters from the URL and may
  // override config-object values. Reject them so validation cannot be bypassed.
  const protectedUrlParameters = new Set([
    "host",
    "port",
    "ssl",
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
  ]);
  const conflictingConnectionParameter = Array.from(parsedDatabaseUrl.searchParams.keys())
    .find((name) => protectedUrlParameters.has(name.toLowerCase()));

  if (conflictingConnectionParameter) {
    throw new Error(
      'Remove "' + conflictingConnectionParameter + '" from DATABASE_URL. Set the actual host in the URL and configure verified TLS with PGSSLMODE=verify-full.',
    );
  }

  return {
    connectionString: parsedDatabaseUrl.toString(),
    max: options.max ?? (env.NODE_ENV === "production" ? 10 : 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: databaseTlsMode === "verify-full" ? { rejectUnauthorized: true } : undefined,
  };
}

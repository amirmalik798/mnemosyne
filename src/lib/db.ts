import "server-only";
import { Pool, type PoolClient } from "pg";
import { createDatabasePoolConfig } from "@/lib/db-config";

// Runtime queries must use a least-privileged PostgreSQL role through
// APP_DATABASE_URL. DATABASE_URL is reserved for schema migrations.
const runtimeDatabaseUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
if (!runtimeDatabaseUrl) throw new Error("APP_DATABASE_URL is required for the Mnemosyne application.");

const runtimeEnv = { ...process.env, DATABASE_URL: runtimeDatabaseUrl };
const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const db = globalForPg.pgPool ?? new Pool(createDatabasePoolConfig(runtimeEnv));

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = db;

/**
 * Attach the authenticated account to the current transaction. PostgreSQL
 * RLS policies read this transaction-local setting. It is never stored on a
 * pooled connection after COMMIT/ROLLBACK.
 */
export async function setUserContext(client: PoolClient, userId: string): Promise<void> {
  await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
}

/** Run one tenant-scoped query in its own short transaction. */
export async function queryAsUser(
  userId: string,
  text: string,
  values: unknown[] = [],
) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await setUserContext(client, userId);
    const result = await client.query(text, values);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

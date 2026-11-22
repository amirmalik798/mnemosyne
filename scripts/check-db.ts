import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { Pool } from "pg";
import { createDatabasePoolConfig } from "../src/lib/db-config";

const requiredColumns: Array<[string, string]> = [
  ["users", "id"], ["users", "email"], ["users", "password_hash"],
  ["users", "password_salt"], ["users", "wrapped_key"], ["users", "email_verified_at"],
  ["user_sessions", "user_id"], ["user_sessions", "token_hash"],
  ["user_sessions", "encrypted_key"], ["user_sessions", "last_active_at"],
  ["email_verification_tokens", "token_hash"], ["auth_rate_limits", "attempts"],
  ["topics", "user_id"], ["topics", "title_enc"], ["topics", "cover_asset_id"],
  ["notes", "user_id"], ["notes", "topic_id"], ["notes", "content_enc"],
  ["notes", "deleted_at"], ["assets", "user_id"], ["assets", "owner_type"],
  ["assets", "owner_id"], ["assets", "storage_key"], ["assets", "original_name_enc"],
  ["asset_blobs", "user_id"], ["asset_blobs", "asset_id"], ["asset_blobs", "encrypted_bytes"],
];

async function main() {
  const appUrl = process.env.APP_DATABASE_URL;
  if (!appUrl) {
    throw new Error(
      "APP_DATABASE_URL is required. Configure a dedicated PostgreSQL runtime role with NOBYPASSRLS; keep DATABASE_URL for migrations only.",
    );
  }
  const runtimeEnv = { ...process.env, DATABASE_URL: appUrl };
  const pool = new Pool(createDatabasePoolConfig(runtimeEnv, { max: 1 }));
  try {
    const [connection, missing, role, rls] = await Promise.all([
      pool.query("SELECT current_database() AS database, current_schema() AS schema"),
      pool.query(
        "WITH required(table_name, column_name) AS (SELECT * FROM unnest($1::text[], $2::text[])) " +
        "SELECT r.table_name, r.column_name FROM required r WHERE NOT EXISTS (" +
        "SELECT 1 FROM information_schema.columns c WHERE c.table_schema=current_schema() " +
        "AND c.table_name=r.table_name AND c.column_name=r.column_name) ORDER BY 1,2",
        [requiredColumns.map(([table]) => table), requiredColumns.map(([, column]) => column)],
      ),
      pool.query(
        "SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user",
      ),
      pool.query(
        "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity " +
        "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace " +
        "WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[])",
        [["topics", "notes", "assets", "asset_blobs"]],
      ),
    ]);

    if (missing.rows.length) {
      throw new Error(
        "Database schema is incomplete. Run npm run db:migrate. Missing: " +
        missing.rows.map((row) => row.table_name + "." + row.column_name).join(", "),
      );
    }
    const activeRole = role.rows[0];
    if (!activeRole || activeRole.rolsuper || activeRole.rolbypassrls) {
      throw new Error(
        "APP_DATABASE_URL must use a non-superuser PostgreSQL role with NOBYPASSRLS. A superuser bypasses row-level security.",
      );
    }
    const protectedTables = new Set(rls.rows.filter((row) => row.relrowsecurity && row.relforcerowsecurity).map((row) => row.relname));
    const missingRls = ["topics", "notes", "assets", "asset_blobs"].filter((table) => !protectedTables.has(table));
    if (missingRls.length) throw new Error("Row-level security is not enforced on: " + missingRls.join(", "));

    console.log(
      "Database connection, account schema and enforced row-level security verified: " +
      connection.rows[0].database + " (" + connection.rows[0].schema + ").",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Database check failed.");
  process.exit(1);
});

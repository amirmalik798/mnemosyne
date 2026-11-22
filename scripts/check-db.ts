import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { Pool } from "pg";
import { createDatabasePoolConfig } from "../src/lib/db-config";

const requiredColumns: Array<[string, string]> = [
  ["users", "id"], ["users", "email"], ["users", "password_hash"],
  ["users", "password_salt"], ["users", "wrapped_key"], ["users", "email_verified_at"],
  ["user_sessions", "user_id"], ["user_sessions", "token_hash"],
  ["user_sessions", "encrypted_key"], ["user_sessions", "last_active_at"],
  ["email_verification_tokens", "user_id"], ["email_verification_tokens", "token_hash"],
  ["email_verification_tokens", "expires_at"], ["auth_rate_limits", "attempts"],
  ["topics", "user_id"], ["topics", "title_enc"], ["topics", "cover_asset_id"],
  ["notes", "user_id"], ["notes", "topic_id"], ["notes", "content_enc"],
  ["notes", "deleted_at"], ["assets", "user_id"], ["assets", "owner_type"],
  ["assets", "owner_id"], ["assets", "storage_key"], ["assets", "original_name_enc"],
  ["asset_blobs", "user_id"], ["asset_blobs", "asset_id"], ["asset_blobs", "encrypted_bytes"],
];

const runtimeTables = [
  "users",
  "user_sessions",
  "email_verification_tokens",
  "auth_rate_limits",
  "topics",
  "notes",
  "assets",
  "asset_blobs",
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
    const [connection, missing, role, rls, owners, schemaPrivilege, privileges] = await Promise.all([
      pool.query("SELECT current_database() AS database, current_schema() AS schema"),
      pool.query(
        "WITH required(table_name, column_name) AS (SELECT * FROM unnest($1::text[], $2::text[])) " +
        "SELECT r.table_name, r.column_name FROM required r WHERE NOT EXISTS (" +
        "SELECT 1 FROM information_schema.columns c WHERE c.table_schema=current_schema() " +
        "AND c.table_name=r.table_name AND c.column_name=r.column_name) ORDER BY 1,2",
        [requiredColumns.map(([table]) => table), requiredColumns.map(([, column]) => column)],
      ),
      pool.query(
        "SELECT current_user AS role_name, r.rolsuper, r.rolbypassrls " +
        "FROM pg_roles r WHERE r.rolname=current_user",
      ),
      pool.query(
        "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity " +
        "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace " +
        "WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[])",
        [["topics", "notes", "assets", "asset_blobs"]],
      ),
      pool.query(
        "SELECT c.relname, pg_get_userbyid(c.relowner) AS owner " +
        "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace " +
        "WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[])",
        [runtimeTables],
      ),
      pool.query(
        "SELECT has_schema_privilege(current_user, current_schema(), 'CREATE') AS can_create",
      ),
      pool.query(
        "SELECT t.table_name, p.privilege, " +
        "has_table_privilege(current_user, format('%I.%I', current_schema(), t.table_name), p.privilege) AS allowed " +
        "FROM unnest($1::text[]) AS t(table_name) " +
        "CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']::text[]) AS p(privilege)",
        [runtimeTables],
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
        "APP_DATABASE_URL must use a non-superuser PostgreSQL role with NOBYPASSRLS. A superuser or BYPASSRLS role can read every account.",
      );
    }

    const protectedTables = new Set(
      rls.rows
        .filter((row) => row.relrowsecurity && row.relforcerowsecurity)
        .map((row) => row.relname),
    );
    const missingRls = ["topics", "notes", "assets", "asset_blobs"]
      .filter((table) => !protectedTables.has(table));
    if (missingRls.length) {
      throw new Error("Row-level security is not enforced on: " + missingRls.join(", "));
    }

    const runtimeOwnedTables = owners.rows
      .filter((row) => row.owner === activeRole.role_name)
      .map((row) => row.relname);
    if (runtimeOwnedTables.length) {
      throw new Error(
        "APP_DATABASE_URL must not own protected tables: " +
        runtimeOwnedTables.join(", ") +
        ". Use a separate migration owner.",
      );
    }

    if (schemaPrivilege.rows[0]?.can_create) {
      throw new Error("APP_DATABASE_URL must not have CREATE privilege on the application schema.");
    }

    const requiredConstraints = [
      "notes_user_topic_fk",
      "asset_blobs_user_asset_fk",
    ];
    const constraintResult = await pool.query(
      "SELECT conname FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND conname=ANY($1::text[])",
      [requiredConstraints],
    );
    const presentConstraints = new Set(constraintResult.rows.map((row) => row.conname));
    const missingConstraints = requiredConstraints.filter((name) => !presentConstraints.has(name));
    if (missingConstraints.length) {
      throw new Error("Required same-account database constraints are missing: " + missingConstraints.join(", ") + ". Run npm run db:migrate.");
    }

    const triggerResult = await pool.query(
      "SELECT t.tgname FROM pg_trigger t " +
      "JOIN pg_class c ON c.oid=t.tgrelid " +
      "JOIN pg_namespace n ON n.oid=c.relnamespace " +
      "WHERE NOT t.tgisinternal AND n.nspname=current_schema() AND t.tgname=ANY($1::text[])",
      [["assets_validate_owner", "topics_validate_cover"]],
    );
    const presentTriggers = new Set(triggerResult.rows.map((row) => row.tgname));
    const missingTriggers = ["assets_validate_owner", "topics_validate_cover"].filter((name) => !presentTriggers.has(name));
    if (missingTriggers.length) {
      throw new Error("Required account-ownership triggers are missing: " + missingTriggers.join(", ") + ". Run npm run db:migrate.");
    }

    const missingPrivileges = privileges.rows
      .filter((row) => !row.allowed)
      .map((row) => row.table_name + ":" + row.privilege);
    if (missingPrivileges.length) {
      throw new Error(
        "The application role is missing database permissions: " +
        missingPrivileges.join(", ") +
        ". Grant SELECT, INSERT, UPDATE and DELETE on the listed application tables.",
      );
    }

    console.log(
      "Database connection, account schema, least-privileged runtime role and enforced row-level security verified: " +
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

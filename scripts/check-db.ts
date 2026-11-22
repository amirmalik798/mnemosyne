import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { Pool } from "pg";
import { createDatabasePoolConfig } from "../src/lib/db-config";

const requiredColumns: Array<[string, string]> = [
  ["vault_settings", "id"],
  ["vault_settings", "password_salt"],
  ["vault_settings", "wrapped_key"],
  ["vault_settings", "failed_attempts"],
  ["vault_settings", "locked_until"],
  ["vault_sessions", "id"],
  ["vault_sessions", "token_hash"],
  ["vault_sessions", "encrypted_key"],
  ["vault_sessions", "expires_at"],
  ["vault_sessions", "last_active_at"],
  ["topics", "id"],
  ["topics", "title_enc"],
  ["topics", "subject_enc"],
  ["topics", "description_enc"],
  ["topics", "category_enc"],
  ["topics", "cover_asset_id"],
  ["notes", "id"],
  ["notes", "topic_id"],
  ["notes", "title_enc"],
  ["notes", "subject_enc"],
  ["notes", "content_enc"],
  ["notes", "tags_enc"],
  ["notes", "pinned"],
  ["notes", "deleted_at"],
  ["assets", "id"],
  ["assets", "owner_type"],
  ["assets", "owner_id"],
  ["assets", "storage_key"],
  ["assets", "original_name_enc"],
  ["assets", "mime_type"],
  ["assets", "byte_size"],
  ["asset_blobs", "asset_id"],
  ["asset_blobs", "encrypted_bytes"],
];

async function main() {
  const pool = new Pool(createDatabasePoolConfig(process.env, { max: 1 }));
  try {
    const connection = await pool.query(
      "SELECT current_database() AS database, current_schema() AS schema, now() AS server_time",
    );
    const missing = await pool.query(
      "WITH required(table_name, column_name) AS (" +
        " SELECT * FROM unnest($1::text[], $2::text[])" +
      ") " +
      "SELECT required.table_name, required.column_name " +
      "FROM required " +
      "WHERE NOT EXISTS (" +
      " SELECT 1 FROM information_schema.columns AS actual " +
      " WHERE actual.table_schema = current_schema() " +
      " AND actual.table_name = required.table_name " +
      " AND actual.column_name = required.column_name" +
      ") " +
      "ORDER BY required.table_name, required.column_name",
      [requiredColumns.map(([table]) => table), requiredColumns.map(([, column]) => column)],
    );

    if (missing.rows.length > 0) {
      const names = missing.rows.map((row) => row.table_name + "." + row.column_name);
      throw new Error(
        "Database connection succeeded, but the schema is incomplete. Run npm run db:migrate. Missing: " +
        names.join(", "),
      );
    }

    console.log(
      "Database connection and schema verified: " +
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

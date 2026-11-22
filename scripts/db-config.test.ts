import assert from "node:assert/strict";
import test from "node:test";
import { createDatabasePoolConfig } from "../src/lib/db-config";

const localDatabaseUrl =
  "postgresql://postgres:postgres@127.0.0.1:5432/mnemosyne";

test("local PostgreSQL keeps the development pool configuration", () => {
  const config = createDatabasePoolConfig({
    DATABASE_URL: localDatabaseUrl,
    NODE_ENV: "development",
  });

  assert.equal(config.connectionString, localDatabaseUrl);
  assert.equal(config.max, 5);
  assert.equal(config.ssl, undefined);
});

test("remote production PostgreSQL requires verified TLS", () => {
  assert.throws(
    () =>
      createDatabasePoolConfig({
        DATABASE_URL: "postgresql://app:secret@db.example.com:5432/mnemosyne",
        NODE_ENV: "production",
      }),
    /PGSSLMODE=verify-full/,
  );
});

test("verified TLS is configured for remote production PostgreSQL", () => {
  const config = createDatabasePoolConfig({
    DATABASE_URL: "postgresql://app:secret@db.example.com:5432/mnemosyne",
    NODE_ENV: "production",
    PGSSLMODE: "verify-full",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.max, 10);
});

test("insecure TLS modes are rejected", () => {
  assert.throws(
    () =>
      createDatabasePoolConfig({
        DATABASE_URL: localDatabaseUrl,
        NODE_ENV: "development",
        PGSSLMODE: "require",
      }),
    /PGSSLMODE must be verify-full/,
  );
});

test("connection-string host and SSL overrides are rejected case-insensitively", () => {
  for (const parameter of ["sslmode=require", "Host=attacker.example.com", "ssl=true"]) {
    assert.throws(
      () =>
        createDatabasePoolConfig({
          DATABASE_URL: localDatabaseUrl + "?" + parameter,
          NODE_ENV: "development",
        }),
      /Remove ".+" from DATABASE_URL/,
    );
  }
});

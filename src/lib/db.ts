import "server-only";
import { Pool } from "pg";
import { createDatabasePoolConfig } from "@/lib/db-config";

const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const db = globalForPg.pgPool ?? new Pool(createDatabasePoolConfig());

if (process.env.NODE_ENV !== "production") globalForPg.pgPool = db;

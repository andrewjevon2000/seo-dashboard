import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Postgres connection for Server Components and serverless functions.
 *
 * Serverless invocations are short-lived and can fan out, so we keep the pool
 * small and reuse a single client across hot invocations via a global cache.
 * Point DATABASE_URL at Supabase's TRANSACTION pooler (port 6543) in production;
 * `prepare: false` is required for that pooler.
 */

const globalForDb = globalThis as unknown as {
  __sql?: ReturnType<typeof postgres>;
};

const sql =
  globalForDb.__sql ??
  postgres(env.DATABASE_URL, {
    max: 5,
    idle_timeout: 20,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__sql = sql;
}

export const db = drizzle(sql, { schema });
export { schema };

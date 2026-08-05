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
  __db?: ReturnType<typeof drizzle<typeof schema>>;
};

/**
 * Lazily create the connection + Drizzle instance on first use. This keeps
 * module import side-effect-free so `next build` never needs DATABASE_URL, while
 * still failing fast with a clear message at the first query if it's unset.
 */
function getDb() {
  if (globalForDb.__db) return globalForDb.__db;
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Add it (Supabase pooled connection) to the environment.",
    );
  }
  const sql =
    globalForDb.__sql ??
    postgres(env.DATABASE_URL, { max: 5, idle_timeout: 20, prepare: false });
  const instance = drizzle(sql, { schema });
  // Cache across hot invocations / serverless reuse.
  globalForDb.__sql = sql;
  globalForDb.__db = instance;
  return instance;
}

/**
 * Proxy that defers initialization to first property access, so `import { db }`
 * is safe at build time. Queries behave exactly as a normal Drizzle client.
 */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };

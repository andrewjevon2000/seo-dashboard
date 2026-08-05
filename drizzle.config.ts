import { defineConfig } from "drizzle-kit";

// Load .env / .env.local so DIRECT_URL/DATABASE_URL are present when drizzle-kit
// evaluates this config outside of Next.
for (const file of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* absent */
  }
}

// Migrations use the DIRECT (non-pooled) connection when available, since the
// transaction pooler doesn't support all DDL/session features drizzle-kit needs.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL || "";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});

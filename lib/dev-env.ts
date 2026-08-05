/**
 * Load .env / .env.local for CLI + drizzle-kit contexts (Node 20.12+ built-in,
 * no dotenv dependency). Next.js loads these automatically for the app; this is
 * only for scripts run outside Next (pipeline CLI, migrations). No-op in
 * production, where real env vars are already present.
 */
export function loadDevEnv(): void {
  for (const file of [".env", ".env.local"]) {
    try {
      process.loadEnvFile(file); // .env.local loads last → overrides .env
    } catch {
      // File absent — fine.
    }
  }
}

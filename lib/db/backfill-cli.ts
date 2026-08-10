/**
 * Historical backfill runner: `npm run db:backfill`
 *
 * Seeds the client profile and loads all decisions we can source faithfully
 * (currently: the content-plan pillar designations). Idempotent — safe to re-run;
 * already-present rows are skipped, not duplicated. Prints a report of what still
 * needs a real source before it can be recorded.
 *
 * Loads .env / .env.local before importing anything that reads env (env.ts
 * validates at import time), matching lib/pipeline/cli.ts.
 */
import { loadDevEnv } from "@/lib/dev-env";

loadDevEnv();

const { runBackfill } = await import("./backfill");

runBackfill()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

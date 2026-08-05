/**
 * Manual pipeline runner: `npm run pipeline:run -- [options]`
 *
 *   --end=YYYY-MM-DD     snapshot end date for a weekly pull (default: today, UTC)
 *   --days=7             window width for the weekly aggregate
 *   --backfill           run the credit-heavy historical backfill instead
 *   --from=YYYY-MM-DD    backfill start (required with --backfill)
 *   --to=YYYY-MM-DD      backfill end (default: today)
 *   --grouping=weekly    backfill grouping: daily|weekly|monthly
 *
 * Loads .env / .env.local before importing anything that reads env (env.ts
 * validates at import time), so `npm run pipeline:run` works with no extra flags.
 */
import { loadDevEnv } from "@/lib/dev-env";

loadDevEnv();

// Dynamic import AFTER env is loaded — run.ts → env.ts validates on import.
const { runWeeklyPull, runBackfill } = await import("./run");

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  if (flag("backfill")) {
    const from = arg("from");
    if (!from) throw new Error("--backfill requires --from=YYYY-MM-DD");
    const result = await runBackfill({
      dateFrom: from,
      dateTo: arg("to") ?? today(),
      grouping: (arg("grouping") as "daily" | "weekly" | "monthly") ?? "weekly",
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const result = await runWeeklyPull({
    periodEnd: arg("end") ?? today(),
    windowDays: arg("days") ? Number(arg("days")) : 7,
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

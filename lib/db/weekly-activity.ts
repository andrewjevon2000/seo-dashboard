/**
 * Fase 2 measurement: count OPERATIONAL skill runs recorded in the store over a
 * window, and (optionally) convert to hours saved using your per-task manual
 * baseline. This is how the plan's kill-criterion (>3 hrs/week?) gets a real
 * number instead of a guess.
 *
 *   npm run db:weekly-activity                       # last 7 days, run counts only
 *   npm run db:weekly-activity -- --from=2026-08-11 --to=2026-08-17
 *   npm run db:weekly-activity -- --baselines=baselines.json --reports=1
 *
 * It counts runs from the provenance the writers stamp — NOT from backfill/regen
 * data (which is excluded). A run = one skill invocation that wrote to the store:
 *   - post-draft-sweep     : changelog rows (action=pre_publish_sweep, skill exec)
 *   - gsc-weekly-digest    : distinct (date,country) keyword batches
 *   - cannibalization-check: decisions produced_by=skill:cannibalization-check
 *   - site-audit           : distinct crawl dates among source_skill=site-audit
 *   - link-health          : distinct pull dates among source_skill=link-health
 *   - seo-report           : READ-only, leaves no store write → pass --reports=N
 *
 * baselines.json (minutes SAVED per run, from YOUR manual baseline):
 *   { "post-draft-sweep": 8, "gsc-weekly-digest": 30, "cannibalization-check": 15,
 *     "site-audit": 45, "link-health": 30, "seo-report": 90 }
 */
import { readFileSync } from "node:fs";
import { loadDevEnv } from "@/lib/dev-env";
import { windowEnding } from "./store-helpers";

loadDevEnv();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

const SKILLS = [
  "post-draft-sweep",
  "gsc-weekly-digest",
  "cannibalization-check",
  "site-audit",
  "link-health",
  "seo-report",
] as const;
type Skill = (typeof SKILLS)[number];

async function main() {
  const win = windowEnding(new Date());
  const from = arg("from") ?? win.from;
  const to = arg("to") ?? win.to;
  const reportRuns = arg("reports") ? Number(arg("reports")) : 0;

  let baselines: Partial<Record<Skill, number>> | null = null;
  const bl = arg("baselines");
  if (bl) baselines = JSON.parse(readFileSync(bl, "utf8"));

  const { env } = await import("@/lib/env");
  const { db } = await import("./client");
  const { sql } = await import("drizzle-orm");
  const site = env.SITE_KEY;

  // created_at is a timestamptz; compare its date part to the window.
  const inWin = (col: string) => sql.raw(`${col}::date between '${from}' and '${to}'`);

  const one = async (q: ReturnType<typeof sql>): Promise<number> => {
    const rows = (await db.execute(q)) as unknown as Array<{ n: number | string }>;
    return Number(rows[0]?.n ?? 0);
  };

  const runs: Record<Skill, number> = {
    "post-draft-sweep": await one(sql`
      select count(*)::int n from changelog
      where site = ${site} and action = 'pre_publish_sweep'
        and executed_by = 'skill:post-draft-sweep' and ${inWin("created_at")}`),
    "gsc-weekly-digest": await one(sql`
      select count(*)::int n from (
        select distinct date, country from keyword_snapshots
        where site = ${site} and ${inWin("created_at")}
      ) t`),
    "cannibalization-check": await one(sql`
      select count(*)::int n from decisions
      where site = ${site} and produced_by = 'skill:cannibalization-check'
        and ${inWin("created_at")}`),
    "site-audit": await one(sql`
      select count(distinct last_detected_at)::int n from findings
      where site = ${site} and source_skill = 'site-audit'
        and last_detected_at between ${from} and ${to}`),
    "link-health": await one(sql`
      select count(distinct last_detected_at)::int n from findings
      where site = ${site} and source_skill = 'link-health'
        and last_detected_at between ${from} and ${to}`),
    "seo-report": reportRuns,
  };

  // Hours saved (only if baselines given).
  let hoursSaved: number | null = null;
  const perSkillHours: Partial<Record<Skill, number>> = {};
  if (baselines) {
    hoursSaved = 0;
    for (const s of SKILLS) {
      const mins = baselines[s] ?? 0;
      const h = (runs[s] * mins) / 60;
      perSkillHours[s] = +h.toFixed(2);
      hoursSaved += h;
    }
    hoursSaved = +hoursSaved.toFixed(2);
  }

  // Readable summary.
  console.log(`\nActivity ${from} → ${to} (operational skill runs; backfill/regen excluded)\n`);
  const rows = SKILLS.map((s) => {
    const r = runs[s];
    const note = s === "seo-report" && !arg("reports") ? " (read-only; pass --reports=N)" : "";
    const hrs = baselines ? `  ~${perSkillHours[s]} h` : "";
    return `  ${s.padEnd(22)} ${String(r).padStart(3)} run(s)${hrs}${note}`;
  });
  console.log(rows.join("\n"));

  if (hoursSaved != null) {
    const verdict = hoursSaved >= 3 ? "≥ 3 h/week — clears the kill threshold" : "< 3 h/week — BELOW the kill threshold";
    console.log(`\n  TOTAL hours saved: ~${hoursSaved} h  →  ${verdict}`);
  } else {
    console.log(`\n  (No baselines supplied — run counts only. Add --baselines=<file> for hours saved.)`);
  }

  const totalRuns = SKILLS.reduce((a, s) => a + runs[s], 0);
  if (totalRuns === 0) {
    console.log(`\n  ⚠ Zero operational runs in this window. Either no skills ran, or their\n    SKILL.md persist steps aren't active yet (fold them into the plugin source).`);
  }

  console.log("\n" + JSON.stringify({ window: { from, to }, runs, perSkillHours: baselines ? perSkillHours : null, hoursSaved, threshold: 3 }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("weekly-activity failed:", err.message);
    process.exit(1);
  });

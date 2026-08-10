/**
 * Fase 2 wiring: persist gsc-weekly-digest's keyword pull to keyword_snapshots.
 * `npm run db:keyword-log -- --file=<keywords.json>`
 *
 * Records the keyword-level data the digest already pulled — it does NOT change
 * the digest's analysis/flagging logic (Fase 2 rule: change output destination
 * only). Append-only + idempotent: re-running the same week (same site/keyword/
 * country/date) never duplicates.
 *
 * Expected JSON (from the digest's Step 2 gsc-keywords pull):
 * {
 *   "date": "2026-08-10",          // snapshot date = digest window end
 *   "country": "id",               // market: "id" | "ph"
 *   "keywords": [
 *     { "keyword": "apa itu kyc", "clicks": 120, "impressions": 3400,
 *       "ctr": 0.035, "position": 2.3 }, ...
 *   ]
 * }
 * ctr may be a fraction (0.035) or a percent (3.5) — normalized to a fraction.
 */
import { readFileSync } from "node:fs";
import { loadDevEnv } from "@/lib/dev-env";

loadDevEnv();

interface KwRow {
  keyword: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}
interface KwPayload {
  date: string;
  country: string;
  keywords: KwRow[];
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

/** GSC CTR is <1 as a fraction and <100 as a percent; treat >1 as percent. */
function toFraction(ctr: number): number {
  if (!Number.isFinite(ctr) || ctr < 0) return 0;
  return ctr > 1 ? ctr / 100 : ctr;
}

function validate(r: unknown): KwPayload {
  if (!r || typeof r !== "object") throw new Error("payload is not an object");
  const o = r as Record<string, unknown>;
  if (typeof o.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.date))
    throw new Error("date (YYYY-MM-DD) is required");
  if (typeof o.country !== "string" || !o.country) throw new Error("country is required");
  if (!Array.isArray(o.keywords)) throw new Error("keywords must be an array");
  return o as unknown as KwPayload;
}

async function main() {
  const file = arg("file");
  if (!file) throw new Error("--file=<keywords.json> is required");
  const payload = validate(JSON.parse(readFileSync(file, "utf8")));

  const { env } = await import("@/lib/env");
  const { db } = await import("./client");
  const { keywordSnapshots } = await import("./schema");
  const { sql } = await import("drizzle-orm");

  const site = env.SITE_KEY;
  const country = payload.country.toLowerCase();

  // Dedupe within the batch on keyword (last wins), then map to rows.
  const seen = new Map<string, KwRow>();
  for (const k of payload.keywords) {
    if (k && typeof k.keyword === "string" && k.keyword.trim()) seen.set(k.keyword.trim(), k);
  }
  const rows = [...seen.values()].map((k) => ({
    site,
    keyword: k.keyword.trim(),
    country,
    date: payload.date,
    clicks: String(k.clicks ?? 0),
    impressions: String(k.impressions ?? 0),
    ctr: String(toFraction(Number(k.ctr ?? 0))),
    position: String(k.position ?? 0),
    source: "gsc",
  }));

  if (rows.length === 0) {
    console.log(JSON.stringify({ recorded: true, inserted: 0, skipped: 0, total: 0 }, null, 2));
    return;
  }

  let inserted = 0;
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const returned = await db
      .insert(keywordSnapshots)
      .values(chunk)
      .onConflictDoNothing({
        target: [
          keywordSnapshots.site,
          keywordSnapshots.keyword,
          keywordSnapshots.country,
          keywordSnapshots.date,
        ],
      })
      .returning({ id: keywordSnapshots.id });
    inserted += returned.length;
  }

  console.log(
    JSON.stringify(
      {
        recorded: true,
        date: payload.date,
        country,
        inserted,
        skipped: rows.length - inserted,
        total: rows.length,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("keyword-log failed:", err.message);
    process.exit(1);
  });

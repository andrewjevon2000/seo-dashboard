/**
 * Fase 2 wiring: persist site-audit / link-health findings to the findings store.
 * `npm run db:findings-log -- --file=<result.json>`
 *
 * Shared by BOTH skills (identical finding shape). Records the findings the skill
 * already produced — it does NOT re-run any crawl/pull or change triage logic
 * (Fase 2 rule: change the output destination only).
 *
 * Issue-tracker semantics: UPSERT on the stable identity (site, source_skill,
 * issue, url). A monthly re-detection updates last_detected_at (and reopens a
 * finding that had been marked `resolved` but recurred); it never duplicates.
 * `first_detected_at` is preserved. Manual `triaged`/`escalated`/`wont_fix`
 * statuses are NOT clobbered by re-detection.
 *
 * Expected JSON:
 * {
 *   "source_skill": "site-audit" | "link-health",
 *   "detected_at": "2026-08-10",              // crawl / pull date
 *   "findings": [
 *     {
 *       "category": "status-code",
 *       "issue": "4XX page receives organic traffic",
 *       "severity": "P1",                     // P1..P6 or high/med/low
 *       "url": "https://verihubs.com/blog/x", // omit for an aggregate/site-level finding
 *       "affected_count": 3,
 *       "recommended_action": "Restore or 301 to the nearest relevant page",
 *       "owner": "web",                       // web | content | client-decision
 *       "status": "open",                     // optional; default open
 *       "detail": { "issue_id": "c64d3b5a-...", "redirect_to": null }
 *     }
 *   ]
 * }
 */
import { readFileSync } from "node:fs";
import { loadDevEnv } from "@/lib/dev-env";

loadDevEnv();

const STATUSES = ["open", "triaged", "resolved", "wont_fix", "escalated"] as const;
type Status = (typeof STATUSES)[number];

interface FindingIn {
  category: string;
  issue: string;
  severity?: string | null;
  url?: string | null;
  affected_count?: number | null;
  recommended_action?: string | null;
  owner?: string | null;
  status?: Status;
  detail?: unknown;
}
interface Payload {
  source_skill: string;
  detected_at: string;
  findings: FindingIn[];
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
}

function validate(r: unknown): Payload {
  if (!r || typeof r !== "object") throw new Error("payload is not an object");
  const o = r as Record<string, unknown>;
  if (typeof o.source_skill !== "string" || !o.source_skill) throw new Error("source_skill required");
  if (typeof o.detected_at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.detected_at))
    throw new Error("detected_at (YYYY-MM-DD) required");
  if (!Array.isArray(o.findings)) throw new Error("findings must be an array");
  return o as unknown as Payload;
}

async function main() {
  const file = arg("file");
  if (!file) throw new Error("--file=<result.json> is required");
  const p = validate(JSON.parse(readFileSync(file, "utf8")));

  const { env } = await import("@/lib/env");
  const { db } = await import("./client");
  const { findings } = await import("./schema");
  const { normalizeUrl } = await import("@/lib/pipeline/normalize");
  const { sql } = await import("drizzle-orm");

  const site = env.SITE_KEY;
  let inserted = 0;
  let updated = 0;

  for (const f of p.findings) {
    if (!f.category || !f.issue) {
      throw new Error(`each finding needs category + issue (got ${JSON.stringify(f)})`);
    }
    // Per-page finding → normalized page URL. Aggregate → synthetic site marker
    // so the identity/dedup key still holds.
    const url = f.url
      ? normalizeUrl(f.url)
      : `https://verihubs.com/__site__/${slugify(`${f.category}-${f.issue}`)}`;

    const [row] = await db
      .insert(findings)
      .values({
        site,
        sourceSkill: p.source_skill,
        category: f.category,
        issue: f.issue,
        severity: f.severity ?? null,
        url,
        affectedCount: f.affected_count != null ? String(f.affected_count) : null,
        recommendedAction: f.recommended_action ?? null,
        owner: f.owner ?? null,
        status: f.status ?? "open",
        firstDetectedAt: p.detected_at,
        lastDetectedAt: p.detected_at,
        provenance: f.detail ?? null,
      })
      .onConflictDoUpdate({
        target: [findings.site, findings.sourceSkill, findings.issue, findings.url],
        set: {
          lastDetectedAt: p.detected_at,
          severity: f.severity ?? null,
          affectedCount: f.affected_count != null ? String(f.affected_count) : null,
          recommendedAction: f.recommended_action ?? null,
          owner: f.owner ?? null,
          category: f.category,
          provenance: f.detail ?? null,
          // Reopen only if it had been resolved and recurred; keep other manual
          // statuses (triaged/escalated/wont_fix) untouched.
          status: sql`case when ${findings.status} = 'resolved' then 'open'::finding_status else ${findings.status} end`,
        },
      })
      .returning({ id: findings.id, isInsert: sql<boolean>`(xmax = 0)` });

    if (row.isInsert) inserted++;
    else updated++;
  }

  console.log(
    JSON.stringify(
      { recorded: true, source_skill: p.source_skill, detected_at: p.detected_at, inserted, updated, total: p.findings.length },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("findings-log failed:", err.message);
    process.exit(1);
  });

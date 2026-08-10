import { readFileSync } from "node:fs";
import { env } from "@/lib/env";
import type { NewClient, NewDecision } from "./schema";
import {
  upsertClient,
  resolveArticleId,
  insertDecisionIfAbsent,
  insertChangelogIfAbsent,
} from "./decisions-writes";
import { parseCsvLine } from "./store-helpers";

/**
 * Historical backfill (build plan Fase 1). Loads what we ALREADY KNOW into the
 * decision store so the Analyst is useful on day one instead of after 90 days,
 * and so the Decision Agent has a labeled eval set (Fase 3).
 *
 * INTEGRITY RULE (integritas-data-verihubs): every backfilled decision must carry
 * a real source in `provenance`. We only load facts that exist as data:
 *   - the client profile (from the engineering brief), and
 *   - the pillar designations (from the content-plan CSV `pillar_candidate` column).
 *
 * The named manual decisions the operator described (deepfake cluster
 * consolidation, the 19:1 backlink-equity finding, the 677-URL cannibalization
 * audit, the ~55% click-drop attribution) are NOT in this repo as data. They are
 * intentionally left as EMPTY, TYPED slots in NAMED_DECISIONS below rather than
 * filled from memory — filling them with recalled numbers would violate the
 * integrity rule and poison the eval set. Provide the source (or let the pipeline
 * regenerate them live from Ahrefs/GSC) and they drop straight in.
 */

const CSV_PATH = "SEO Article Verihubs - content-plan.csv";

interface CsvRow {
  url: string;
  topicCluster: string;
  batch: string;
  publishDate: string;
  pillarCandidate: string;
}

function readContentPlan(): CsvRow[] {
  const raw = readFileSync(CSV_PATH, "utf8").trim();
  const lines = raw.split(/\r?\n/);
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return lines.slice(1).map((l) => {
    const c = parseCsvLine(l);
    return {
      url: (c[idx.url] ?? "").trim(),
      topicCluster: (c[idx.topic_cluster] ?? "").trim(),
      batch: (c[idx.batch] ?? "").trim(),
      publishDate: (c[idx.publish_date] ?? "").trim(),
      pillarCandidate: (c[idx.pillar_candidate] ?? "").trim(),
    };
  });
}

/** Best-effort decision date from the plan row: publish_date, else batch's month. */
function decidedAtFrom(row: CsvRow): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(row.publishDate)) return row.publishDate;
  if (/^\d{4}-\d{2}$/.test(row.batch)) return `${row.batch}-01`;
  return "2025-10-01"; // earliest batch in the plan; documented fallback
}

// ── 1. Client profile (source: engineering brief) ─────────────────────────────
function verihubsClient(): NewClient {
  return {
    id: env.SITE_KEY, // "verihubs"
    name: "Verihubs",
    // Operator-defined (2026-08-10): leads over raw traffic.
    successDefinition:
      "Generate leads from organic + AI-search traffic (not raw pageviews).",
    // The skills that currently define the engagement scope.
    activeScope: [
      "content",
      "cannibalization-check",
      "site-audit",
      "link-health",
      "gsc-weekly-digest",
      "reporting",
    ],
    dataTier: "ahrefs-gsc-passthrough", // brief §3.2
    locale: "id-ID", // primary market; PH (en-PH) and EN also served
    // Off-strategy / high-traffic-but-no-lead terms to avoid targeting. NOTE:
    // several existing cannibalization findings sit on these terms — i.e. that
    // traffic is off-strategy, which reframes those merge verdicts.
    keywordBlacklist: ["otp", "ktp", "nokos", "wa"],
    publishPath: "wordpress", // seo-content-verihubs outputs WordPress-ready HTML
    approver: "Febiola", // human sign-off for gated actions
    active: true,
  };
}

// ── 2. Pillar designations (source: content-plan CSV) ─────────────────────────
async function backfillPillarDecisions(): Promise<{
  inserted: number;
  skipped: number;
}> {
  const site = env.SITE_KEY;
  const rows = readContentPlan().filter((r) => r.pillarCandidate && r.url);
  let inserted = 0;
  let skipped = 0;

  for (const r of rows) {
    const articleId = await resolveArticleId(r.url, site);
    const decision: NewDecision = {
      site,
      articleId,
      url: r.url,
      verdict: "leave",
      rationale: `Designated pillar page for the "${r.topicCluster}" cluster in the content plan; supporting cluster articles point to it.`,
      expectedImpact: "Consolidates topical authority for the cluster on one URL.",
      confidence: "0.9",
      status: "executed", // a standing, already-in-effect classification
      source: "human",
      producedBy: "manual:content-plan-csv",
      approvedBy: null,
      decidedAt: decidedAtFrom(r),
      provenance: {
        source: CSV_PATH,
        column: "pillar_candidate",
        topic_cluster: r.topicCluster,
        note: "Backfilled from the human-maintained content plan.",
      },
    };
    const res = await insertDecisionIfAbsent(decision);
    if (res.inserted) inserted++;
    else skipped++;
  }
  return { inserted, skipped };
}

// ── 2b. Deepfake cluster consolidation (source: operator ground-truth) ────────
/**
 * The actual historical consolidation (executed 2026-06-24, approver Febiola):
 * 9 articles merged into 4 survivors. This is GROUND TRUTH supplied by the
 * operator — the Fase 3 eval-set anchor for the Decision Agent (it must reproduce
 * these merge verdicts). Recorded as executed decisions, each with a linked
 * changelog row so the decision -> execution link is demonstrable.
 */
const DEEPFAKE_MERGE_DATE = "2026-06-24";
const DEEPFAKE_APPROVER = "Febiola";
const B = "https://verihubs.com/blog/";
const DEEPFAKE_MERGES: { from: string; into: string }[] = [
  { from: `${B}contoh-deepfake-ai-cara-identifikasi-dan-solusinya`, into: `${B}deepfake-pengertian-cara-kerja-ai-dan-cara-mencegahnya` },
  { from: `${B}apa-itu-deepfake`, into: `${B}deepfake-pengertian-cara-kerja-ai-dan-cara-mencegahnya` },
  { from: `${B}deepfake`, into: `${B}deepfake-pengertian-cara-kerja-ai-dan-cara-mencegahnya` },
  { from: `${B}mendeteksi-deepfake-dengan-deep-learning`, into: `${B}deteksi-video-palsu-ai` },
  { from: `${B}cara-deteksi-deepfake-untuk-cegah-penipuan-identitas-digital`, into: `${B}deteksi-video-palsu-ai` },
  { from: `${B}deepfake-adalah-ancaman-corporate-fraud-serius`, into: `${B}bagaimana-fintech-bisa-melindungi-nasabah-dari-deepfake-fraud` },
  { from: `${B}deepfake-bank-ancaman-keamanan-digital`, into: `${B}bagaimana-fintech-bisa-melindungi-nasabah-dari-deepfake-fraud` },
  { from: `${B}bahaya-deepfake-dalam-fintech`, into: `${B}bagaimana-fintech-bisa-melindungi-nasabah-dari-deepfake-fraud` },
  { from: `${B}penerapan-deepfake-dalam-berbagai-industri`, into: `${B}dampak-deepfake-keamanan-digital-privasi` },
];

async function backfillDeepfakeConsolidation(): Promise<{
  decisions: { inserted: number; skipped: number };
  changelog: { inserted: number; skipped: number };
}> {
  const site = env.SITE_KEY;
  let dIns = 0, dSkip = 0, cIns = 0, cSkip = 0;

  for (const m of DEEPFAKE_MERGES) {
    const articleId = await resolveArticleId(m.from, site);
    const decision: NewDecision = {
      site,
      articleId,
      url: m.from,
      verdict: "merge",
      rationale: `Merged/redirected into ${m.into} in the June 2026 deepfake cluster consolidation (9 articles -> 4 survivors) to end intra-cluster cannibalization and concentrate topical authority.`,
      expectedImpact: "Consolidate deepfake authority onto the surviving pillars; remove self-competition.",
      confidence: "1.0", // executed fact, not an estimate
      status: "executed",
      source: "human",
      producedBy: "manual:febiola",
      approvedBy: DEEPFAKE_APPROVER,
      decidedAt: DEEPFAKE_MERGE_DATE,
      provenance: {
        source: "operator-provided merge mapping",
        into_url: m.into,
        consolidation: "deepfake cluster, June 2026",
        note: "Fase 3 eval-set ground truth.",
      },
    };
    const dRes = await insertDecisionIfAbsent(decision);
    if (dRes.inserted) dIns++;
    else dSkip++;

    const cRes = await insertChangelogIfAbsent({
      site,
      articleId,
      url: m.from,
      action: "merged",
      decisionId: dRes.id, // link execution -> decision
      executedBy: "manual:febiola",
      executorKind: "human",
      approvedBy: DEEPFAKE_APPROVER,
      actionDate: DEEPFAKE_MERGE_DATE,
      hypothesis: "Reduce deepfake-cluster cannibalization; concentrate authority on 4 survivor pages.",
      detail: { redirect_to: m.into, consolidation: "deepfake cluster June 2026" },
    });
    if (cRes.inserted) cIns++;
    else cSkip++;
  }

  return {
    decisions: { inserted: dIns, skipped: dSkip },
    changelog: { inserted: cIns, skipped: cSkip },
  };
}

// ── 3. Named manual decisions — TYPED SLOTS, intentionally empty ──────────────
/**
 * Fill these ONLY from a real source (a saved skill output, a GSC/Ahrefs export,
 * or a fresh live pull). Each entry needs: the URLs involved, the decided date,
 * the approver, the numbers, and a `provenance` object citing where they came
 * from. See the report at the end of the backfill run for exactly what's missing.
 */
const NAMED_DECISIONS: NewDecision[] = [
  // DEEPFAKE CLUSTER CONSOLIDATION — needs: which of the 17 deepfake URLs merged
  //   into which pillar, the date, the approver. (Plan said "13"; CSV shows 17 —
  //   reconcile before recording.) verdict: "merge" per absorbed URL + "leave" for pillar.
  // 19:1 BACKLINK-EQUITY FINDING — needs: the two URLs + ref-domain counts and the
  //   Ahrefs query/date. verdict likely "refresh"/internal-link action on the starved side.
  // 677-URL CANNIBALIZATION AUDIT — needs: the cannibalization-check output JSON
  //   (set CANNIBALIZATION_SOURCE or paste the file). One row per merge/redirect pair.
  // ~55% CLICK-DROP ATTRIBUTION — needs: the GSC window compared + the conclusion
  //   ("AI Overview + March 2026 core update, not quality"). This is a site-level
  //   note, likely recorded as a changelog/analysis entry rather than a per-URL verdict.
];

async function backfillNamedDecisions(): Promise<{ inserted: number }> {
  let inserted = 0;
  for (const d of NAMED_DECISIONS) {
    const res = await insertDecisionIfAbsent(d);
    if (res.inserted) inserted++;
  }
  return { inserted };
}

export interface BackfillResult {
  ranAt: string;
  clientSeeded: string;
  pillarDecisions: { inserted: number; skipped: number };
  deepfakeConsolidation: {
    decisions: { inserted: number; skipped: number };
    changelog: { inserted: number; skipped: number };
  };
  namedDecisions: { inserted: number };
  pending: string[];
}

export async function runBackfill(): Promise<BackfillResult> {
  await upsertClient(verihubsClient());
  const pillarDecisions = await backfillPillarDecisions();
  const deepfakeConsolidation = await backfillDeepfakeConsolidation();
  const namedDecisions = await backfillNamedDecisions();

  return {
    ranAt: new Date().toISOString(),
    clientSeeded: env.SITE_KEY,
    pillarDecisions,
    deepfakeConsolidation,
    namedDecisions,
    pending: [
      // Backfill complete. Remaining historical findings (19:1, click-drop,
      // cannibalization) were regenerated live — see lib/db/regen-findings.ts.
    ],
  };
}

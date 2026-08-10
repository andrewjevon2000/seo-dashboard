import { env } from "@/lib/env";
import type { NewDecision, NewChangelogEntry } from "./schema";
import {
  resolveArticleId,
  insertDecisionIfAbsent,
  insertChangelogIfAbsent,
} from "./decisions-writes";

/**
 * Live-regenerated historical findings (build plan Fase 1 backfill, "regenerate
 * live" path). Unlike the pillar backfill, these are reconstructed from FRESH
 * Ahrefs/GSC pulls, so each carries the exact query + numbers + pull date in
 * `provenance`. They are recorded as status="proposed" — real diagnostic findings
 * awaiting the human gate — NOT as executed history.
 *
 * INTEGRITY: every number here came from a live API response on the pull date in
 * provenance. Nothing is from memory. When the operator confirms an action, the
 * status moves to approved and a changelog row records what was done.
 *
 * Populated incrementally as each finding is regenerated. Re-runnable (idempotent
 * via insertDecisionIfAbsent).
 */

const PULL_DATE = "2026-08-10";

const FINDINGS: NewDecision[] = [
  // ── Finding 1: backlink-equity concentration ("19:1") ──────────────────────
  {
    site: env.SITE_KEY,
    articleId: null, // resolved at insert time
    url: "https://verihubs.com/blog/lapor-rekening-penipuan",
    verdict: "refresh",
    rationale:
      "Backlink-equity concentration. lapor-rekening-penipuan holds 2,565 referring domains / 10,732 backlinks — ~18:1 vs the site's median top page (~140 refdomains) and the single largest link magnet on the domain — yet its own URL Rating is only 4.5 and it is a non-commercial informational page. The domain's link equity is trapped on a page that does not pass it to commercial KYC/fraud cluster pages. Action: redistribute via contextual internal links from this page to the money pages; do NOT prune (it is a major equity asset).",
    expectedImpact:
      "Lift URL Rating / rankings of linked commercial pages by channelling existing equity; no new link-building spend required.",
    confidence: "0.85",
    status: "proposed",
    source: "agent",
    producedBy: "regen:link-health-ahrefs",
    approvedBy: null,
    decidedAt: PULL_DATE,
    provenance: {
      tool: "site-explorer-pages-by-backlinks",
      params: {
        target: "verihubs.com",
        mode: "subdomains",
        order_by: "refdomains_target:desc",
        limit: 40,
      },
      pulled_at: PULL_DATE,
      units_cost: 320,
      figures: {
        target_refdomains: 2565,
        target_backlinks: 10732,
        target_url_rating: 4.5,
        second_page: { url: "https://verihubs.com/blog/slik-ojk", refdomains: 1567 },
        site_median_top40_refdomains: 142,
        concentration_ratio_vs_median: "~18:1",
      },
      note: "Reproduces the operator's earlier ~19:1 backlink-distribution finding with live data.",
    },
  },

  // ── Finding 4: cannibalization audit (scoped, ID market) ────────────────────
  // Source: site-explorer-organic-keywords, where serp_target_positions_count>=2
  // (i.e. 2+ Verihubs URLs rank for the keyword). Winner URL is known; the sibling
  // is inferred from topic (the API returns the top URL only), so confidence is
  // moderate and each needs per-pair SERP confirmation before execution.
  ...cannibalizationFinding(
    "https://verihubs.com/blog/7-penyedia-layanan-otp-terbaik-untuk-meningkatkan-keamanan-data-pelanggan",
    ["https://verihubs.com/blog/jasa-otp-sms-verihubs"],
    "OTP / jasa OTP (commercial intent). The listicle and the product page compete on the same commercial head terms — highest-value overlap in the audit. Decide one canonical commercial target and differentiate or merge the other.",
    [
      { kw: "jasa otp", volume: 15000, urls: 2 },
      { kw: "jasa otp wa", volume: 2400, urls: 4 },
      { kw: "login jasa otp", volume: 1700, urls: 2 },
      { kw: "sms otp", volume: 800, urls: 2 },
      { kw: "otp sms", volume: 600, urls: 2 },
    ],
    "0.6",
  ),
  ...cannibalizationFinding(
    "https://verihubs.com/blog/apa-itu-verifikasi",
    ["https://verihubs.com/blog/pengertian-verifikasi-data"],
    "Two generic 'verifikasi' explainer pages competing across the same definitional terms. Merge into one canonical explainer.",
    [
      { kw: "arti verifikasi", volume: 2600, urls: 2 },
      { kw: "verifikasi data adalah", volume: 900, urls: 3 },
      { kw: "contoh verifikasi", volume: 700, urls: 4 },
      { kw: "terverifikasi artinya", volume: 1200, urls: 2 },
    ],
    "0.7",
  ),
  ...cannibalizationFinding(
    "https://verihubs.com/blog/identitas-diri",
    ["https://verihubs.com/blog/jenis-jenis-identitas"],
    "'identitas diri' and 'jenis-jenis identitas' overlap heavily. identitas-diri already dominates most terms; consider absorbing the jenis-jenis angle as a section rather than a separate page.",
    [
      { kw: "identitas diri adalah", volume: 3500, urls: 3 },
      { kw: "identitas diri apa saja", volume: 1200, urls: 4 },
      { kw: "sebutkan jenis identitas individu dan identitas kelompok", volume: 5200, urls: 3 },
    ],
    "0.65",
  ),
  ...cannibalizationFinding(
    "https://verihubs.com/blog/biometrik-pengertian-jenis-cara-kerja-dan-manfaat",
    ["https://verihubs.com/blog/sensor-biometrik"],
    "Two biometrik pages both ranking for the head term 'biometrik'. Consolidate into the pillar; keep sensor-biometrik only if it targets a distinct sub-intent. (face-recognition cluster — a scoped risk cluster.)",
    [
      { kw: "biometrik", volume: 2200, urls: 2 },
      { kw: "apa itu biometrik", volume: 1300, urls: 2 },
    ],
    "0.7",
  ),
  ...cannibalizationFinding(
    "https://verihubs.com/blog/contoh-password-yang-kuat",
    [
      "https://verihubs.com/blog/contoh-kata-sandi-6-karakter",
      "https://verihubs.com/blog/contoh-kata-sandi-8-karakter",
    ],
    "Three near-duplicate 'contoh password / kata sandi' pages splitting the same intent by character count. Consolidate into one page with sections per length.",
    [
      { kw: "contoh password", volume: 2200, urls: 2 },
      { kw: "contoh kata sandi", volume: 1400, urls: 3 },
      { kw: "contoh password 8 karakter huruf dan angka", volume: 1200, urls: 2 },
    ],
    "0.65",
  ),
];

/** Build a proposed `merge` decision from a cannibalization overlap group. */
function cannibalizationFinding(
  anchorUrl: string,
  overlappingUrls: string[],
  rationale: string,
  evidence: { kw: string; volume: number; urls: number }[],
  confidence: string,
): NewDecision[] {
  return [
    {
      site: env.SITE_KEY,
      articleId: null,
      url: anchorUrl,
      verdict: "merge",
      rationale,
      expectedImpact:
        "Ends self-competition on shared terms; consolidates ranking signals onto one URL (typically lifts the surviving page's position + CTR).",
      confidence,
      status: "proposed",
      source: "agent",
      producedBy: "regen:cannibalization-ahrefs",
      approvedBy: null,
      decidedAt: PULL_DATE,
      provenance: {
        tool: "site-explorer-organic-keywords",
        params: {
          target: "verihubs.com",
          mode: "subdomains",
          country: "id",
          date: "2026-08-01",
          where: "serp_target_positions_count>=2 AND best_position<=50",
        },
        pulled_at: PULL_DATE,
        anchor_url: anchorUrl,
        overlapping_urls: overlappingUrls,
        cannibalized_keywords: evidence,
        caveat:
          "API returns the winning URL per keyword only; sibling URLs inferred from topic. Confirm exact competitors via per-keyword SERP before executing the merge.",
      },
    },
  ];
}

// ── Site-level events (recorded in changelog for Analyst attribution) ─────────
/**
 * Not per-URL verdicts — external events the Analyst attributes traffic movements
 * to. The changelog is the right home: it records "what happened" so up/down
 * movements get a cause (build plan: the changelog is what makes results compound).
 */
const EVENTS: NewChangelogEntry[] = [
  // ── Finding: ~56% organic click decline attributed to March 2026 core update ──
  {
    site: env.SITE_KEY,
    articleId: null,
    url: "https://verihubs.com/",
    action: "other",
    executedBy: "regen:analyst-gsc",
    executorKind: "agent",
    approvedBy: null,
    actionDate: "2026-03-01", // core-update month the decline centres on
    hypothesis:
      "~56% organic click decline (ID market): mid-2025 baseline ~62,600 clicks/mo (Jul 2025) fell to ~27,472 by Mar 2026. Attributed to the Google March 2026 core update + AI Overview expansion, NOT content quality. Evidence: over the same window average position IMPROVED (11.9 -> 5.5) while CTR halved (1.92% -> ~1.0%) — pages rank better but are clicked less, the AI-Overview signature. A quality/relevance problem would have worsened position, not improved it.",
    detail: {
      tool: "gsc-performance-history",
      params: { project_id: 7370283, date_from: "2025-05-01", date_to: "2026-07-31", history_grouping: "monthly" },
      pulled_at: PULL_DATE,
      units_cost: 0,
      baseline: { month: "2025-07", clicks: 62567, ctr: 1.9181, position: 11.28 },
      core_update: { month: "2026-03", clicks: 27472, ctr: 1.1017, position: 5.46 },
      pct_change_clicks: -0.561,
      caveat:
        "Jun->Jul 2026 (21,361 -> 8,596 clicks; impressions 1.78M -> 656K) is far steeper than the core-update trend and looks anomalous/possibly incomplete — flagged for separate investigation, excluded from the headline figure.",
    },
  },
];

export async function recordFindings(): Promise<{
  decisions: { inserted: number; skipped: number; urls: string[] };
  events: { inserted: number; skipped: number };
}> {
  let inserted = 0;
  let skipped = 0;
  const urls: string[] = [];
  for (const f of FINDINGS) {
    const articleId = f.articleId ?? (await resolveArticleId(f.url, f.site ?? env.SITE_KEY));
    const res = await insertDecisionIfAbsent({ ...f, articleId });
    if (res.inserted) {
      inserted++;
      urls.push(f.url);
    } else skipped++;
  }

  let evInserted = 0;
  let evSkipped = 0;
  for (const e of EVENTS) {
    const articleId = e.articleId ?? (await resolveArticleId(e.url, e.site ?? env.SITE_KEY));
    const res = await insertChangelogIfAbsent({ ...e, articleId });
    if (res.inserted) evInserted++;
    else evSkipped++;
  }

  return {
    decisions: { inserted, skipped, urls },
    events: { inserted: evInserted, skipped: evSkipped },
  };
}

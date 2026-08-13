import { env } from "@/lib/env";
import { readContentPlan } from "./sheet";
import { pullGscPages, pullGscPageHistory, getCreditRemaining } from "./ahrefs";
import { pullGa4Pages, pullGa4History } from "./ga4";
import { pullWebAnalyticsPages } from "./web-analytics";
import {
  upsertArticles,
  insertGscSnapshots,
  insertGa4Snapshots,
  insertWebAnalyticsSnapshots,
  buildPathToId,
} from "@/lib/db/pipeline-writes";
import type { PipelineRunResult, Ga4PageMetrics } from "./types";

/**
 * One weekly pipeline run (brief §5). Steps:
 *   1. Read content plan → article list
 *   2. Credit guard: check remaining Ahrefs units, short-circuit if too low
 *   3. Pull GSC per-page metrics for the period (single call)
 *   4. Upsert articles
 *   5. Append snapshots (never overwrite)
 *
 * The credit guard exists because the Ahrefs key shares a unit pool with the
 * monthly seo-report-verihubs skill; a weekly job must not silently drain it.
 */

/** Compute a [from, to] window ending `end` (inclusive), `days` wide. */
function windowEnding(end: string, days: number): { from: string; to: string } {
  const to = new Date(end + "T00:00:00Z");
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: from.toISOString().slice(0, 10), to: end };
}

export interface RunOptions {
  /** Snapshot end date (YYYY-MM-DD). Caller supplies it — no Date.now here. */
  periodEnd: string;
  /** Window width in days for the GSC aggregate (default 7, weekly cadence). */
  windowDays?: number;
}

export async function runWeeklyPull(opts: RunOptions): Promise<PipelineRunResult> {
  const notes: string[] = [];
  const { from, to } = windowEnding(opts.periodEnd, opts.windowDays ?? 7);

  // 1. Content plan
  const { rows, clusterColumnPresent } = await readContentPlan();
  notes.push(`Read ${rows.length} plan rows (cluster column ${clusterColumnPresent ? "present" : "absent"}).`);

  // 2. Credit guard
  const creditRemaining = await getCreditRemaining();
  if (
    env.AHREFS_CREDIT_THRESHOLD > 0 &&
    creditRemaining != null &&
    creditRemaining < env.AHREFS_CREDIT_THRESHOLD
  ) {
    notes.push(
      `SKIPPED pull: Ahrefs units remaining (${creditRemaining}) below threshold (${env.AHREFS_CREDIT_THRESHOLD}). Shared with seo-report-verihubs.`,
    );
    return {
      ranAt: opts.periodEnd,
      articlesUpserted: 0,
      snapshotsInserted: 0,
      snapshotsSkipped: 0,
      ga4SnapshotsInserted: 0,
      ga4SnapshotsSkipped: 0,
      waSnapshotsInserted: 0,
      waSnapshotsSkipped: 0,
      clusterColumnPresent,
      ahrefsCreditRemaining: creditRemaining,
      skipped: true,
      notes,
    };
  }
  if (creditRemaining != null) notes.push(`Ahrefs units remaining: ${creditRemaining}.`);

  // 4. Upsert articles (do this before snapshots so FKs resolve)
  const { urlToId, upserted } = await upsertArticles(rows, clusterColumnPresent);

  // 3. Pull GSC for the period
  const pages = await pullGscPages(from, to);
  notes.push(`Pulled ${pages.length} GSC page rows for ${from}..${to}.`);

  // 5. Append GSC snapshots
  const { inserted, skipped, unmatched } = await insertGscSnapshots(pages, urlToId);
  if (unmatched > 0) notes.push(`${unmatched} GSC pages had no matching plan article (skipped).`);

  // 6. GA4 step (Phase 2) — additive, same append pattern, isolated from GSC.
  const ga4 = await runGa4Step(() => pullGa4Pages(from, to), urlToId, notes);

  // 7. Web Analytics step (path 3) — measured on-site traffic, URL-joined like GSC.
  const wa = await runWebAnalyticsStep(from, to, urlToId, notes);

  return {
    ranAt: opts.periodEnd,
    articlesUpserted: upserted,
    snapshotsInserted: inserted,
    snapshotsSkipped: skipped,
    ga4SnapshotsInserted: ga4.inserted,
    ga4SnapshotsSkipped: ga4.skipped,
    waSnapshotsInserted: wa.inserted,
    waSnapshotsSkipped: wa.skipped,
    clusterColumnPresent,
    ahrefsCreditRemaining: creditRemaining,
    skipped: false,
    notes,
  };
}

/**
 * Web Analytics pull+append step. Runs when configured (or fixtures on). Measured
 * data is FREE (0 units) and needs no GA4/client access, but it sits after the
 * credit guard for code simplicity, so a credit-guard skip also skips it.
 * Never throws — a measured-traffic hiccup must not break the core GSC job.
 */
async function runWebAnalyticsStep(
  from: string,
  to: string,
  urlToId: Map<string, string>,
  notes: string[],
): Promise<{ inserted: number; skipped: number }> {
  if (!env.useFixtures && !env.webAnalyticsConfigured) {
    notes.push("Web Analytics not configured — skipped.");
    return { inserted: 0, skipped: 0 };
  }
  try {
    const metrics = await pullWebAnalyticsPages(from, to);
    const { inserted, skipped, unmatched } = await insertWebAnalyticsSnapshots(metrics, urlToId);
    notes.push(
      `Web Analytics: pulled ${metrics.length} entry pages, inserted ${inserted}, skipped ${skipped}${
        unmatched ? `, ${unmatched} unmatched` : ""
      }${env.webAnalyticsOrganicOnly ? " (organic-only)" : ""}.`,
    );
    return { inserted, skipped };
  } catch (err) {
    notes.push(`Web Analytics step failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    return { inserted: 0, skipped: 0 };
  }
}

/**
 * Shared GA4 pull+append step. Runs only when GA4 is configured (or fixtures are
 * on). Never throws to the caller — GA4 is Phase 2 and must not break the core
 * GSC job if the property/service account is misconfigured.
 */
async function runGa4Step(
  pull: () => Promise<Ga4PageMetrics[]>,
  urlToId: Map<string, string>,
  notes: string[],
): Promise<{ inserted: number; skipped: number }> {
  if (!env.useFixtures && !env.ga4Configured) {
    notes.push("GA4 not configured — skipped (Phase 2).");
    return { inserted: 0, skipped: 0 };
  }
  try {
    const metrics = await pull();
    const pathToId = buildPathToId(urlToId);
    const { inserted, skipped, unmatched } = await insertGa4Snapshots(metrics, pathToId);
    notes.push(
      `GA4: pulled ${metrics.length} page rows, inserted ${inserted}, skipped ${skipped}${
        unmatched ? `, ${unmatched} unmatched` : ""
      }${env.ga4OrganicOnly ? " (organic-search only)" : ""}.`,
    );
    return { inserted, skipped };
  } catch (err) {
    notes.push(`GA4 step failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    return { inserted: 0, skipped: 0 };
  }
}

export interface BackfillOptions {
  dateFrom: string;
  dateTo: string;
  grouping?: "daily" | "weekly" | "monthly";
}

/**
 * One-time historical backfill via per-URL history. CREDIT-HEAVY — invoke
 * deliberately (CLI), not on a schedule. Seeds trend history so the dashboard
 * isn't empty on day one, before weekly accumulation takes over.
 */
export async function runBackfill(opts: BackfillOptions): Promise<PipelineRunResult> {
  const notes: string[] = [];
  const { rows, clusterColumnPresent } = await readContentPlan();
  const { urlToId, upserted } = await upsertArticles(rows, clusterColumnPresent);

  const urls = [...urlToId.keys()];
  const history = await pullGscPageHistory(urls, opts.dateFrom, opts.dateTo, opts.grouping ?? "weekly");
  notes.push(`Backfill pulled ${history.length} historical rows for ${urls.length} URLs.`);

  const { inserted, skipped, unmatched } = await insertGscSnapshots(history, urlToId);
  if (unmatched > 0) notes.push(`${unmatched} history rows had no matching plan article.`);

  // GA4 historical backfill (fixtures-only for live; see ga4.pullGa4History).
  const ga4 = await runGa4Step(
    () => pullGa4History(opts.dateFrom, opts.dateTo),
    urlToId,
    notes,
  );

  return {
    ranAt: opts.dateTo,
    articlesUpserted: upserted,
    snapshotsInserted: inserted,
    snapshotsSkipped: skipped,
    ga4SnapshotsInserted: ga4.inserted,
    ga4SnapshotsSkipped: ga4.skipped,
    // Web Analytics accumulates via the weekly pull, not the historical backfill.
    waSnapshotsInserted: 0,
    waSnapshotsSkipped: 0,
    clusterColumnPresent,
    ahrefsCreditRemaining: await getCreditRemaining(),
    skipped: false,
    notes,
  };
}

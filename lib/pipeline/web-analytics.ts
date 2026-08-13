import { env } from "@/lib/env";
import { get } from "./ahrefs";
import type { WebAnalyticsPageMetrics } from "./types";
import { fixtureWebAnalyticsPages } from "./fixtures";

/**
 * Ahrefs Web Analytics — MEASURED on-site traffic per entry page (path 3).
 *
 * Uses the same AHREFS_API_KEY + AHREFS_PROJECT_ID as the GSC pull, so it needs
 * NO GA4 property access / client admin — the fallback when GA4 can't be granted.
 * entry_page visitors are the measured counterpart to GSC clicks (both are
 * organic landings when WEB_ANALYTICS_ORGANIC_ONLY is on), so they align with the
 * existing per-page snapshots and join by URL exactly like GSC.
 *
 * PROVENANCE: measured (on-site Ahrefs Analytics tag), NOT an Ahrefs estimate and
 * NOT GA4. Stored under source='web_analytics' so it is never conflated with GSC
 * or a modelled figure (brief §3.4: label the source of every number).
 *
 * Cost: 0 API units (Web Analytics endpoints are free).
 */

/** Optional organic-search-only filter so measured traffic lines up with GSC. */
function organicWhere(): string | undefined {
  if (!env.webAnalyticsOrganicOnly) return undefined;
  return JSON.stringify({ field: "source_channel", is: ["eq", "search"] });
}

/**
 * Pull measured per-entry-page metrics for [dateFrom, dateTo], stamped with the
 * snapshot date (dateTo) so rows align with the GSC snapshot for the same period.
 */
export async function pullWebAnalyticsPages(
  dateFrom: string,
  dateTo: string,
): Promise<WebAnalyticsPageMetrics[]> {
  if (env.useFixtures) return fixtureWebAnalyticsPages(dateTo);

  const data = await get<{
    stats: Array<{
      entry_page: string;
      visitors: number | string | null;
      entries: number | string | null;
      avg_session_duration_sec: number | null;
    }>;
  }>("/web-analytics/entry-pages", {
    project_id: env.AHREFS_PROJECT_ID,
    from: dateFrom,
    to: dateTo,
    where: organicWhere(),
    order_by: "visitors:desc",
    limit: 1000,
  });

  return (data.stats ?? [])
    .filter((s) => s.entry_page)
    .map((s) => ({
      url: s.entry_page,
      date: dateTo,
      // Ahrefs returns visitors/entries as strings — cast before arithmetic.
      visitors: Number(s.visitors ?? 0),
      entries: Number(s.entries ?? 0),
      avgSessionDurationSec: Number(s.avg_session_duration_sec ?? 0),
    }));
}

import { sql } from "drizzle-orm";
import { db } from "./client";
import { articles, performanceSnapshots } from "./schema";
import type { PlanRow, GscPageMetrics, Ga4PageMetrics, WebAnalyticsPageMetrics } from "@/lib/pipeline/types";
import { normalizeUrl, normalizePath, pathOf } from "@/lib/pipeline/normalize";
import { env } from "@/lib/env";

/**
 * Pipeline write operations. Two invariants (brief §4, §5):
 *   1. `articles` is UPSERTED on (site, url) — new articles appear as the plan grows.
 *   2. `performance_snapshots` is APPEND-ONLY — inserts use ON CONFLICT DO NOTHING
 *      against the (article_id, source, metric_name, date) unique index, so a
 *      re-run never overwrites history. There is deliberately no UPDATE path here.
 */

/**
 * Upsert plan rows into `articles`. Returns a map of normalized URL → article id
 * for the caller to attach snapshots to.
 *
 * `clusterColumnPresent` guards topic_cluster writes: when the sheet has no
 * Cluster column we must NOT clobber any previously-backfilled value with NULL.
 */
export async function upsertArticles(
  rows: PlanRow[],
  clusterColumnPresent: boolean,
): Promise<{ urlToId: Map<string, string>; upserted: number }> {
  const site = env.SITE_KEY;
  const urlToId = new Map<string, string>();
  if (rows.length === 0) return { urlToId, upserted: 0 };

  const values = rows.map((r) => ({
    url: normalizeUrl(r.url),
    keyword: r.keyword,
    site,
    batch: r.batch,
    contentType: r.contentType,
    topicCluster: r.topicCluster,
    publishDate: r.publishDate,
  }));

  // Deduplicate on normalized URL within this batch (sheet may list dupes).
  const seen = new Map<string, (typeof values)[number]>();
  for (const v of values) if (v.url) seen.set(v.url, v);
  const deduped = [...seen.values()];

  const returned = await db
    .insert(articles)
    .values(deduped)
    .onConflictDoUpdate({
      target: [articles.site, articles.url],
      set: {
        keyword: sql`excluded.keyword`,
        batch: sql`excluded.batch`,
        contentType: sql`excluded.content_type`,
        // Keep an existing publish_date if the sheet cell is blank.
        publishDate: sql`coalesce(excluded.publish_date, ${articles.publishDate})`,
        // Only overwrite topic_cluster when the sheet actually provides the column;
        // otherwise keep whatever is already stored (COALESCE keeps existing).
        topicCluster: clusterColumnPresent
          ? sql`excluded.topic_cluster`
          : sql`coalesce(${articles.topicCluster}, excluded.topic_cluster)`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: articles.id, url: articles.url });

  for (const row of returned) urlToId.set(row.url, row.id);
  return { urlToId, upserted: returned.length };
}

const GSC_METRICS = ["clicks", "impressions", "ctr", "position"] as const;

/**
 * Append GSC metrics as long-form snapshot rows. Returns inserted vs skipped
 * (skipped = row already existed for that article/source/metric/date).
 */
export async function insertGscSnapshots(
  metrics: GscPageMetrics[],
  urlToId: Map<string, string>,
): Promise<{ inserted: number; skipped: number; unmatched: number }> {
  const rows: {
    articleId: string;
    date: string;
    source: "gsc";
    metricName: string;
    metricValue: string;
  }[] = [];
  let unmatched = 0;

  for (const m of metrics) {
    const id = urlToId.get(normalizeUrl(m.url));
    if (!id) {
      // GSC page not in the content plan — expected (e.g. non-article pages).
      unmatched++;
      continue;
    }
    for (const name of GSC_METRICS) {
      rows.push({
        articleId: id,
        date: m.date,
        source: "gsc",
        metricName: name,
        metricValue: String(m[name]),
      });
    }
  }

  return appendSnapshotRows(rows, unmatched);
}

/**
 * Build a normalized-path → article id map so GA4 pagePaths can join to articles
 * whose stored `url` is a full normalized URL (brief §3.4 URL-key mismatch).
 * If two articles share a path (shouldn't happen single-site), last wins.
 */
export function buildPathToId(urlToId: Map<string, string>): Map<string, string> {
  const pathToId = new Map<string, string>();
  for (const [url, id] of urlToId) pathToId.set(pathOf(url), id);
  return pathToId;
}

const GA4_METRIC_FIELDS = [
  ["sessions", "sessions"],
  ["engaged_sessions", "engagedSessions"],
  ["engagement_time", "engagementTime"],
] as const;

/** Append GA4 metrics as long-form snapshot rows (source='ga4'), append-only. */
export async function insertGa4Snapshots(
  metrics: Ga4PageMetrics[],
  pathToId: Map<string, string>,
): Promise<{ inserted: number; skipped: number; unmatched: number }> {
  const rows: {
    articleId: string;
    date: string;
    source: "ga4";
    metricName: string;
    metricValue: string;
  }[] = [];
  let unmatched = 0;

  for (const m of metrics) {
    const id = pathToId.get(normalizePath(m.path));
    if (!id) {
      unmatched++;
      continue;
    }
    for (const [metricName, field] of GA4_METRIC_FIELDS) {
      rows.push({ articleId: id, date: m.date, source: "ga4", metricName, metricValue: String(m[field]) });
    }
    // cta_clicks only when tracked (null = event not configured → don't store).
    if (m.ctaClicks != null) {
      rows.push({ articleId: id, date: m.date, source: "ga4", metricName: "cta_clicks", metricValue: String(m.ctaClicks) });
    }
  }

  if (rows.length === 0) return { inserted: 0, skipped: 0, unmatched };
  const { inserted, skipped } = await appendSnapshotRows(rows, unmatched);
  return { inserted, skipped, unmatched };
}

const WA_METRIC_FIELDS = [
  ["visitors", "visitors"],
  ["entries", "entries"],
  ["avg_session_duration", "avgSessionDurationSec"],
] as const;

/**
 * Append Ahrefs Web Analytics MEASURED metrics as long-form snapshot rows
 * (source='web_analytics'), append-only. Joins by URL exactly like GSC (entry_page
 * is a full URL). Kept as a distinct source so measured traffic is never conflated
 * with the GSC estimate (brief §3.4).
 */
export async function insertWebAnalyticsSnapshots(
  metrics: WebAnalyticsPageMetrics[],
  urlToId: Map<string, string>,
): Promise<{ inserted: number; skipped: number; unmatched: number }> {
  const rows: {
    articleId: string;
    date: string;
    source: "web_analytics";
    metricName: string;
    metricValue: string;
  }[] = [];
  let unmatched = 0;

  for (const m of metrics) {
    const id = urlToId.get(normalizeUrl(m.url));
    if (!id) {
      // Entry page not in the content plan (e.g. /product/*, homepage) — expected.
      unmatched++;
      continue;
    }
    for (const [metricName, field] of WA_METRIC_FIELDS) {
      rows.push({ articleId: id, date: m.date, source: "web_analytics", metricName, metricValue: String(m[field]) });
    }
  }

  if (rows.length === 0) return { inserted: 0, skipped: 0, unmatched };
  return appendSnapshotRows(rows, unmatched);
}

/** Shared append helper — chunked insert with append-only ON CONFLICT DO NOTHING. */
async function appendSnapshotRows(
  rows: { articleId: string; date: string; source: "gsc" | "ga4" | "web_analytics"; metricName: string; metricValue: string }[],
  unmatched: number,
): Promise<{ inserted: number; skipped: number; unmatched: number }> {
  let inserted = 0;
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const returned = await db
      .insert(performanceSnapshots)
      .values(chunk)
      .onConflictDoNothing({
        target: [
          performanceSnapshots.articleId,
          performanceSnapshots.source,
          performanceSnapshots.metricName,
          performanceSnapshots.date,
        ],
      })
      .returning({ id: performanceSnapshots.id });
    inserted += returned.length;
  }
  return { inserted, skipped: rows.length - inserted, unmatched };
}

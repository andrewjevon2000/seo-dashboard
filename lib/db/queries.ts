import { and, eq, inArray, sql, asc, isNotNull } from "drizzle-orm";
import { db } from "./client";
import { articles, performanceSnapshots } from "./schema";
import { env } from "@/lib/env";
import { isDeclining, isCtrMismatch } from "@/lib/flags/compute";
import { loadCannibalization } from "@/lib/flags/cannibalization";

/**
 * Read layer for the two v1 views (brief §6). At single-site scale (hundreds of
 * articles, weekly snapshots) we pull the relevant snapshot rows and pivot/derive
 * in TypeScript rather than in heavy window-function SQL — clearer and plenty
 * fast. Everything is filter-aware: aggregates recompute for the active filter,
 * which is the point of the filter (cluster-level trend comparison, §6).
 */

const GSC_METRICS = ["clicks", "impressions", "ctr", "position"] as const;
type GscMetric = (typeof GSC_METRICS)[number];

export interface ArticleListFilters {
  contentType?: string | null; // "pillar" | "cluster" | null (=all)
  topicCluster?: string | null; // exact cluster value or null (=all)
}

export interface MetricPoint {
  date: string;
  value: number;
}

export interface ArticleRow {
  id: string;
  url: string;
  keyword: string | null;
  contentType: string | null;
  topicCluster: string | null;
  latest: Record<GscMetric, number | null>;
  previous: Record<GscMetric, number | null>;
  clicksSparkline: MetricPoint[];
  impressionsSparkline: MetricPoint[];
  flags: {
    declining: boolean;
    ctrMismatch: boolean;
    cannibalization: boolean;
    cannibalizationNote?: string;
  };
}

export interface AggregateSummary {
  articleCount: number;
  totalClicks: number;
  totalClicksPrev: number;
  totalImpressions: number;
  totalImpressionsPrev: number;
  avgCtr: number; // derived: clicks / impressions
  avgPosition: number | null; // impression-weighted
  // Cluster-level trend: summed clicks/impressions per snapshot date.
  series: { date: string; clicks: number; impressions: number }[];
}

export interface ArticleListResult {
  rows: ArticleRow[];
  aggregates: AggregateSummary;
  topicClusterFilterAvailable: boolean;
  cannibalizationAvailable: boolean;
}

/** Distinct non-null topic clusters — powers the filter options dynamically. */
export async function getDistinctTopicClusters(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ tc: articles.topicCluster })
    .from(articles)
    .where(and(eq(articles.site, env.SITE_KEY), isNotNull(articles.topicCluster)))
    .orderBy(asc(articles.topicCluster));
  return rows.map((r) => r.tc).filter((v): v is string => !!v);
}

function emptyMetricRecord(): Record<GscMetric, number | null> {
  return { clicks: null, impressions: null, ctr: null, position: null };
}

export async function getArticleList(filters: ArticleListFilters = {}): Promise<ArticleListResult> {
  // 1. Filter articles.
  const conds = [eq(articles.site, env.SITE_KEY)];
  if (filters.contentType) {
    conds.push(sql`lower(${articles.contentType}) = ${filters.contentType.toLowerCase()}`);
  }
  if (filters.topicCluster) {
    conds.push(eq(articles.topicCluster, filters.topicCluster));
  }

  const arts = await db
    .select({
      id: articles.id,
      url: articles.url,
      keyword: articles.keyword,
      contentType: articles.contentType,
      topicCluster: articles.topicCluster,
    })
    .from(articles)
    .where(and(...conds))
    .orderBy(asc(articles.url));

  const clusterAvailable = (await getDistinctTopicClusters()).length > 0;
  const canni = await loadCannibalization();

  if (arts.length === 0) {
    return {
      rows: [],
      aggregates: emptyAggregates(),
      topicClusterFilterAvailable: clusterAvailable,
      cannibalizationAvailable: canni.available,
    };
  }

  // 2. Pull all GSC snapshots for these articles, ordered by date.
  const ids = arts.map((a) => a.id);
  const snaps = await db
    .select({
      articleId: performanceSnapshots.articleId,
      date: performanceSnapshots.date,
      metricName: performanceSnapshots.metricName,
      metricValue: performanceSnapshots.metricValue,
    })
    .from(performanceSnapshots)
    .where(
      and(
        inArray(performanceSnapshots.articleId, ids),
        eq(performanceSnapshots.source, "gsc"),
        inArray(performanceSnapshots.metricName, [...GSC_METRICS]),
      ),
    )
    .orderBy(asc(performanceSnapshots.date));

  // 3. Pivot into per-article, per-metric ordered series.
  type Series = Record<GscMetric, MetricPoint[]>;
  const byArticle = new Map<string, Series>();
  for (const id of ids) {
    byArticle.set(id, { clicks: [], impressions: [], ctr: [], position: [] });
  }
  for (const s of snaps) {
    const series = byArticle.get(s.articleId);
    if (!series) continue;
    const name = s.metricName as GscMetric;
    if (!GSC_METRICS.includes(name)) continue;
    series[name].push({ date: s.date, value: Number(s.metricValue) });
  }

  // 4. Build rows + flags.
  const rows: ArticleRow[] = arts.map((a) => {
    const series = byArticle.get(a.id)!;
    const latest = emptyMetricRecord();
    const previous = emptyMetricRecord();
    for (const m of GSC_METRICS) {
      const arr = series[m];
      latest[m] = arr.length ? arr[arr.length - 1].value : null;
      previous[m] = arr.length > 1 ? arr[arr.length - 2].value : null;
    }
    const canniEntry = canni.map.get(a.url);
    return {
      id: a.id,
      url: a.url,
      keyword: a.keyword,
      contentType: a.contentType,
      topicCluster: a.topicCluster,
      latest,
      previous,
      clicksSparkline: series.clicks,
      impressionsSparkline: series.impressions,
      flags: {
        declining: isDeclining(series.clicks.map((p) => p.value)),
        ctrMismatch:
          latest.position != null && latest.ctr != null
            ? isCtrMismatch(latest.position, latest.ctr)
            : false,
        cannibalization: canniEntry?.risk ?? false,
        cannibalizationNote: canniEntry?.note,
      },
    };
  });

  return {
    rows,
    aggregates: computeAggregates(rows),
    topicClusterFilterAvailable: clusterAvailable,
    cannibalizationAvailable: canni.available,
  };
}

function emptyAggregates(): AggregateSummary {
  return {
    articleCount: 0,
    totalClicks: 0,
    totalClicksPrev: 0,
    totalImpressions: 0,
    totalImpressionsPrev: 0,
    avgCtr: 0,
    avgPosition: null,
    series: [],
  };
}

function computeAggregates(rows: ArticleRow[]): AggregateSummary {
  let totalClicks = 0;
  let totalClicksPrev = 0;
  let totalImpressions = 0;
  let totalImpressionsPrev = 0;
  let posWeightSum = 0;
  let posWeight = 0;

  // Aggregate cluster-level series: sum clicks/impressions across articles per date.
  const seriesMap = new Map<string, { clicks: number; impressions: number }>();

  for (const r of rows) {
    totalClicks += r.latest.clicks ?? 0;
    totalClicksPrev += r.previous.clicks ?? 0;
    totalImpressions += r.latest.impressions ?? 0;
    totalImpressionsPrev += r.previous.impressions ?? 0;
    if (r.latest.position != null && (r.latest.impressions ?? 0) > 0) {
      posWeightSum += r.latest.position * (r.latest.impressions as number);
      posWeight += r.latest.impressions as number;
    }
    // Fold each article's clicks & impressions series onto shared dates.
    for (const p of r.clicksSparkline) {
      const cur = seriesMap.get(p.date) ?? { clicks: 0, impressions: 0 };
      cur.clicks += p.value;
      seriesMap.set(p.date, cur);
    }
    for (const p of r.impressionsSparkline) {
      const cur = seriesMap.get(p.date) ?? { clicks: 0, impressions: 0 };
      cur.impressions += p.value;
      seriesMap.set(p.date, cur);
    }
  }

  const series = [...seriesMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, v]) => ({ date, clicks: v.clicks, impressions: v.impressions }));

  return {
    articleCount: rows.length,
    totalClicks,
    totalClicksPrev,
    totalImpressions,
    totalImpressionsPrev,
    avgCtr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
    avgPosition: posWeight > 0 ? posWeightSum / posWeight : null,
    series,
  };
}

// ── Article detail ───────────────────────────────────────────────────────────

const GA4_METRICS = ["sessions", "engaged_sessions", "engagement_time", "cta_clicks"] as const;
type Ga4Metric = (typeof GA4_METRICS)[number];

/**
 * A single funnel stage. `source` labels which system produced it, because GSC
 * (search-side) and GA4 (site-side) numbers use different methodology and never
 * reconcile exactly (brief §3.4) — they must never be shown as directly
 * comparable without a source label. `available: false` marks a stage that has
 * no data yet (e.g. CTA clicks pending the GTM event, §3.3).
 */
export interface FunnelStage {
  key: string;
  label: string;
  source: "gsc" | "ga4";
  value: number | null;
  available: boolean;
}

export interface ArticleDetail {
  id: string;
  url: string;
  keyword: string | null;
  contentType: string | null;
  topicCluster: string | null;
  batch: string | null;
  publishDate: string | null;
  series: Record<GscMetric, MetricPoint[]>;
  ga4Series: Record<Ga4Metric, MetricPoint[]>;
  hasGa4: boolean;
  funnel: FunnelStage[];
}

function lastVal(points: MetricPoint[]): number | null {
  return points.length ? points[points.length - 1].value : null;
}

export async function getArticleDetail(id: string): Promise<ArticleDetail | null> {
  const [a] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, id), eq(articles.site, env.SITE_KEY)))
    .limit(1);
  if (!a) return null;

  // Pull both sources in one query; split by source below.
  const snaps = await db
    .select({
      source: performanceSnapshots.source,
      date: performanceSnapshots.date,
      metricName: performanceSnapshots.metricName,
      metricValue: performanceSnapshots.metricValue,
    })
    .from(performanceSnapshots)
    .where(eq(performanceSnapshots.articleId, id))
    .orderBy(asc(performanceSnapshots.date));

  const series: Record<GscMetric, MetricPoint[]> = { clicks: [], impressions: [], ctr: [], position: [] };
  const ga4Series: Record<Ga4Metric, MetricPoint[]> = {
    sessions: [],
    engaged_sessions: [],
    engagement_time: [],
    cta_clicks: [],
  };

  for (const s of snaps) {
    const point = { date: s.date, value: Number(s.metricValue) };
    if (s.source === "gsc" && GSC_METRICS.includes(s.metricName as GscMetric)) {
      series[s.metricName as GscMetric].push(point);
    } else if (s.source === "ga4" && GA4_METRICS.includes(s.metricName as Ga4Metric)) {
      ga4Series[s.metricName as Ga4Metric].push(point);
    }
  }

  const hasGa4 = GA4_METRICS.some((m) => ga4Series[m].length > 0);

  // Funnel (brief §6 Phase 2): impression → click → session → engaged → CTA.
  // Each stage keeps its source label; GA4 side only appears once GA4 has landed.
  const ctaTracked = ga4Series.cta_clicks.length > 0;
  const funnel: FunnelStage[] = [
    { key: "impressions", label: "Impressions", source: "gsc", value: lastVal(series.impressions), available: series.impressions.length > 0 },
    { key: "clicks", label: "Clicks", source: "gsc", value: lastVal(series.clicks), available: series.clicks.length > 0 },
    { key: "sessions", label: "Sessions", source: "ga4", value: lastVal(ga4Series.sessions), available: ga4Series.sessions.length > 0 },
    { key: "engaged_sessions", label: "Engaged sessions", source: "ga4", value: lastVal(ga4Series.engaged_sessions), available: ga4Series.engaged_sessions.length > 0 },
    { key: "cta_clicks", label: "CTA clicks", source: "ga4", value: ctaTracked ? lastVal(ga4Series.cta_clicks) : null, available: ctaTracked },
  ];

  return {
    id: a.id,
    url: a.url,
    keyword: a.keyword,
    contentType: a.contentType,
    topicCluster: a.topicCluster,
    batch: a.batch,
    publishDate: a.publishDate,
    series,
    ga4Series,
    hasGa4,
    funnel,
  };
}

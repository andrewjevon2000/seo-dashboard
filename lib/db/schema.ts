import {
  pgTable,
  uuid,
  text,
  date,
  numeric,
  timestamp,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";

/**
 * Data model per engineering brief §4.
 *
 * Design commitments:
 *  - `performance_snapshots` is LONG / key-value (source, metric_name, metric_value),
 *    NOT wide-columned. GSC and GA4 metrics don't share a shape; a wide table would
 *    require a migration per new metric/source and produce many NULLs. The long
 *    shape costs a pivot at query time but avoids repeated migrations.
 *  - Inserts are APPEND-ONLY. History must accumulate — that is the entire point of
 *    this tool over the existing point-in-time reports. There is no UPDATE path to
 *    snapshot rows anywhere in the codebase. Re-runs are made idempotent via a
 *    unique index + ON CONFLICT DO NOTHING (see lib/db/queries.ts).
 *  - `site` exists from day one for future multi-client extensibility (§4, §9 Phase 3),
 *    even though v1 is single-site. No UI switches on it in v1.
 */

export const metricSource = pgEnum("metric_source", ["gsc", "ga4"]);

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Normalized URL (see lib/pipeline/normalize.ts). Join key across sources.
    url: text("url").notNull(),
    keyword: text("keyword"),
    // Included now for multi-client extensibility; v1 is always SITE_KEY.
    site: text("site").notNull().default("verihubs"),
    publishDate: date("publish_date"),
    batch: text("batch"),
    // STRUCTURAL role: pillar / cluster / etc. Maps from the sheet "Type" column.
    contentType: text("content_type"),
    // TOPIC group: KYC / deepfake / biometrics / OCR / AML-fraud / etc.
    // Nullable: the source sheet has no such column yet (brief §4.1). Stays NULL
    // until a `Cluster` column is added + backfilled. Filters degrade gracefully.
    topicCluster: text("topic_cluster"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Upsert key: one article per (site, url).
    siteUrlUnique: uniqueIndex("articles_site_url_unique").on(t.site, t.url),
    topicClusterIdx: index("articles_topic_cluster_idx").on(t.topicCluster),
    contentTypeIdx: index("articles_content_type_idx").on(t.contentType),
  }),
);

export const performanceSnapshots = pgTable(
  "performance_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    source: metricSource("source").notNull(),
    // clicks / impressions / ctr / position / sessions / engagement_time / cta_clicks
    metricName: text("metric_name").notNull(),
    // numeric holds both integer counts and fractional ctr/position/engagement_time.
    metricValue: numeric("metric_value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Idempotency + append-only enforcement: a given metric for an article/source/date
    // exists at most once. Re-running a pull ON CONFLICT DO NOTHING never overwrites.
    snapshotUnique: uniqueIndex("snapshots_unique").on(
      t.articleId,
      t.source,
      t.metricName,
      t.date,
    ),
    // Primary trend-query access path.
    trendIdx: index("snapshots_trend_idx").on(t.articleId, t.metricName, t.date),
    dateIdx: index("snapshots_date_idx").on(t.date),
  }),
);

export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type PerformanceSnapshot = typeof performanceSnapshots.$inferSelect;
export type NewPerformanceSnapshot = typeof performanceSnapshots.$inferInsert;

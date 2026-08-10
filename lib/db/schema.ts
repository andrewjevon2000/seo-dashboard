import {
  pgTable,
  uuid,
  text,
  date,
  numeric,
  boolean,
  jsonb,
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

/**
 * Keyword-level GSC snapshots (build plan Fase 2, gsc-weekly-digest wiring).
 *
 * Distinct from performance_snapshots, which is per-ARTICLE. The weekly digest
 * pulls per-KEYWORD data (the WoW / AI-Overview-suppression signal) that has no
 * article_id and was previously discarded each week. Stored here so keyword
 * trends accumulate for the Analyst / Decision Agent.
 *
 * WIDE (not long/key-value) on purpose: unlike pages (GSC + GA4, heterogeneous),
 * keyword metrics come from a single source with a fixed, stable set, so wide
 * columns are simpler and carry no per-metric-migration risk. Same invariants as
 * the metrics store: APPEND-ONLY, idempotent via a unique index + ON CONFLICT DO
 * NOTHING (a re-run of the same week never overwrites). `ctr` is a FRACTION
 * (0..1), consistent with the per-page store.
 */
export const keywordSnapshots = pgTable(
  "keyword_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    site: text("site").notNull().default("verihubs"),
    keyword: text("keyword").notNull(),
    country: text("country").notNull(), // market, e.g. "id" / "ph"
    date: date("date").notNull(), // snapshot date = digest window end
    clicks: numeric("clicks").notNull(),
    impressions: numeric("impressions").notNull(),
    ctr: numeric("ctr").notNull(), // fraction 0..1
    position: numeric("position").notNull(),
    source: text("source").notNull().default("gsc"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Idempotency + append-only: one row per keyword/country/date.
    kwUnique: uniqueIndex("keyword_snapshots_unique").on(
      t.site,
      t.keyword,
      t.country,
      t.date,
    ),
    // Primary trend access path (a keyword's history in a market).
    kwTrendIdx: index("keyword_snapshots_trend_idx").on(t.site, t.keyword, t.date),
    kwDateIdx: index("keyword_snapshots_date_idx").on(t.date),
  }),
);

export type KeywordSnapshot = typeof keywordSnapshots.$inferSelect;
export type NewKeywordSnapshot = typeof keywordSnapshots.$inferInsert;

/**
 * ── Decision layer (build plan Fase 0/3) ────────────────────────────────────
 *
 * The two tables above are the METRICS store (what the numbers are). The three
 * below are the DECISION store (what we chose to do, and what we actually did).
 * They are what makes results compound: without them the Analyst can only report
 * up-and-down movements with no attributable cause.
 *
 * Design commitments (consistent with the metrics store):
 *  - APPEND-ONLY history. A decision is never edited into a different verdict;
 *    it is SUPERSEDED by a new row (see `supersededById`). The changelog is never
 *    rewritten. This is the entire point — a durable, auditable record.
 *  - MULTI-CLIENT from row one via `site` (→ clients.id), even though v1 is
 *    single-site. Every query filters on it; a second client is a data change,
 *    not a schema change.
 *  - PROVENANCE is mandatory, not prose. Every agent/skill-produced verdict
 *    carries the inputs, queries, and snapshot references it rested on in the
 *    `provenance` JSONB — turning the integritas-data rubric into a schema.
 *  - The HUMAN GATE lives in `decisions.status`. Destructive verdicts (prune /
 *    redirect / merge) and client-facing output stay `proposed` until a human
 *    moves them to `approved`; only then may an executor act and write a
 *    changelog row. The state machine — not an LLM — enforces this.
 */

// One decision per URL: what to do with it.
export const decisionVerdict = pgEnum("decision_verdict", [
  "create",
  "refresh",
  "merge",
  "redirect",
  "prune",
  "leave",
]);

// Approval lifecycle. `proposed` → human gate → `approved`/`rejected`;
// `executed` once the changelog records the action; `superseded` when replaced.
export const decisionStatus = pgEnum("decision_status", [
  "proposed",
  "approved",
  "rejected",
  "executed",
  "superseded",
]);

// Who produced a verdict or executed an action. Keeps the deterministic-skill,
// LLM-agent, and human paths distinguishable for eval and audit.
export const actorKind = pgEnum("actor_kind", ["agent", "human", "skill"]);

// What actually happened to a page. Broader than the verdict set: it also covers
// production/QA events (a publish, a pre-publish sweep) that aren't "decisions".
export const changelogAction = pgEnum("changelog_action", [
  "published",
  "refreshed",
  "merged",
  "redirected",
  "pruned",
  "meta_updated",
  "schema_added",
  "internal_link_added",
  "pre_publish_sweep",
  "other",
]);

/**
 * Per-client profile. Keyed by the site slug used across the codebase
 * (env.SITE_KEY / articles.site), so a client IS a site here. Holds the config
 * that a generic engine reads so client-specific logic never gets baked into a
 * skill (build plan Fase 4).
 */
export const clients = pgTable("clients", {
  // Site slug, e.g. "verihubs". Matches articles.site / env.SITE_KEY.
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // What "success" means for this client — the yardstick reports are judged by.
  successDefinition: text("success_definition"),
  // Active service scope (e.g. ["content","site-audit","reporting"]).
  activeScope: jsonb("active_scope").$type<string[]>(),
  // Data-access tier (which credentials/endpoints are in play for this client).
  dataTier: text("data_tier"),
  locale: text("locale"), // e.g. "id-ID", "en-PH"
  // Keywords this client must never target (brand-safety / off-limits topics).
  keywordBlacklist: jsonb("keyword_blacklist").$type<string[]>(),
  publishPath: text("publish_path"), // how content ships, e.g. "wordpress"
  approver: text("approver"), // default human sign-off for gated actions
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per verdict on one URL. This is the Decision Agent's output surface and
 * the eval target (build plan Fase 3: reproduce ≥8/10 historical decisions).
 */
export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    site: text("site").notNull().default("verihubs"),
    // Nullable: a `create` verdict targets a URL that has no articles row yet.
    // set null (not cascade) so the decision survives if the article is removed —
    // history is append-only.
    articleId: uuid("article_id").references(() => articles.id, {
      onDelete: "set null",
    }),
    // Normalized URL — the stable target key, always present even when articleId is null.
    url: text("url").notNull(),
    verdict: decisionVerdict("verdict").notNull(),
    rationale: text("rationale").notNull(),
    expectedImpact: text("expected_impact"),
    confidence: numeric("confidence"), // 0..1; enables calibration against outcomes
    status: decisionStatus("status").notNull().default("proposed"),
    // Producer identity.
    source: actorKind("source").notNull(),
    producedBy: text("produced_by").notNull(), // "decision-agent" | "cannibalization-check" | "manual:andrew"
    // Human gate: set when status moves to approved/rejected. NULL while proposed.
    approvedBy: text("approved_by"),
    decidedAt: date("decided_at").notNull(),
    // Self-reference to the decision that replaced this one (no hard FK to avoid
    // circular DDL; indexed and documented). Set on the OLD row when superseded.
    supersededById: uuid("superseded_by_id"),
    // Inputs the verdict rested on: metric snapshot ids, Ahrefs queries + timestamps,
    // cannibalization findings, etc. The integritas-data rubric as data, not prose.
    provenance: jsonb("provenance"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // "All decisions for this URL", newest first — the per-page history view.
    siteUrlIdx: index("decisions_site_url_idx").on(t.site, t.url),
    // The approval queue: proposed decisions awaiting the human gate.
    siteStatusIdx: index("decisions_site_status_idx").on(t.site, t.status),
    articleIdx: index("decisions_article_idx").on(t.articleId),
    decidedAtIdx: index("decisions_decided_at_idx").on(t.decidedAt),
  }),
);

/**
 * What actually happened — the execution record. Links back to the `decisions`
 * row that authorized it (nullable: some events, like a raw publish, may predate
 * a formal decision). This is what lets the Analyst attribute a traffic movement
 * to a specific action taken on a specific date.
 */
export const changelog = pgTable(
  "changelog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    site: text("site").notNull().default("verihubs"),
    articleId: uuid("article_id").references(() => articles.id, {
      onDelete: "set null",
    }),
    url: text("url").notNull(),
    action: changelogAction("action").notNull(),
    // The decision this action executed. set null so the log survives decision GC.
    decisionId: uuid("decision_id").references(() => decisions.id, {
      onDelete: "set null",
    }),
    executedBy: text("executed_by").notNull(), // agent/human/skill identifier
    executorKind: actorKind("executor_kind").notNull(),
    approvedBy: text("approved_by"), // human sign-off for gated actions
    actionDate: date("action_date").notNull(),
    // Expected effect at execution time — read back later to score the hypothesis.
    hypothesis: text("hypothesis"),
    // Action specifics: sweep pass/fail + failing line refs, redirect target,
    // merged-from URLs, etc.
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // The Fase 1 pass-criterion query: "what changed on URL X, when" in one lookup.
    siteUrlDateIdx: index("changelog_site_url_date_idx").on(t.site, t.url, t.actionDate),
    decisionIdx: index("changelog_decision_idx").on(t.decisionId),
    actionDateIdx: index("changelog_action_date_idx").on(t.actionDate),
  }),
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
export type ChangelogEntry = typeof changelog.$inferSelect;
export type NewChangelogEntry = typeof changelog.$inferInsert;

/**
 * ── Findings (build plan Fase 2, site-audit + link-health wiring) ────────────
 *
 * Technical + link-health issues, which are NOT content-lifecycle verdicts and
 * so do not belong in `decisions`. An issue-TRACKER shape: each finding has a
 * stable identity (site, source_skill, issue, url) so a monthly re-crawl UPDATES
 * the same row (last_detected_at) instead of duplicating, and resolution is
 * tracked via `status`. Destructive content actions a finding implies (merge /
 * redirect / prune) are recorded separately in `decisions`, only after reading
 * the page — matching both skills' own hard rules.
 *
 * `url` is NOT NULL: per-page findings use the page URL; aggregate/site-level
 * findings (e.g. an anchor-distribution risk, a DR trend) use a synthetic
 * `.../__site__/<slug>` marker so the identity/dedup key still works.
 */
export const findingStatus = pgEnum("finding_status", [
  "open",
  "triaged",
  "resolved",
  "wont_fix",
  "escalated",
]);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    site: text("site").notNull().default("verihubs"),
    sourceSkill: text("source_skill").notNull(), // "site-audit" | "link-health"
    category: text("category").notNull(), // "status-code" | "canonical" | "link-reclamation" | ...
    issue: text("issue").notNull(), // short issue name (identity component)
    severity: text("severity"), // "P1".."P6" (audit) or "high"/"med"/"low" (link)
    url: text("url").notNull(), // affected page, or a __site__ marker for aggregate
    affectedCount: numeric("affected_count"), // # URLs hit, for aggregate issues
    recommendedAction: text("recommended_action"),
    owner: text("owner"), // "web" | "content" | "client-decision" (link-health)
    status: findingStatus("status").notNull().default("open"),
    firstDetectedAt: date("first_detected_at").notNull(),
    lastDetectedAt: date("last_detected_at").notNull(),
    provenance: jsonb("provenance"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Stable identity → monthly re-detection updates the same row, never dupes.
    findingIdentity: uniqueIndex("findings_identity_unique").on(
      t.site,
      t.sourceSkill,
      t.issue,
      t.url,
    ),
    // The open-issues queue.
    findingStatusIdx: index("findings_site_status_idx").on(t.site, t.status),
    findingUrlIdx: index("findings_site_url_idx").on(t.site, t.url),
    findingSkillCatIdx: index("findings_skill_cat_idx").on(t.site, t.sourceSkill, t.category),
  }),
);

export type Finding = typeof findings.$inferSelect;
export type NewFinding = typeof findings.$inferInsert;

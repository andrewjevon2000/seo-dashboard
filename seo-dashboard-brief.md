# Verihubs SEO & Content Performance Dashboard — Engineering Brief

## 1. Purpose

Internal-only dashboard for tracking article-level SEO and engagement performance
over time, joined against the existing Verihubs content plan. Built for a single
user (freelance SEO operator managing Verihubs content).

The core gap this fills: existing reporting (weekly GSC digest, monthly Ahrefs/GSC
PPTX report) is point-in-time — it does not persist historical snapshots per
article, so there is no way to see trend over time or join performance data back
to "which article, which keyword, which publish batch." This tool exists to store
that history and visualize it, not to duplicate existing report generation.

## 2. Scope

**In scope (v1 / MVP):**
- Single site: Verihubs (verihubs.com) only
- Single user, no multi-tenant UI
- GSC data only for MVP

**Explicitly out of scope for v1 (design for, don't build):**
- Multi-client support (e.g. YKK AP Sinar Fortuna) — schema should not block this
  later, but no UI/config for switching sites in v1
- Client-facing access — this is an internal tool, not a client deliverable
- GA4 integration — planned as Phase 2, see §7

## 3. Data Sources

### 3.1 Content plan (source of truth for article metadata)
- Existing Google Sheet(s): "SEO Article Verihubs - Article Ideation PH" and the
  Indonesian batch sheets. Columns include Status / Type / Keyword / URL / Meta
  Title / Meta Description / Rank.
- Read-only input to the pipeline. Do not modify this sheet from the app; it stays
  the human-edited planning source.

### 3.2 GSC data (v1)
- Pulled via Ahrefs API's GSC passthrough endpoints (`gsc-pages`, `gsc-page-history`,
  `gsc-keywords`, `gsc-keyword-history`) — already authenticated, no separate GSC
  OAuth setup needed.
- **Caveat:** this Ahrefs API access shares a credit pool with the existing monthly
  `seo-report-verihubs` skill. Check remaining API credit balance before building a
  pull-heavy weekly pipeline.

### 3.3 GA4 data (Phase 2, not v1)
- Requires a separate Google Cloud service account, granted Viewer access under
  GA4 Admin > Property Access Management. This is distinct from any personal
  Google login access to the GA4 UI — API access must be provisioned separately.
- **Blocker to verify before Phase 2 build:** CTA click tracking (e.g. clicks to
  `/kontak` or `/contact`) is NOT a GA4 default event. It only exists if the
  Verihubs GTM container has a tag/trigger configured to fire an event (e.g.
  `cta_click`) on those link clicks. Confirm this exists in GTM before assuming
  that metric will have data. Sessions and engagement time are GA4 defaults and
  need no extra setup.

### 3.4 Cross-source caveats to design around
- GSC and GA4 numbers will never reconcile exactly (different measurement
  methodology, bot filtering, consent mode). Never display them as directly
  comparable without labeling the source.
- URL join key mismatch: GSC reports full URLs, GA4 reports page paths. Define and
  apply a consistent normalization rule (strip trailing slash, strip UTM/query
  params) before joining either source to the `articles` table.

## 4. Data Model

Use a proper lightweight database, not Google Sheets, as the query backend for
performance data (Sheets API rate limits and query performance are poor for
time-series aggregation at this scale). Recommended: Supabase/Postgres, or SQLite
via Turso if a simpler option is preferred. The content plan Sheet remains the
planning source and is only read from, never queried live for the dashboard UI.

```
articles
  id
  url            (normalized)
  keyword
  site           (string, e.g. "verihubs" — included now for future
                  multi-client extensibility even though v1 is single-site)
  publish_date
  batch
  content_type   (cluster / pillar / etc. — the article's STRUCTURAL role)
  topic_cluster  (KYC / deepfake / biometrics / OCR / AML-fraud /
                  identity-verification / etc. — the article's TOPIC group.
                  See §4.1: this column does not yet exist in the source sheet.)

performance_snapshots
  id
  article_id     (FK -> articles.id)
  date
  source         (gsc / ga4)
  metric_name    (clicks / impressions / ctr / position /
                  sessions / engagement_time / cta_clicks)
  metric_value
```

**Important:** `performance_snapshots` is intentionally long/key-value shaped
rather than wide-columned (fixed columns like `clicks`, `impressions`, etc). GSC
and GA4 metrics don't share a shape, and a wide table would need a schema
migration every time a new metric or source is added, plus a lot of NULLs
depending on source. The long shape costs a pivot step at query time but avoids
repeated migrations.

All inserts are append-only. Never overwrite an existing snapshot row — history
must accumulate over time, that's the entire point of this tool over the existing
point-in-time reports.

### 4.1 Two distinct "cluster" concepts — do not conflate

The word "cluster" is overloaded in this project. The schema separates them into
two fields, and they mean different things:

- **`content_type`** — structural role of the article: Pillar vs Cluster (a
  cluster article supports a pillar). This column ALREADY EXISTS in the content
  plan sheet as "Type", so it can be populated by the pipeline immediately.
- **`topic_cluster`** — the topical group the article belongs to: KYC, deepfake
  detection, biometrics, OCR, AML/fraud, identity verification, etc.

**Blocker:** `topic_cluster` has no corresponding column in the content plan
sheet today (existing columns are No / Status / Type / Keyword / URL / Meta Title
/ Meta Description / Content Structure / Rank). The chosen approach is to add a
`Cluster` column to the content plan sheet and backfill it manually — largely
bulk-assignable since batches tend to be thematically coherent. It is a strategic
classification, so it should not be auto-derived from keyword string matching or
URL patterns; that would produce silent misclassification and an "unknown" bucket
that needs manual cleanup anyway.

Pipeline should read this new column once it exists. Until then, `topic_cluster`
will be NULL and the topic-cluster filter (§6) should degrade gracefully rather
than error — render the filter as empty/disabled instead of breaking the view.

## 5. Pipeline

- Scheduled job, weekly cadence (align with the existing `gsc-weekly-digest`
  cadence). Vercel Cron is the natural choice since the app is also deployed on
  Vercel.
- Steps per run:
  1. Read the content plan sheet — get current article list (URL, keyword,
     status, type, batch)
  2. Pull GSC metrics per URL via Ahrefs `gsc-pages` / `gsc-page-history`
  3. Normalize URLs (see §3.4)
  4. Upsert into `articles` (insert new articles as they appear in the plan)
  5. Insert new rows into `performance_snapshots` for this period — do not touch
     existing rows
- GA4 pull is added in Phase 2 as an additional step in the same job, following
  the same append pattern, once the service account and GTM CTA event are
  confirmed.

## 6. Frontend

Next.js (App Router), server components querying the DB directly — no separate
API layer needed since this is single-user.

**Two primary views for v1:**
1. **Article list** — sortable/filterable table. Sparkline trend per article.

   **Filter buttons (toggle chips above the table):**
   - By `content_type`: Pillar / Cluster / All
   - By `topic_cluster`: KYC / Deepfake / Biometrics / OCR / AML-Fraud /
     Identity Verification / etc. Populate this filter's options dynamically
     from distinct values in the DB rather than hardcoding the list, so new
     clusters appear automatically as they're added to the sheet.
   - Filters should be combinable (e.g. Pillar + AML-Fraud) and reflected in the
     URL query string so a filtered view can be bookmarked.
   - Aggregate metrics shown above the table should recompute for the active
     filter — this is what makes cluster-level performance comparison possible
     (e.g. "how is the whole deepfake cluster trending"), which is a primary
     reason for the filter existing, not just row narrowing.

   Computed flag columns:
   - Declining: clicks trending down over N consecutive periods
   - CTR-position mismatch: position is good but CTR is below the expected
     benchmark for that position
   - Cannibalization risk: piped from the existing `cannibalization-check` skill
     output rather than recomputed
2. **Article detail** — full historical trend chart, keyword(s) targeted from the
   content plan alongside actual performance

**Phase 2 addition:** a funnel view per article once GA4 lands —
impression → click → session → engaged session → CTA click — this is the more
useful framing than a flat metrics table once conversion-adjacent data is
available.

**Design note:** this should be data-dense and clarity-first. Do not reuse the
3D/scroll-animation aesthetic from the portfolio site (andrewjevon.com) — that's
a different design goal (spectacle vs. legibility).

## 7. Auth

Internal-only does not mean skip auth — the app will still be deployed to a
public URL. A single shared-password basic auth middleware is sufficient. No need
for a full user/session auth system for a single-user internal tool.

## 8. Prerequisites to confirm before/during build

- [ ] Add a `Cluster` (topic cluster) column to the content plan sheet and backfill
      it — required before the topic-cluster filter has any data (see §4.1)
- [ ] Remaining Ahrefs API credit balance (shared with existing monthly report skill)
- [ ] Whether Verihubs GTM container has a CTA click event configured (blocker for
      that specific metric only, not for the rest of the build)
- [ ] URL normalization rule (trailing slash / query param handling) — decide once,
      apply consistently in the pipeline
- [ ] GA4 service account creation + Property Access Management grant (Phase 2 only)

## 9. Phasing

**Phase 1 (MVP):** GSC only. `articles` + `performance_snapshots` schema. Weekly
cron. Article list + detail views, with pillar/cluster and topic-cluster filters.
Basic auth.

**Phase 2:** GA4 integration (sessions, engagement_time, cta_clicks pending GTM
verification). Funnel view.

**Phase 3 (deferred, not currently planned):** Multi-client support (e.g. YKK AP
Sinar Fortuna). Schema already supports this via the `site` field on `articles`;
no other work should be done toward this now.

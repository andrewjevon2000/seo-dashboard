# Verihubs SEO & Content Performance Dashboard

Internal, single-user dashboard that **persists historical GSC performance per
article** and joins it to the Verihubs content plan — so you can see trend over
time and compare at the cluster level, which the existing point-in-time reports
(weekly GSC digest, monthly PPTX) can't do.

This is **Phase 1 (MVP): GSC only**. GA4 + funnel view (Phase 2) and multi-client
(Phase 3) are designed-for but not built — see [Phasing](#phasing).

## Stack

- **Next.js 15** (App Router), Server Components query Postgres directly — no API layer.
- **Supabase Postgres** via **Drizzle ORM** (typed schema + SQL migrations).
- **Ahrefs API v3** GSC passthrough for data; **Vercel Cron** for the weekly pull.
- **Recharts** (detail trend) + dependency-free SVG sparklines (list).
- Single shared-password **HTTP Basic auth** middleware.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in values (see below)
npm run db:generate          # generate the initial migration from the schema
npm run db:migrate           # apply it to your database
npm run dev                  # http://localhost:3000
```

### Local Postgres via Docker (dev)

A [`docker-compose.yml`](docker-compose.yml) provides a local Postgres 16. The
committed [`.env.local`](.env.example) already points at it and enables fixtures,
so this is a full end-to-end run with no live credentials:

```bash
docker compose up -d                                    # start Postgres on :5432
npm run db:migrate                                      # create tables
npm run pipeline:run -- --backfill --from=2025-06-30 --to=2025-08-04   # seed history (fixtures)
npm run pipeline:run -- --end=2025-08-04                # add the latest weekly snapshot
npm run dev                                             # http://localhost:3000/articles
```

`docker compose down` stops it (data persists in a volume); `docker compose down -v`
wipes it. The pipeline CLI and `drizzle-kit` auto-load `.env.local` (see
`lib/dev-env.ts`), so no extra flags are needed.

To run the whole app **before** wiring live Ahrefs/Sheet access, use fixtures:

```bash
# in .env.local
USE_PIPELINE_FIXTURES="true"
```

Then seed some data and open the dashboard:

```bash
npm run pipeline:run -- --end=2025-08-04     # one weekly snapshot
npm run pipeline:run -- --backfill --from=2025-06-30 --to=2025-08-04   # seed history
```

## Environment

See [`.env.example`](.env.example) for the full list. The essentials:

| Var | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase **pooled** connection (port 6543, `prepare:false`). |
| `DIRECT_URL` | Direct connection (5432) used only by `drizzle-kit`. |
| `AHREFS_API_KEY` / `AHREFS_PROJECT_ID` | GSC passthrough. **Shares a credit pool** with the monthly report skill. |
| `AHREFS_CREDIT_THRESHOLD` | Weekly pull self-skips if remaining units fall below this. |
| `GOOGLE_SHEET_CSV_URL` **or** service-account vars | Read-only content-plan source. CSV URL wins if both set. |
| `CRON_SECRET` | Guards `/api/cron/pull`. Vercel sends it automatically as a Bearer header. |
| `DASHBOARD_USER` / `DASHBOARD_PASSWORD` | Basic-auth credentials. No password set ⇒ auth is disabled (local dev only). |

## How it works

### Data model (`lib/db/schema.ts`)

- **`articles`** — one row per `(site, url)`. `content_type` (structural: Pillar/Cluster,
  from the sheet "Type") and `topic_cluster` (topical: KYC/deepfake/…, nullable) are
  **two distinct fields** and must not be conflated.
- **`performance_snapshots`** — long/key-value (`source`, `metric_name`, `metric_value`),
  **append-only**. A unique index on `(article_id, source, metric_name, date)` makes
  re-runs idempotent via `ON CONFLICT DO NOTHING`; **history is never overwritten**.

### Pipeline (`lib/pipeline/`, weekly cron)

1. Read the content plan (`sheet.ts`, read-only — never writes to the sheet).
2. **Credit guard** — check remaining Ahrefs units; skip if below threshold.
3. Pull GSC per-page metrics for the period (single `gsc-pages` call).
4. Upsert `articles`.
5. Append `performance_snapshots` (never overwrite).

Run manually with `npm run pipeline:run`; scheduled via [`vercel.json`](vercel.json)
(default **Mon 06:00 UTC**, aligned to the `gsc-weekly-digest` cadence — adjust the cron
expression there if needed).

### URL normalization (`lib/pipeline/normalize.ts`)

One rule, applied everywhere a URL is a join key: force `https`, lowercase host, strip
`www.`, drop query/UTM + fragment, strip trailing slash. `normalizePath`/`pathOf` exist
so GA4 paths (Phase 2) join consistently. Unit-tested.

### Views (`app/articles/`)

- **List** — filter chips for `content_type` + `topic_cluster` (combinable, in the URL,
  bookmarkable). Cluster options are queried **dynamically** from the DB. **Aggregate
  cards recompute for the active filter** (cluster-level trend comparison). Flag columns:
  **Declining**, **CTR-position mismatch**, **Cannibalization** (piped from the existing
  `cannibalization-check` skill via `CANNIBALIZATION_SOURCE`).
- **Detail** — full historical trend chart + the content-plan target keyword alongside
  actual performance.

## Prerequisites checklist (brief §8)

- [ ] **Add a `Cluster` column** to the content plan and backfill it. Until then
      `topic_cluster` is NULL and its filter renders **disabled** (by design — it never
      errors). Do **not** auto-derive clusters from keywords/URLs (silent misclassification).
- [ ] **Ahrefs credit balance** — confirm headroom before enabling the weekly cron
      (shared with `seo-report-verihubs`). The pipeline's credit guard is a backstop, not
      a substitute for checking.
- [ ] **GTM CTA event** — only blocks the `cta_clicks` metric in Phase 2, nothing else.
- [ ] **URL normalization rule** — implemented as above; change in one place if needed.
- [ ] **GA4 service account + Property Access grant** — Phase 2 only.

## Phasing

- **Phase 1 (this):** GSC only. Schema, weekly cron, list + detail with filters, basic auth.
- **Phase 2 (wired):** GA4 via the Data API — `sessions`, `engaged_sessions`, `engagement_time`,
  and `cta_clicks`. Runs as an additive step in the same weekly job (`lib/pipeline/ga4.ts`),
  isolated so a GA4 misconfig can't break the GSC pull, and only when `GA4_PROPERTY_ID` +
  a service account are set (or fixtures are on). GA4 pagePaths join to articles via the
  `pathOf`/`normalizePath` rule (§3.4). The **article detail page shows a source-labeled funnel**
  (impression → click → session → engaged → CTA) that degrades gracefully:
  - GA4 stages read "not connected" until GA4 lands;
  - the **CTA stage reads "not tracked" until the GTM `cta_click` event exists** (§3.3) —
    `cta_clicks` is never fabricated;
  - GSC and GA4 are never shown as directly comparable (conversion % only within a source).
- **Phase 3 (deferred):** Multi-client. `articles.site` already supports it; no other work now.

## Tests

```bash
npm run test        # URL normalization + flag logic
npm run typecheck
```

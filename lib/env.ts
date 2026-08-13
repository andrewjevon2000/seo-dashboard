import { z } from "zod";

/**
 * Centralized, validated environment access.
 *
 * We intentionally do NOT hard-fail on missing pipeline/Sheet credentials at
 * import time, because the frontend (Server Components) only needs DATABASE_URL,
 * and the app should still boot for development against a stubbed pipeline. Each
 * subsystem validates the vars it actually needs at the point of use.
 */

const bool = (v: string | undefined, dflt = false) =>
  v == null ? dflt : ["1", "true", "yes", "on"].includes(v.toLowerCase());

const schema = z.object({
  // Optional at parse time so importing this module never throws during
  // `next build` (page-data collection imports route modules but connects to no
  // DB). Presence is enforced lazily where it's actually needed — see
  // lib/db/client.ts, which throws a clear error on first query if it's missing.
  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),

  AHREFS_API_KEY: z.string().optional(),
  // The GSC-connected Ahrefs project the pipeline pulls from.
  AHREFS_PROJECT_ID: z.coerce.number().optional(),
  AHREFS_CREDIT_THRESHOLD: z.coerce.number().default(500),
  // Two-letter country filter for GSC pulls (e.g. "id", "ph"). Empty = all.
  AHREFS_COUNTRY: z.string().optional(),

  GOOGLE_SHEET_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),
  GOOGLE_SHEET_WORKSHEET_TITLE: z.string().optional(),
  GOOGLE_SHEET_CSV_URL: z.string().optional(),

  // --- GA4 (Phase 2) ---------------------------------------------------------
  // Numeric GA4 property id (e.g. "123456789"). Absent → GA4 pull is skipped.
  GA4_PROPERTY_ID: z.string().optional(),
  // Dedicated GA4 service account; falls back to the Sheet service account if unset.
  GA4_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GA4_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),
  // The GTM-configured CTA event name (brief §3.3). Empty → CTA pull is skipped
  // (the metric only exists if GTM fires it; do not assume it has data).
  GA4_CTA_EVENT_NAME: z.string().optional(),
  // Restrict GA4 metrics to the organic-search channel so the funnel continues
  // coherently from GSC clicks. "false" pulls all-traffic sessions instead.
  GA4_ORGANIC_ONLY: z.string().optional(),

  // --- Ahrefs Web Analytics (measured on-site traffic; no GA4 admin needed) ---
  // Uses the same AHREFS_API_KEY + AHREFS_PROJECT_ID as the GSC pull. On by
  // default when Ahrefs is configured; set "false" to skip the web-analytics step.
  WEB_ANALYTICS_ENABLED: z.string().optional(),
  // Restrict measured entry-page traffic to the organic-search channel so it lines
  // up with GSC clicks. "false" counts all channels.
  WEB_ANALYTICS_ORGANIC_ONLY: z.string().optional(),

  CRON_SECRET: z.string().optional(),
  SITE_KEY: z.string().default("verihubs"),

  CANNIBALIZATION_SOURCE: z.string().optional(),

  DASHBOARD_USER: z.string().default("verihubs"),
  DASHBOARD_PASSWORD: z.string().optional(),

  USE_PIPELINE_FIXTURES: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Only DATABASE_URL is strictly required; surface a clear message.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const d = parsed.data;

// GA4 creds fall back to the Sheet service account when GA4-specific ones are unset.
const ga4ServiceAccountEmail = d.GA4_SERVICE_ACCOUNT_EMAIL || d.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const ga4ServiceAccountKey = d.GA4_SERVICE_ACCOUNT_PRIVATE_KEY || d.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

export const env = {
  ...d,
  useFixtures: bool(d.USE_PIPELINE_FIXTURES),
  ga4OrganicOnly: bool(d.GA4_ORGANIC_ONLY, true),
  ga4ServiceAccountEmail,
  ga4ServiceAccountKey,
  // GA4 participates only when a property id + usable service account are present.
  ga4Configured: Boolean(d.GA4_PROPERTY_ID && ga4ServiceAccountEmail && ga4ServiceAccountKey),
  // Web Analytics reuses the Ahrefs GSC credentials; on by default when present.
  webAnalyticsOrganicOnly: bool(d.WEB_ANALYTICS_ORGANIC_ONLY, true),
  webAnalyticsConfigured:
    Boolean(d.AHREFS_API_KEY && d.AHREFS_PROJECT_ID != null && bool(d.WEB_ANALYTICS_ENABLED, true)),
};

export type Env = typeof env;

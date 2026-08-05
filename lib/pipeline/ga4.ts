import { JWT } from "google-auth-library";
import { env } from "@/lib/env";
import type { Ga4PageMetrics } from "./types";
import { fixtureGa4Pages, fixtureGa4History } from "./fixtures";

/**
 * GA4 Data API client (Phase 2, brief §3.3). Direct REST via a service-account
 * JWT — no heavy SDK, mirroring the Ahrefs client.
 *
 * Requirements (provisioned separately from any personal GA4 UI access, §3.3):
 *   - a Google Cloud service account granted Viewer under
 *     GA4 Admin > Property Access Management
 *   - GA4_PROPERTY_ID set to the numeric property id
 *
 * CTA blocker (§3.3): cta_clicks is NOT a GA4 default event. It only has data if
 * the Verihubs GTM container fires GA4_CTA_EVENT_NAME on CTA link clicks. If that
 * env var is unset we don't even query it; if set but the event has no data, the
 * metric simply comes back as 0/absent — never fabricated.
 *
 * URL join (§3.4): GA4 reports pagePath while GSC reports full URLs. We return
 * the raw pagePath here; the writer normalizes it (normalizePath) and joins to
 * the article's path (pathOf) — one consistent rule.
 */

const BASE = "https://analyticsdata.googleapis.com/v1beta";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
// GA4 default channel group value for organic search.
const ORGANIC_CHANNEL = "Organic Search";

interface RunReportRow {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

function jwtClient(): JWT {
  const email = env.ga4ServiceAccountEmail;
  const key = env.ga4ServiceAccountKey;
  if (!email || !key) throw new Error("GA4 service account not configured.");
  return new JWT({
    email,
    key: key.replace(/\\n/g, "\n"),
    scopes: [SCOPE],
  });
}

async function runReport(
  jwt: JWT,
  body: Record<string, unknown>,
): Promise<RunReportRow[]> {
  const propertyId = env.GA4_PROPERTY_ID!;
  const { token } = await jwt.getAccessToken();
  const res = await fetch(`${BASE}/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`GA4 runReport failed: ${res.status} ${res.statusText} ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as { rows?: RunReportRow[] };
  return data.rows ?? [];
}

/** Optional organic-search-only filter so the funnel continues from GSC clicks. */
function organicFilter() {
  if (!env.ga4OrganicOnly) return undefined;
  return {
    filter: {
      fieldName: "sessionDefaultChannelGroup",
      stringFilter: { matchType: "EXACT", value: ORGANIC_CHANNEL },
    },
  };
}

/**
 * Pull GA4 per-page metrics for [dateFrom, dateTo], stamped with `snapshotDate`
 * (defaults to dateTo so GA4 rows align with the GSC snapshot for the same period).
 */
export async function pullGa4Pages(
  dateFrom: string,
  dateTo: string,
): Promise<Ga4PageMetrics[]> {
  if (env.useFixtures) return fixtureGa4Pages(dateTo);
  const jwt = jwtClient();
  const dimensionFilter = organicFilter();

  // Core metrics: sessions, engaged sessions, total engagement time.
  const coreRows = await runReport(jwt, {
    dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
    dimensions: [{ name: "pagePath" }],
    metrics: [
      { name: "sessions" },
      { name: "engagedSessions" },
      { name: "userEngagementDuration" },
    ],
    ...(dimensionFilter ? { dimensionFilter } : {}),
    limit: 10000,
  });

  const byPath = new Map<string, Ga4PageMetrics>();
  for (const r of coreRows) {
    const path = r.dimensionValues[0]?.value ?? "";
    if (!path) continue;
    byPath.set(path, {
      path,
      date: dateTo,
      sessions: Number(r.metricValues[0]?.value ?? 0),
      engagedSessions: Number(r.metricValues[1]?.value ?? 0),
      engagementTime: Number(r.metricValues[2]?.value ?? 0),
      ctaClicks: null,
    });
  }

  // CTA clicks — only if the GTM event name is configured (brief §3.3 blocker).
  const ctaEvent = env.GA4_CTA_EVENT_NAME?.trim();
  if (ctaEvent) {
    const ctaRows = await runReport(jwt, {
      dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: ctaEvent } } },
            ...(dimensionFilter ? [dimensionFilter] : []),
          ],
        },
      },
      limit: 10000,
    });
    for (const r of ctaRows) {
      const path = r.dimensionValues[0]?.value ?? "";
      const existing = byPath.get(path);
      const cta = Number(r.metricValues[0]?.value ?? 0);
      if (existing) existing.ctaClicks = cta;
      else
        byPath.set(path, {
          path,
          date: dateTo,
          sessions: 0,
          engagedSessions: 0,
          engagementTime: 0,
          ctaClicks: cta,
        });
    }
    // Pages with no CTA rows but present in core: 0 clicks (tracked, none fired).
    for (const m of byPath.values()) if (m.ctaClicks == null) m.ctaClicks = 0;
  }

  return [...byPath.values()];
}

/** Per-day GA4 history for backfill (fixtures only for now; live uses weekly pulls). */
export async function pullGa4History(
  dateFrom: string,
  dateTo: string,
): Promise<Ga4PageMetrics[]> {
  if (env.useFixtures) return fixtureGa4History(dateFrom, dateTo);
  // Live historical GA4 backfill would loop runReport per period; the weekly job
  // accumulates history going forward, so this is intentionally fixtures-only.
  return [];
}

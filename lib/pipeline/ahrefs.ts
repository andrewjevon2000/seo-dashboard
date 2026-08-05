import { env } from "@/lib/env";
import type { GscPageMetrics } from "./types";
import { fixtureGscPages, fixtureGscPageHistory } from "./fixtures";

/**
 * Ahrefs API v3 client — GSC passthrough (brief §3.2).
 *
 * CREDIT NOTE: this API key shares a credit (unit) pool with the monthly
 * `seo-report-verihubs` skill. The recurring weekly pull uses a SINGLE
 * `gsc-pages` call (all pages, one period) to minimize unit spend. The
 * per-URL `gsc-page-history` endpoint is only used for an explicit, CLI-gated
 * historical backfill. `getCreditRemaining()` powers the guard in run.ts.
 */

const BASE = "https://api.ahrefs.com/v3";

function requireKey(): string {
  if (!env.AHREFS_API_KEY) throw new Error("AHREFS_API_KEY is not set.");
  return env.AHREFS_API_KEY;
}

function requireProject(): number {
  if (env.AHREFS_PROJECT_ID == null) throw new Error("AHREFS_PROJECT_ID is not set.");
  return env.AHREFS_PROJECT_ID;
}

async function get<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  qs.set("output", "json");
  const res = await fetch(`${BASE}${path}?${qs.toString()}`, {
    headers: {
      Authorization: `Bearer ${requireKey()}`,
      Accept: "application/json",
    },
    // Pipeline runs server-side only; never cache API responses.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ahrefs ${path} failed: ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Remaining API units for this workspace, or null if it can't be determined. */
export async function getCreditRemaining(): Promise<number | null> {
  if (env.useFixtures) return null;
  try {
    const data = await get<{
      limits_and_usage: {
        units_limit_workspace: number | null;
        units_usage_workspace: number | null;
        units_limit_api_key: number | null;
        units_usage_api_key: number;
      };
    }>("/subscription-info/limits-and-usage", {});
    const u = data.limits_and_usage;
    // Prefer workspace-level accounting; fall back to per-key.
    if (u.units_limit_workspace != null && u.units_usage_workspace != null) {
      return Math.max(0, u.units_limit_workspace - u.units_usage_workspace);
    }
    if (u.units_limit_api_key != null) {
      return Math.max(0, u.units_limit_api_key - u.units_usage_api_key);
    }
    return null; // unlimited plan or unknown — guard treats null as "can't tell"
  } catch {
    return null;
  }
}

/**
 * One snapshot of per-page GSC metrics for [dateFrom, dateTo].
 * All pages in one call. `snapshotDate` (defaults to dateTo) is the date the
 * resulting snapshot rows are stamped with.
 */
export async function pullGscPages(
  dateFrom: string,
  dateTo: string,
): Promise<GscPageMetrics[]> {
  if (env.useFixtures) return fixtureGscPages(dateTo);
  const data = await get<{
    pages: Array<{
      page: string;
      clicks: number | null;
      impressions: number | null;
      ctr: number | null;
      position: number | null;
    }>;
  }>("/gsc/pages", {
    project_id: requireProject(),
    date_from: dateFrom,
    date_to: dateTo,
    country: env.AHREFS_COUNTRY,
    limit: 1000,
  });
  return (data.pages ?? []).map((p) => ({
    url: p.page,
    date: dateTo,
    clicks: p.clicks ?? 0,
    impressions: p.impressions ?? 0,
    // Ahrefs returns ctr as a PERCENT (e.g. 0.91 = 0.91%); we store fractions (0–1).
    ctr: (p.ctr ?? 0) / 100,
    position: p.position ?? 0,
  }));
}

/**
 * Per-URL historical time series — CREDIT-HEAVY, backfill only.
 * `pages` is a comma-separated URL list; grouping defaults to weekly.
 */
export async function pullGscPageHistory(
  pages: string[],
  dateFrom: string,
  dateTo: string,
  grouping: "daily" | "weekly" | "monthly" = "weekly",
): Promise<GscPageMetrics[]> {
  if (env.useFixtures) return fixtureGscPageHistory(pages, dateFrom, dateTo);
  const data = await get<{
    metrics: Array<{
      page: string;
      date: string;
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
    }>;
  }>("/gsc/page-history", {
    project_id: requireProject(),
    date_from: dateFrom,
    date_to: dateTo,
    history_grouping: grouping,
    country: env.AHREFS_COUNTRY,
    pages: pages.join(","),
  });
  return (data.metrics ?? []).map((m) => ({
    url: m.page,
    date: m.date.slice(0, 10),
    clicks: m.clicks ?? 0,
    impressions: m.impressions ?? 0,
    // Percent → fraction, as in pullGscPages.
    ctr: (m.ctr ?? 0) / 100,
    position: m.position ?? 0,
  }));
}

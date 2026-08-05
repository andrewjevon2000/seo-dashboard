import type { GscPageMetrics, Ga4PageMetrics } from "./types";
import { pathOf } from "./normalize";

/**
 * Local fixtures used when USE_PIPELINE_FIXTURES=true, so the whole app runs
 * end-to-end before live Ahrefs/Sheet access is wired (brief §7, build option).
 *
 * NOTE: fixtures intentionally OMIT the "Cluster" column to exercise the
 * graceful-degradation path (topic_cluster stays NULL, filter renders disabled).
 * Flip `INCLUDE_CLUSTER` to true to preview the populated-cluster experience.
 */

const INCLUDE_CLUSTER = false;

interface FixtureArticle {
  url: string;
  keyword: string;
  type: string;
  batch: string;
  cluster: string;
  // Weekly clicks/impressions/position trajectory (oldest → newest).
  clicks: number[];
  impressions: number[];
  position: number[];
}

const ARTICLES: FixtureArticle[] = [
  {
    url: "https://verihubs.com/blog/apa-itu-kyc",
    keyword: "apa itu kyc",
    type: "Pillar",
    batch: "2025-Q1",
    cluster: "KYC",
    clicks: [120, 138, 151, 149, 160, 172],
    impressions: [4200, 4600, 4900, 5100, 5300, 5600],
    position: [8.1, 7.4, 6.9, 7.0, 6.5, 6.1],
  },
  {
    url: "https://verihubs.com/blog/liveness-detection",
    keyword: "liveness detection adalah",
    type: "Cluster",
    batch: "2025-Q1",
    cluster: "Biometrics",
    clicks: [64, 60, 55, 48, 41, 33],
    impressions: [2100, 2050, 1980, 1900, 1820, 1700],
    position: [5.2, 5.6, 6.1, 6.8, 7.5, 8.3],
  },
  {
    url: "https://verihubs.com/blog/deepfake-detection",
    keyword: "deepfake detection",
    type: "Pillar",
    batch: "2025-Q2",
    cluster: "Deepfake",
    clicks: [12, 18, 24, 30, 44, 61],
    impressions: [900, 1300, 1700, 2200, 3000, 3900],
    position: [14.0, 12.3, 10.8, 9.2, 7.8, 6.4],
  },
  {
    url: "https://verihubs.com/blog/ocr-ktp",
    keyword: "ocr ktp",
    type: "Cluster",
    batch: "2025-Q1",
    cluster: "OCR",
    clicks: [210, 205, 208, 199, 201, 203],
    // Good position but flat/low CTR → exercises the CTR-mismatch flag.
    impressions: [15000, 15200, 15100, 15300, 15250, 15400],
    position: [2.6, 2.5, 2.7, 2.6, 2.5, 2.6],
  },
  {
    url: "https://verihubs.com/blog/anti-money-laundering",
    keyword: "anti money laundering adalah",
    type: "Cluster",
    batch: "2025-Q2",
    cluster: "AML-Fraud",
    clicks: [45, 47, 44, 46, 45, 43],
    impressions: [3000, 3100, 3050, 3080, 3020, 2990],
    position: [4.9, 4.8, 5.0, 4.9, 5.1, 5.0],
  },
];

// Six consecutive weekly snapshot dates (fixed; no Date.now in this codepath).
const WEEK_DATES = [
  "2025-06-30",
  "2025-07-07",
  "2025-07-14",
  "2025-07-21",
  "2025-07-28",
  "2025-08-04",
];

export function fixturePlanRows(): Record<string, string>[] {
  return ARTICLES.map((a, i) => {
    const row: Record<string, string> = {
      No: String(i + 1),
      Status: "Published",
      Type: a.type,
      Keyword: a.keyword,
      URL: a.url,
      Batch: a.batch,
    };
    if (INCLUDE_CLUSTER) row.Cluster = a.cluster;
    return row;
  });
}

function ctrOf(clicks: number, impressions: number): number {
  return impressions > 0 ? clicks / impressions : 0;
}

/** Latest-week snapshot for every fixture page, stamped with `snapshotDate`. */
export function fixtureGscPages(snapshotDate: string): GscPageMetrics[] {
  const idx = WEEK_DATES.indexOf(snapshotDate);
  const i = idx >= 0 ? idx : WEEK_DATES.length - 1;
  return ARTICLES.map((a) => ({
    url: a.url,
    date: snapshotDate,
    clicks: a.clicks[i],
    impressions: a.impressions[i],
    ctr: ctrOf(a.clicks[i], a.impressions[i]),
    position: a.position[i],
  }));
}

/** Full weekly history for the requested pages (used by the backfill path). */
export function fixtureGscPageHistory(
  pages: string[],
  dateFrom: string,
  dateTo: string,
): GscPageMetrics[] {
  const want = new Set(pages);
  const out: GscPageMetrics[] = [];
  for (const a of ARTICLES) {
    if (want.size > 0 && !want.has(a.url)) continue;
    WEEK_DATES.forEach((d, i) => {
      if (d < dateFrom || d > dateTo) return;
      out.push({
        url: a.url,
        date: d,
        clicks: a.clicks[i],
        impressions: a.impressions[i],
        ctr: ctrOf(a.clicks[i], a.impressions[i]),
        position: a.position[i],
      });
    });
  }
  return out;
}

/** All fixture week dates — used by the CLI backfill default range. */
export function fixtureWeekDates(): string[] {
  return [...WEEK_DATES];
}

// ── GA4 fixtures (Phase 2) ────────────────────────────────────────────────────
// Derived from each article's clicks so the funnel stays monotonic and coherent
// (organic clicks → sessions → engaged sessions → CTA clicks). INCLUDE_CTA
// simulates the GTM CTA event being configured; set false to preview the
// "CTA not tracked yet" degradation path.
const INCLUDE_CTA = true;

function ga4ForWeek(a: FixtureArticle, i: number): Ga4PageMetrics {
  const clicks = a.clicks[i];
  const sessions = Math.round(clicks * 0.85);
  const engaged = Math.round(sessions * 0.62);
  return {
    path: pathOf(a.url),
    date: WEEK_DATES[i],
    sessions,
    engagedSessions: engaged,
    engagementTime: engaged * 48, // ~48s avg engagement per engaged session
    ctaClicks: INCLUDE_CTA ? Math.round(engaged * 0.09) : null,
  };
}

export function fixtureGa4Pages(snapshotDate: string): Ga4PageMetrics[] {
  const idx = WEEK_DATES.indexOf(snapshotDate);
  const i = idx >= 0 ? idx : WEEK_DATES.length - 1;
  return ARTICLES.map((a) => ({ ...ga4ForWeek(a, i), date: snapshotDate }));
}

export function fixtureGa4History(dateFrom: string, dateTo: string): Ga4PageMetrics[] {
  const out: Ga4PageMetrics[] = [];
  for (const a of ARTICLES) {
    WEEK_DATES.forEach((d, i) => {
      if (d < dateFrom || d > dateTo) return;
      out.push(ga4ForWeek(a, i));
    });
  }
  return out;
}

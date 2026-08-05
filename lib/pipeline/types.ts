/** Shared pipeline shapes. */

/** One article row read from the content-plan Google Sheet (source of truth). */
export interface PlanRow {
  url: string; // raw, un-normalized (normalized downstream)
  keyword: string | null;
  status: string | null;
  contentType: string | null; // from the sheet "Type" column
  batch: string | null;
  topicCluster: string | null; // from the sheet "Cluster" column IF it exists yet
}

/** GSC metrics for one page on one date. */
export interface GscPageMetrics {
  url: string; // raw URL as GSC/Ahrefs reports it
  date: string; // ISO yyyy-mm-dd
  clicks: number;
  impressions: number;
  ctr: number; // 0..1
  position: number;
}

/** GA4 metrics for one page path on one date (Phase 2). */
export interface Ga4PageMetrics {
  path: string; // GA4 pagePath, e.g. "/blog/ocr-ktp" (normalized downstream)
  date: string; // ISO yyyy-mm-dd (snapshot date, aligned to the GSC snapshot)
  sessions: number;
  engagedSessions: number;
  engagementTime: number; // total user engagement seconds
  ctaClicks: number | null; // null when the CTA event isn't configured/tracked
}

export interface PipelineRunResult {
  ranAt: string;
  articlesUpserted: number;
  snapshotsInserted: number;
  snapshotsSkipped: number; // already existed (append-only, no overwrite)
  ga4SnapshotsInserted: number;
  ga4SnapshotsSkipped: number;
  clusterColumnPresent: boolean;
  ahrefsCreditRemaining: number | null;
  skipped: boolean;
  notes: string[];
}

import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { env } from "@/lib/env";
import type { PlanRow } from "./types";
import { fixturePlanRows } from "./fixtures";

/**
 * Read the content-plan Google Sheet (brief §3.1). READ-ONLY — this app must
 * never modify the sheet; it stays the human-edited planning source.
 *
 * Two strategies (env-selected, brief §7):
 *   (A) service account + GOOGLE_SHEET_ID
 *   (B) published CSV export via GOOGLE_SHEET_CSV_URL (takes precedence)
 * With USE_PIPELINE_FIXTURES=true, returns local fixtures so the app runs
 * end-to-end before real access is wired.
 *
 * Header mapping is tolerant of the known columns:
 *   No | Status | Type | Keyword | URL | Meta Title | Meta Description |
 *   Content Structure | Rank   (+ a future "Cluster" column, see §4.1)
 */

// Normalize a header/alias so separators don't matter: "content_type",
// "Content Type", and "content-type" all collapse to the same token.
const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, " ");

// Column header → PlanRow field. Aliases are compared after norm(), so list them
// in the plain spaced form; underscore/hyphen variants match automatically.
const HEADER_ALIASES: Record<keyof Omit<PlanRow, never>, string[]> = {
  url: ["url", "link", "page"],
  keyword: ["keyword", "primary keyword", "target keyword"],
  status: ["status"],
  contentType: ["type", "content type"],
  batch: ["batch"],
  topicCluster: ["cluster", "topic cluster", "topic"],
  publishDate: ["publish date", "published", "date", "publish"],
};

function pick(row: Record<string, string>, aliases: string[]): string | null {
  const entries = Object.keys(row).map((k) => [norm(k), k] as const);
  for (const alias of aliases) {
    const a = norm(alias);
    const hit = entries.find(([nk]) => nk === a);
    if (hit) {
      const v = (row[hit[1]] ?? "").trim();
      return v === "" ? null : v;
    }
  }
  return null;
}

// Postgres `date` needs a full YYYY-MM-DD; partial values (e.g. "2026-01") → null.
function cleanDate(v: string | null): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function toPlanRows(records: Record<string, string>[]): {
  rows: PlanRow[];
  clusterColumnPresent: boolean;
} {
  const headerSet = new Set(
    records[0] ? Object.keys(records[0]).map(norm) : [],
  );
  const clusterColumnPresent = HEADER_ALIASES.topicCluster.some((a) => headerSet.has(norm(a)));

  const rows: PlanRow[] = records
    .map((r) => ({
      url: pick(r, HEADER_ALIASES.url) ?? "",
      keyword: pick(r, HEADER_ALIASES.keyword),
      status: pick(r, HEADER_ALIASES.status),
      contentType: pick(r, HEADER_ALIASES.contentType),
      batch: pick(r, HEADER_ALIASES.batch),
      // Even if the column exists, individual cells may be blank → null.
      topicCluster: clusterColumnPresent ? pick(r, HEADER_ALIASES.topicCluster) : null,
      publishDate: cleanDate(pick(r, HEADER_ALIASES.publishDate)),
    }))
    .filter((r) => r.url !== "");

  return { rows, clusterColumnPresent };
}

async function readViaCsv(csvUrl: string) {
  const res = await fetch(csvUrl, { redirect: "follow" });
  if (!res.ok) throw new Error(`Sheet CSV fetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  return toPlanRows(parseCsv(text));
}

async function readViaServiceAccount() {
  const { GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY } = env;
  if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error(
      "Sheet service-account access not configured (GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).",
    );
  }
  const jwt = new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, jwt);
  await doc.loadInfo();
  const sheet = env.GOOGLE_SHEET_WORKSHEET_TITLE
    ? doc.sheetsByTitle[env.GOOGLE_SHEET_WORKSHEET_TITLE]
    : doc.sheetsByIndex[0];
  if (!sheet) throw new Error(`Worksheet not found: ${env.GOOGLE_SHEET_WORKSHEET_TITLE ?? "(index 0)"}`);
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();
  const records = rows.map((r) => r.toObject() as Record<string, string>);
  return toPlanRows(records);
}

export async function readContentPlan(): Promise<{
  rows: PlanRow[];
  clusterColumnPresent: boolean;
}> {
  if (env.useFixtures) return toPlanRows(fixturePlanRows());
  if (env.GOOGLE_SHEET_CSV_URL) return readViaCsv(env.GOOGLE_SHEET_CSV_URL);
  return readViaServiceAccount();
}

/** Minimal RFC-4180-ish CSV parser (handles quoted fields, commas, newlines). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* ignore */ }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

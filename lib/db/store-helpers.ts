/**
 * Pure, side-effect-free helpers shared by the decision-store CLIs. Extracted so
 * the integrity-critical logic (CTR scaling, date windows, CSV parsing, URL
 * markers, verdict mapping) has ONE tested implementation instead of copies
 * scattered across the writers. See store-helpers.test.ts.
 */

/**
 * GSC CTR normalization. Ahrefs returns CTR as a PERCENT (e.g. 26.25), but the
 * store keeps it as a FRACTION (0.2625) — the source of a past bug. A real GSC
 * CTR fraction is always <= 1; a percent is <= 100. So treat any value > 1 as a
 * percent. Negatives / non-finite collapse to 0.
 */
export function toFraction(ctr: number): number {
  if (!Number.isFinite(ctr) || ctr < 0) return 0;
  return ctr > 1 ? ctr / 100 : ctr;
}

/** URL-safe slug. `maxLen` truncates (findings identity markers cap at 60). */
export function slugify(s: string, maxLen = 0): string {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
  return maxLen > 0 ? base.slice(0, maxLen) || "x" : base;
}

/** Synthetic marker for an unpublished draft (post-draft-sweep with no target URL). */
export function draftUrl(file: string): string {
  return `https://verihubs.com/__draft__/${slugify(file)}`;
}

/** Synthetic marker for a planned article checked by keyword (cannibalization-check). */
export function plannedUrl(keyword: string): string {
  return `https://verihubs.com/__planned__/${slugify(keyword)}`;
}

/** Synthetic identity marker for an aggregate/site-level finding (no page URL). */
export function siteFindingUrl(category: string, issue: string): string {
  return `https://verihubs.com/__site__/${slugify(`${category}-${issue}`, 60)}`;
}

/** [firstOfMonth, lastOfMonth] as YYYY-MM-DD for a "YYYY-MM" input. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error("month must be YYYY-MM");
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

/** Inclusive N-day window ending at `end` (Date). Used by weekly-activity. */
export function windowEnding(end: Date, days = 7): { from: string; to: string } {
  const from = new Date(end);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: from.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/** CSV line split tolerant of quoted fields containing commas. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** cannibalization-check risk level -> default confidence (0..1) as a string. */
export const RISK_CONFIDENCE: Record<string, string> = {
  SAFE: "0.85",
  LOW: "0.55",
  MODERATE: "0.7",
  HIGH: "0.9",
};

/** decision verdict -> changelog action on execute. */
export const VERDICT_ACTION: Record<string, string> = {
  create: "published",
  refresh: "refreshed",
  merge: "merged",
  redirect: "redirected",
  prune: "pruned",
  leave: "other",
};

export const DECISION_VERDICTS = ["create", "refresh", "merge", "redirect", "prune", "leave"] as const;
export type DecisionVerdict = (typeof DECISION_VERDICTS)[number];
export function isVerdict(v: unknown): v is DecisionVerdict {
  return typeof v === "string" && (DECISION_VERDICTS as readonly string[]).includes(v);
}

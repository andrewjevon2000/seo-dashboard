/**
 * Fase 2 wiring: persist a cannibalization-check verdict to the decisions store.
 * `npm run db:canni-log -- --file=<result.json>`
 *
 * Records the verdict the skill already produced — it does NOT re-run the check
 * or change its risk logic (Fase 2 rule: change the output destination only).
 * Idempotent per (site, url, verdict, decided_at, producedBy): re-checking the
 * same URL the same day with the same verdict is a no-op; a changed verdict on a
 * later day appends a new row (append-only decision history).
 *
 * Expected JSON (from the cannibalization-check output):
 * {
 *   "url": "https://verihubs.com/blog/slug",   // subject page (existing URL), or
 *                                              // omit for a planned keyword (see below)
 *   "planned_keyword": "apa itu kyc",          // set instead of url for a planned article
 *   "country": "id",
 *   "verdict": "create" | "leave" | "merge" | "redirect" | "refresh" | "prune",
 *   "risk": "SAFE" | "LOW" | "MODERATE" | "HIGH",
 *   "target": "https://verihubs.com/blog/other" | null,  // merge/redirect target
 *   "rationale": "risk assessment + recommendation, one or two sentences",
 *   "confidence": 0.0..1.0,                     // optional; derived from risk if omitted
 *   "overlaps": [ { "url": "...", "keyword": "...", "position": 3, "traffic": 120 } ]
 * }
 */
import { readFileSync } from "node:fs";
import { loadDevEnv } from "@/lib/dev-env";
import {
  RISK_CONFIDENCE,
  plannedUrl,
  isVerdict,
  DECISION_VERDICTS,
  type DecisionVerdict,
} from "./store-helpers";

loadDevEnv();

type Verdict = DecisionVerdict;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

interface CanniPayload {
  url?: string;
  planned_keyword?: string;
  country?: string;
  verdict: Verdict;
  risk?: string;
  target?: string | null;
  rationale?: string;
  confidence?: number;
  overlaps?: unknown[];
}

function validate(r: unknown): CanniPayload {
  if (!r || typeof r !== "object") throw new Error("payload is not an object");
  const o = r as Record<string, unknown>;
  if (!isVerdict(o.verdict))
    throw new Error(`verdict must be one of ${DECISION_VERDICTS.join("|")}, got ${JSON.stringify(o.verdict)}`);
  if (!o.url && !o.planned_keyword)
    throw new Error("either url (existing page) or planned_keyword (planned article) is required");
  return o as unknown as CanniPayload;
}

async function main() {
  const file = arg("file");
  if (!file) throw new Error("--file=<result.json> is required");
  const p = validate(JSON.parse(readFileSync(file, "utf8")));

  const { env } = await import("@/lib/env");
  const { insertDecisionIfAbsent, resolveArticleId } = await import("./decisions-writes");

  const site = env.SITE_KEY;
  // Existing page → its URL; planned article → a queryable marker.
  const url = p.url || plannedUrl(p.planned_keyword!);
  const articleId = p.url ? await resolveArticleId(p.url, site) : null;
  const confidence = p.confidence != null ? String(p.confidence) : RISK_CONFIDENCE[p.risk ?? ""] ?? null;
  const today = new Date().toISOString().slice(0, 10);

  const res = await insertDecisionIfAbsent({
    site,
    articleId,
    url,
    verdict: p.verdict,
    rationale: p.rationale || `Cannibalization check (${p.risk ?? "n/a"} risk).`,
    expectedImpact:
      p.target != null
        ? `Resolve overlap with ${p.target}.`
        : "Avoid intra-site keyword competition.",
    confidence,
    status: "proposed", // awaits the human gate (esp. merge/redirect)
    source: "skill",
    producedBy: "skill:cannibalization-check",
    approvedBy: null,
    decidedAt: today,
    provenance: {
      tool: "site-explorer-organic-keywords",
      input: p.url ?? p.planned_keyword,
      input_type: p.url ? "url" : "planned_keyword",
      country: (p.country ?? "id").toLowerCase(),
      risk: p.risk ?? null,
      target: p.target ?? null,
      overlaps: p.overlaps ?? [],
      pulled_at: today,
    },
  });

  console.log(
    JSON.stringify(
      { recorded: res.inserted, decision_id: res.id, url, verdict: p.verdict, risk: p.risk ?? null, deduped: !res.inserted },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("canni-log failed:", err.message);
    process.exit(1);
  });

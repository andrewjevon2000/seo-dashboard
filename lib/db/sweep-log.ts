/**
 * Fase 2 wiring: persist a post-draft-sweep result to the changelog.
 * `npm run db:sweep-log -- --file=<result.json>`
 *
 * This does NOT run any checks and does NOT change the sweep's logic — it only
 * records the result the skill already produced (build plan Fase 2: change the
 * output destination, never the logic). The skill writes its structured result
 * to a JSON file and calls this; append-only, one changelog row per sweep run.
 *
 * Expected JSON (matches the post-draft-sweep output contract):
 * {
 *   "url": "https://verihubs.com/blog/slug" | null,  // article target URL if known
 *   "file": "artikel-kyc-ph.html",                   // source file swept
 *   "language": "id" | "en" | null,
 *   "result": "ready" | "not_ready",
 *   "checks": [ { "n": 1, "name": "Em Dash", "status": "pass"|"fail"|"review", "note": "" }, ... ]
 * }
 */
import { readFileSync } from "node:fs";
import { loadDevEnv } from "@/lib/dev-env";

loadDevEnv();

interface SweepCheck {
  n: number;
  name: string;
  status: "pass" | "fail" | "review";
  note?: string;
}
interface SweepResult {
  url?: string | null;
  file: string;
  language?: string | null;
  result: "ready" | "not_ready";
  checks: SweepCheck[];
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

function validate(r: unknown): SweepResult {
  if (!r || typeof r !== "object") throw new Error("payload is not an object");
  const o = r as Record<string, unknown>;
  if (o.result !== "ready" && o.result !== "not_ready")
    throw new Error(`result must be "ready" | "not_ready", got ${JSON.stringify(o.result)}`);
  if (!Array.isArray(o.checks)) throw new Error("checks must be an array");
  if (typeof o.file !== "string" || !o.file) throw new Error("file (source filename) is required");
  return o as unknown as SweepResult;
}

async function main() {
  const file = arg("file");
  if (!file) throw new Error("--file=<result.json> is required");
  const payload = validate(JSON.parse(readFileSync(file, "utf8")));

  const { env } = await import("@/lib/env");
  const { appendChangelog, resolveArticleId } = await import("./decisions-writes");

  // Real target URL when known; otherwise a clean, queryable draft marker.
  const url = payload.url || `https://verihubs.com/__draft__/${slugify(payload.file)}`;
  const site = env.SITE_KEY;
  const articleId = payload.url ? await resolveArticleId(payload.url, site) : null;

  const failures = payload.checks.filter((c) => c.status === "fail");
  const reviews = payload.checks.filter((c) => c.status === "review");
  const today = new Date().toISOString().slice(0, 10);

  const { id } = await appendChangelog({
    site,
    articleId,
    url,
    action: "pre_publish_sweep",
    decisionId: null,
    executedBy: "skill:post-draft-sweep",
    executorKind: "skill",
    approvedBy: null,
    actionDate: today,
    hypothesis: null,
    detail: {
      file: payload.file,
      language: payload.language ?? null,
      result: payload.result,
      checks: payload.checks,
      failures: failures.map((c) => ({ n: c.n, name: c.name, note: c.note })),
      reviews: reviews.map((c) => ({ n: c.n, name: c.name, note: c.note })),
      is_draft: !payload.url,
    },
  });

  console.log(
    JSON.stringify(
      {
        recorded: true,
        changelog_id: id,
        url,
        result: payload.result,
        failures: failures.length,
        reviews: reviews.length,
        linked_article: !!articleId,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("sweep-log failed:", err.message);
    process.exit(1);
  });

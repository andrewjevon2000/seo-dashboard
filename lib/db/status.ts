/**
 * Operator home screen: one command that answers "what needs my attention?"
 *   npm run db:status
 *
 * Pure reads across the decision store: decisions awaiting the gate (destructive
 * flagged), open/escalated findings by severity, recent changelog, and this
 * week's operational activity. This is the daily driver for running the system —
 * approvals happen via `db:decision`, triage via `db:finding`.
 */
import { loadDevEnv } from "@/lib/dev-env";
import { windowEnding } from "./store-helpers";

loadDevEnv();

async function main() {
  const { env } = await import("@/lib/env");
  const { db } = await import("./client");
  const { decisions, changelog, findings, keywordSnapshots } = await import("./schema");
  const { and, eq, gte, inArray, desc, asc, sql } = await import("drizzle-orm");
  const site = env.SITE_KEY;
  const DESTRUCTIVE = ["merge", "redirect", "prune"];

  // 1. Decisions awaiting the gate.
  const pending = await db
    .select({ id: decisions.id, verdict: decisions.verdict, url: decisions.url, producedBy: decisions.producedBy, decidedAt: decisions.decidedAt })
    .from(decisions)
    .where(and(eq(decisions.site, site), eq(decisions.status, "proposed")))
    .orderBy(desc(decisions.decidedAt))
    .limit(50);
  const destructive = pending.filter((p) => DESTRUCTIVE.includes(p.verdict));

  // 2. Open / escalated findings.
  const openF = await db
    .select({ id: findings.id, severity: findings.severity, sourceSkill: findings.sourceSkill, issue: findings.issue, url: findings.url, owner: findings.owner, status: findings.status })
    .from(findings)
    .where(and(eq(findings.site, site), inArray(findings.status, ["open", "triaged", "escalated"])))
    .orderBy(asc(findings.severity))
    .limit(50);

  // 3. Recent changelog (last 14 days by action_date).
  const { from: recentFrom } = windowEnding(new Date(), 14);
  const recent = await db
    .select({ url: changelog.url, action: changelog.action, actionDate: changelog.actionDate, by: changelog.executedBy })
    .from(changelog)
    .where(and(eq(changelog.site, site), gte(changelog.actionDate, recentFrom)))
    .orderBy(desc(changelog.actionDate))
    .limit(15);

  // 4. Freshness.
  const [kw] = await db
    .select({ latest: sql<string>`max(${keywordSnapshots.date})`, n: sql<number>`count(*)::int` })
    .from(keywordSnapshots)
    .where(eq(keywordSnapshots.site, site));

  // ── Render ──────────────────────────────────────────────────────────────────
  const line = "─".repeat(60);
  console.log(`\n${line}\n  SEO DECISION STORE — ${site}\n${line}`);

  console.log(`\n▶ AWAITING YOUR GATE: ${pending.length} decision(s)` + (destructive.length ? `  (${destructive.length} DESTRUCTIVE ⚠)` : ""));
  for (const p of pending.slice(0, 10)) {
    const flag = DESTRUCTIVE.includes(p.verdict) ? " ⚠" : "";
    console.log(`   [${p.verdict}]${flag} ${p.url.replace("https://verihubs.com", "")}`);
    console.log(`     id=${p.id}  (${p.producedBy})`);
  }
  if (pending.length) console.log(`   → approve: npm run db:decision -- approve --id=<id> --by="<you>"`);

  const bySev = openF.reduce<Record<string, number>>((a, f) => ((a[f.severity ?? "?"] = (a[f.severity ?? "?"] ?? 0) + 1), a), {});
  console.log(`\n▶ OPEN FINDINGS: ${openF.length}` + (openF.length ? `  (${Object.entries(bySev).map(([s, n]) => `${s}:${n}`).join(", ")})` : ""));
  for (const f of openF.slice(0, 8)) {
    console.log(`   [${f.severity ?? "-"}] ${f.sourceSkill} · ${f.issue}  (owner=${f.owner ?? "-"}, ${f.status})`);
  }
  if (openF.length) console.log(`   → resolve: npm run db:finding -- resolve --id=<id>`);

  console.log(`\n▶ RECENT ACTIVITY (last 14 days): ${recent.length} changelog event(s)`);
  for (const r of recent.slice(0, 8)) {
    console.log(`   ${r.actionDate}  ${r.action.padEnd(16)} ${r.url.replace("https://verihubs.com", "")}  (${r.by})`);
  }

  console.log(`\n▶ DATA FRESHNESS`);
  console.log(`   keyword_snapshots: ${kw?.n ?? 0} rows, latest ${kw?.latest ?? "none"}`);
  console.log(`   (run: npm run db:weekly-activity  for hours-saved measurement)`);
  console.log(`\n${line}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("status failed:", err.message);
    process.exit(1);
  });

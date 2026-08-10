/**
 * Fase 2 wiring (READ side): assemble the parts of the monthly SEO report that
 * the decision store can serve, so seo-report-verihubs grounds its narrative in
 * recorded facts instead of re-deriving everything live.
 *   `npm run db:report-read -- --month=2026-07`
 *
 * SCOPE (honest): the report also needs Ahrefs-estimate traffic, backlinks/DR,
 * competitors, AI citations, and web analytics — NONE of which live in the store,
 * so those slides keep their live pulls. What the store uniquely adds:
 *   - Insights/Recommendations (Slides 12-13) grounded in real findings +
 *     decisions + changelog (the compounding payoff), and
 *   - keyword trends from keyword_snapshots (store-backed Slide 6, when populated).
 *
 * Read-only. Prints a JSON block the skill merges into report-data.json.
 */
import { loadDevEnv } from "@/lib/dev-env";
import { monthRange } from "./store-helpers";

loadDevEnv();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

async function main() {
  const month = arg("month");
  if (!month) throw new Error("--month=YYYY-MM is required");
  const { from, to } = monthRange(month);

  const { env } = await import("@/lib/env");
  const { db } = await import("./client");
  const { decisions, changelog, findings, keywordSnapshots } = await import("./schema");
  const { and, eq, gte, lte, inArray, desc, asc, sql } = await import("drizzle-orm");
  const site = env.SITE_KEY;

  // 1. Open findings (current state, severity-ranked) → grounds recommendations.
  const openFindings = await db
    .select({
      sourceSkill: findings.sourceSkill,
      category: findings.category,
      issue: findings.issue,
      severity: findings.severity,
      url: findings.url,
      owner: findings.owner,
      status: findings.status,
      recommendedAction: findings.recommendedAction,
      lastDetectedAt: findings.lastDetectedAt,
    })
    .from(findings)
    .where(and(eq(findings.site, site), inArray(findings.status, ["open", "triaged", "escalated"])))
    .orderBy(asc(findings.severity), desc(findings.lastDetectedAt))
    .limit(25);

  // 2. Pending decisions (proposed → awaiting the human gate). Destructive ones
  //    surfaced first since they need sign-off.
  const pendingDecisions = await db
    .select({
      url: decisions.url,
      verdict: decisions.verdict,
      rationale: decisions.rationale,
      confidence: decisions.confidence,
      producedBy: decisions.producedBy,
      decidedAt: decisions.decidedAt,
    })
    .from(decisions)
    .where(and(eq(decisions.site, site), eq(decisions.status, "proposed")))
    .orderBy(desc(decisions.decidedAt))
    .limit(25);

  // 3. What actually happened this month (changelog) → explains movements.
  const periodChangelog = await db
    .select({
      url: changelog.url,
      action: changelog.action,
      actionDate: changelog.actionDate,
      approvedBy: changelog.approvedBy,
      hypothesis: changelog.hypothesis,
      executedBy: changelog.executedBy,
    })
    .from(changelog)
    .where(and(eq(changelog.site, site), gte(changelog.actionDate, from), lte(changelog.actionDate, to)))
    .orderBy(asc(changelog.actionDate));

  // 4. Decisions executed/made this month.
  const periodDecisions = await db
    .select({
      url: decisions.url,
      verdict: decisions.verdict,
      status: decisions.status,
      approvedBy: decisions.approvedBy,
      decidedAt: decisions.decidedAt,
    })
    .from(decisions)
    .where(and(eq(decisions.site, site), gte(decisions.decidedAt, from), lte(decisions.decidedAt, to)))
    .orderBy(asc(decisions.decidedAt));

  // 5. Store-backed GSC keywords (Slide 6) + WoW trend, from keyword_snapshots.
  //    Uses the latest snapshot date within the month, and the prior date for delta.
  const kwDates = await db
    .selectDistinct({ date: keywordSnapshots.date })
    .from(keywordSnapshots)
    .where(and(eq(keywordSnapshots.site, site), lte(keywordSnapshots.date, to)))
    .orderBy(desc(keywordSnapshots.date))
    .limit(2);
  const latestKwDate = kwDates[0]?.date ?? null;
  const prevKwDate = kwDates[1]?.date ?? null;

  let keywordTrends: unknown[] = [];
  if (latestKwDate) {
    const cur = await db
      .select({
        keyword: keywordSnapshots.keyword,
        clicks: keywordSnapshots.clicks,
        impressions: keywordSnapshots.impressions,
        ctr: keywordSnapshots.ctr,
        position: keywordSnapshots.position,
      })
      .from(keywordSnapshots)
      .where(and(eq(keywordSnapshots.site, site), eq(keywordSnapshots.date, latestKwDate)))
      .orderBy(desc(sql`${keywordSnapshots.clicks}::numeric`))
      .limit(15);
    const prevMap = new Map<string, number>();
    if (prevKwDate) {
      const prev = await db
        .select({ keyword: keywordSnapshots.keyword, position: keywordSnapshots.position })
        .from(keywordSnapshots)
        .where(and(eq(keywordSnapshots.site, site), eq(keywordSnapshots.date, prevKwDate)));
      for (const r of prev) prevMap.set(r.keyword, Number(r.position));
    }
    keywordTrends = cur.map((r) => ({
      keyword: r.keyword,
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
      ctr: Number(r.ctr),
      position: Number(r.position),
      posDelta: prevKwDate && prevMap.has(r.keyword) ? +(prevMap.get(r.keyword)! - Number(r.position)).toFixed(1) : null,
    }));
  }

  const out = {
    month,
    range: { from, to },
    storeBacked: ["Slide 6 keywords (if populated)", "Slide 12 insights", "Slide 13 recommendations"],
    liveStillRequired: [
      "Ahrefs org-traffic estimate + history (Slides 3)",
      "backlinks / DR / refdomains (Slide 8)",
      "organic competitors (Slide 7)",
      "metrics-by-country (Slide 9)",
      "AI citations (Slide 10)",
      "web analytics (Slide 11)",
      "GSC performance totals (Slides 4/5) — free pull; store holds only weekly windows",
    ],
    reportContext: {
      openFindings,
      pendingDecisions,
      periodChangelog,
      periodDecisions,
      keywordTrends: { latestDate: latestKwDate, prevDate: prevKwDate, keywords: keywordTrends },
    },
    counts: {
      openFindings: openFindings.length,
      pendingDecisions: pendingDecisions.length,
      periodChangelog: periodChangelog.length,
      periodDecisions: periodDecisions.length,
      keywordTrends: keywordTrends.length,
    },
  };

  console.log(JSON.stringify(out, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("report-read failed:", err.message);
    process.exit(1);
  });

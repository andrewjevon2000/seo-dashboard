/**
 * The human gate, operable from the CLI (build plan: gate at publish / destructive
 * verdicts / client-facing). Transitions a decision through its lifecycle and, on
 * execute, auto-writes the linked changelog row so the decision -> execution link
 * is never lost.
 *
 *   npm run db:decision -- list [--status=proposed]
 *   npm run db:decision -- approve  --id=<uuid> --by="Febiola"
 *   npm run db:decision -- reject   --id=<uuid> --by="Febiola" [--note=...]
 *   npm run db:decision -- execute  --id=<uuid> --by="web team" [--action=merged] [--date=YYYY-MM-DD]
 *   npm run db:decision -- supersede --id=<uuid> --by=<newDecisionId>
 *
 * Rules: approve/reject require status=proposed. execute requires status=approved
 * (the gate must have been passed) — this is what stops merge/redirect/prune from
 * running unreviewed.
 */
import { loadDevEnv } from "@/lib/dev-env";
import { VERDICT_ACTION } from "./store-helpers";

loadDevEnv();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const action = process.argv[2];
  const { env } = await import("@/lib/env");
  const { db } = await import("./client");
  const { decisions } = await import("./schema");
  const { and, eq, desc } = await import("drizzle-orm");
  const {
    getDecision,
    setDecisionStatus,
    appendChangelog,
  } = await import("./decisions-writes");
  const site = env.SITE_KEY;

  if (!action || action === "list") {
    const status = arg("status") ?? "proposed";
    const rows = await db
      .select({
        id: decisions.id,
        verdict: decisions.verdict,
        status: decisions.status,
        url: decisions.url,
        confidence: decisions.confidence,
        producedBy: decisions.producedBy,
        decidedAt: decisions.decidedAt,
      })
      .from(decisions)
      .where(and(eq(decisions.site, site), eq(decisions.status, status as never)))
      .orderBy(desc(decisions.decidedAt))
      .limit(50);
    console.log(`\n${rows.length} decision(s) with status="${status}":\n`);
    for (const r of rows) {
      console.log(`  ${r.id}`);
      console.log(`    [${r.verdict}] ${r.url}`);
      console.log(`    by=${r.producedBy} conf=${r.confidence ?? "-"} decided=${r.decidedAt}`);
    }
    if (rows.length) console.log(`\n  Approve: npm run db:decision -- approve --id=<id> --by="<name>"`);
    return;
  }

  const id = arg("id");
  if (!id) throw new Error("--id=<uuid> is required");
  const by = arg("by");
  const d = await getDecision(id);
  if (!d) throw new Error(`decision ${id} not found`);

  if (action === "approve") {
    if (d.status !== "proposed") throw new Error(`can only approve a proposed decision (is: ${d.status})`);
    if (!by) throw new Error('--by="<approver name>" is required');
    await setDecisionStatus(id, "approved", { approvedBy: by });
    console.log(JSON.stringify({ id, status: "approved", approvedBy: by, verdict: d.verdict, url: d.url }, null, 2));
    if (["merge", "redirect", "prune"].includes(d.verdict)) {
      console.log(`\n  ⚠ Destructive verdict approved. Execute when done: npm run db:decision -- execute --id=${id} --by="<executor>"`);
    }
    return;
  }

  if (action === "reject") {
    if (d.status !== "proposed") throw new Error(`can only reject a proposed decision (is: ${d.status})`);
    await setDecisionStatus(id, "rejected", { approvedBy: by ?? null });
    console.log(JSON.stringify({ id, status: "rejected", by: by ?? null, note: arg("note") ?? null }, null, 2));
    return;
  }

  if (action === "supersede") {
    const newId = arg("by");
    await setDecisionStatus(id, "superseded", { supersededById: newId ?? null });
    console.log(JSON.stringify({ id, status: "superseded", supersededById: newId ?? null }, null, 2));
    return;
  }

  if (action === "execute") {
    if (d.status !== "approved") {
      throw new Error(`execute requires status=approved (is: ${d.status}). Approve it first — the gate is deliberate.`);
    }
    if (!by) throw new Error('--by="<executor>" is required');
    const changelogAction = arg("action") ?? VERDICT_ACTION[d.verdict] ?? "other";
    const actionDate = arg("date") ?? today();
    const { id: clId } = await appendChangelog({
      site,
      articleId: d.articleId,
      url: d.url,
      action: changelogAction as never,
      decisionId: d.id,
      executedBy: by,
      executorKind: "human",
      approvedBy: d.approvedBy,
      actionDate,
      hypothesis: d.expectedImpact,
      detail: { verdict: d.verdict, executed_from_decision: d.id, rationale: d.rationale },
    });
    await setDecisionStatus(id, "executed");
    console.log(JSON.stringify({ id, status: "executed", changelog_id: clId, action: changelogAction, actionDate, by }, null, 2));
    return;
  }

  throw new Error(`unknown action "${action}". Use: list | approve | reject | execute | supersede`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("decision failed:", err.message);
    process.exit(1);
  });

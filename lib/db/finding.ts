/**
 * Findings triage from the CLI (build plan: site-audit / link-health resolution
 * tracking). Transitions a finding's status so "did we fix the P1 404s?" has an
 * answer, and a monthly re-detection of a resolved-but-recurring issue reopens it
 * automatically (see findings-log.ts).
 *
 *   npm run db:finding -- list [--status=open] [--skill=site-audit]
 *   npm run db:finding -- resolve  --id=<uuid>
 *   npm run db:finding -- escalate --id=<uuid>
 *   npm run db:finding -- wontfix  --id=<uuid>
 *   npm run db:finding -- triage   --id=<uuid>
 */
import { loadDevEnv } from "@/lib/dev-env";

loadDevEnv();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}

const ACTION_STATUS: Record<string, string> = {
  resolve: "resolved",
  escalate: "escalated",
  wontfix: "wont_fix",
  triage: "triaged",
};

async function main() {
  const action = process.argv[2];
  const { env } = await import("@/lib/env");
  const { db } = await import("./client");
  const { findings } = await import("./schema");
  const { and, eq, asc, desc } = await import("drizzle-orm");
  const { getFinding, setFindingStatus } = await import("./decisions-writes");
  const site = env.SITE_KEY;

  if (!action || action === "list") {
    const status = arg("status") ?? "open";
    const conds = [eq(findings.site, site), eq(findings.status, status as never)];
    if (arg("skill")) conds.push(eq(findings.sourceSkill, arg("skill")!));
    const rows = await db
      .select({
        id: findings.id,
        sourceSkill: findings.sourceSkill,
        severity: findings.severity,
        category: findings.category,
        issue: findings.issue,
        url: findings.url,
        owner: findings.owner,
        lastDetectedAt: findings.lastDetectedAt,
      })
      .from(findings)
      .where(and(...conds))
      .orderBy(asc(findings.severity), desc(findings.lastDetectedAt))
      .limit(60);
    console.log(`\n${rows.length} finding(s) status="${status}"${arg("skill") ? ` skill=${arg("skill")}` : ""}:\n`);
    for (const r of rows) {
      console.log(`  ${r.id}  [${r.severity ?? "-"}] ${r.sourceSkill}/${r.category}`);
      console.log(`    ${r.issue}`);
      console.log(`    ${r.url}  owner=${r.owner ?? "-"}  last=${r.lastDetectedAt}`);
    }
    if (rows.length) console.log(`\n  Resolve: npm run db:finding -- resolve --id=<id>`);
    return;
  }

  const status = ACTION_STATUS[action];
  if (!status) throw new Error(`unknown action "${action}". Use: list | resolve | escalate | wontfix | triage`);
  const id = arg("id");
  if (!id) throw new Error("--id=<uuid> is required");
  const f = await getFinding(id);
  if (!f) throw new Error(`finding ${id} not found`);
  await setFindingStatus(id, status as never);
  console.log(JSON.stringify({ id, status, issue: f.issue, url: f.url }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("finding failed:", err.message);
    process.exit(1);
  });

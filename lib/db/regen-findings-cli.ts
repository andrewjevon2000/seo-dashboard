/**
 * Records live-regenerated historical findings into the decision store:
 *   `npm run db:regen-findings`
 *
 * Idempotent — safe to re-run as more findings are added to regen-findings.ts.
 * See that file for the integrity contract (every figure from a live pull).
 */
import { loadDevEnv } from "@/lib/dev-env";

loadDevEnv();

const { recordFindings } = await import("./regen-findings");

recordFindings()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

/**
 * GA4 connectivity check: validates the live setup (service account, API, property
 * access, CTA event) in one command BEFORE running the full pipeline.
 *   npm run ga4:check
 *
 * It exercises the real path (pullGa4Pages) and interprets the common failures so
 * you know which setup step to fix, instead of a raw stack trace.
 */
import { loadDevEnv } from "@/lib/dev-env";
import { windowEnding } from "@/lib/db/store-helpers";

loadDevEnv();

function diagnose(msg: string): string {
  if (/not configured/i.test(msg)) return "creds missing — set GA4_PROPERTY_ID + service account (or reuse GOOGLE_SERVICE_ACCOUNT_*).";
  if (/\b404\b/.test(msg)) return "property not found — GA4_PROPERTY_ID is likely wrong. Use the NUMERIC property id (Admin → Property Settings), not the G-XXXX measurement id.";
  if (/\b403\b/.test(msg)) return "permission denied — either the Google Analytics Data API isn't enabled in the GCP project, OR the service account isn't granted Viewer under GA4 Admin → Property Access Management.";
  if (/\b401\b|invalid_grant|invalid_client/i.test(msg)) return "auth failed — the service account email/private key is wrong or malformed (check the \\n escaping in GA4_SERVICE_ACCOUNT_PRIVATE_KEY).";
  return "unexpected error — see the message above.";
}

async function main() {
  const { env } = await import("@/lib/env");

  console.log("\nGA4 connectivity check\n──────────────────────");
  console.log(`  GA4_PROPERTY_ID:        ${env.GA4_PROPERTY_ID || "(unset)"}`);
  console.log(`  service account email:  ${env.ga4ServiceAccountEmail ? env.ga4ServiceAccountEmail : "(unset)"}${!env.GA4_SERVICE_ACCOUNT_EMAIL && env.ga4ServiceAccountEmail ? "  (falling back to GOOGLE_SERVICE_ACCOUNT_EMAIL)" : ""}`);
  console.log(`  service account key:    ${env.ga4ServiceAccountKey ? "present" : "(unset)"}`);
  console.log(`  GA4_CTA_EVENT_NAME:     ${env.GA4_CTA_EVENT_NAME || "(unset — CTA stage will be skipped)"}`);
  console.log(`  GA4_ORGANIC_ONLY:       ${env.ga4OrganicOnly}`);

  if (env.useFixtures) {
    console.log("\n  ⚠ USE_PIPELINE_FIXTURES is ON — this validates NOTHING live. Unset it to test the real GA4 connection.");
    return;
  }
  if (!env.ga4Configured) {
    console.log("\n  ✗ GA4 not configured. Missing: " +
      [!env.GA4_PROPERTY_ID && "GA4_PROPERTY_ID", !env.ga4ServiceAccountEmail && "service account email", !env.ga4ServiceAccountKey && "service account key"].filter(Boolean).join(", "));
    console.log("    The pipeline will simply skip GA4 until these are set (non-fatal).");
    process.exitCode = 1;
    return;
  }

  const { from, to } = windowEnding(new Date());
  console.log(`\n  Querying property ${env.GA4_PROPERTY_ID} for ${from} → ${to} ...`);

  const { pullGa4Pages } = await import("./ga4");
  let pages;
  try {
    pages = await pullGa4Pages(from, to);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`\n  ✗ FAILED: ${msg}`);
    console.log(`  → ${diagnose(msg)}`);
    process.exitCode = 1;
    return;
  }

  const totalSessions = pages.reduce((a, p) => a + (p.sessions || 0), 0);
  console.log(`\n  ✓ Auth OK, property reachable.`);
  console.log(`  ✓ ${pages.length} page(s) returned, ${totalSessions} total sessions (${env.ga4OrganicOnly ? "organic-search only" : "all traffic"}).`);
  for (const p of [...pages].sort((a, b) => b.sessions - a.sessions).slice(0, 3)) {
    console.log(`      ${p.path}  sessions=${p.sessions} engaged=${p.engagedSessions}`);
  }

  if (env.GA4_CTA_EVENT_NAME?.trim()) {
    const withCta = pages.filter((p) => (p.ctaClicks ?? 0) > 0).length;
    const totalCta = pages.reduce((a, p) => a + (p.ctaClicks ?? 0), 0);
    console.log(`  ${totalCta > 0 ? "✓" : "⚠"} CTA event "${env.GA4_CTA_EVENT_NAME}": ${totalCta} clicks across ${withCta} page(s)` +
      (totalCta === 0 ? " — event name is configured but returned no data (wrong name, or GTM not firing it yet)." : "."));
  } else {
    console.log(`  · CTA: GA4_CTA_EVENT_NAME unset → CTA funnel stage skipped (not fabricated).`);
  }

  console.log(`\n  Ready. Run the pipeline to persist: npm run pipeline:run\n`);
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("ga4:check failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });

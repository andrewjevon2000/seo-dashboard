import { NextResponse } from "next/server";
import { runWeeklyPull } from "@/lib/pipeline/run";

/**
 * Weekly pipeline entrypoint, invoked by Vercel Cron (brief §5). Secured by
 * CRON_SECRET: Vercel automatically sends `Authorization: Bearer <CRON_SECRET>`
 * when that env var is set. Manual invocation must supply the same header.
 *
 * Node runtime (not edge) — it uses the postgres driver and the Google Sheet SDK.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 60s keeps within the Vercel Hobby cap; the weekly pull (one gsc-pages call +
// GA4 + inserts) fits comfortably. The credit-heavy backfill runs via the CLI,
// not this route, so it isn't bound by the function timeout.
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if not configured
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const periodEnd = url.searchParams.get("end") ?? new Date().toISOString().slice(0, 10);
  const windowDays = Number(url.searchParams.get("days") ?? "7");

  try {
    const result = await runWeeklyPull({ periodEnd, windowDays });
    return NextResponse.json(result, { status: result.skipped ? 202 : 200 });
  } catch (err) {
    console.error("[cron/pull] failed", err);
    return NextResponse.json(
      { error: "pipeline_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;

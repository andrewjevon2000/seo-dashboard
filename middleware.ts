import { NextRequest, NextResponse } from "next/server";

/**
 * Single shared-password HTTP Basic auth over the whole dashboard (brief §7).
 * "Internal-only" still means public URL, so the app is gated — but a single
 * shared credential is sufficient for a single-user internal tool.
 *
 * The cron route is intentionally NOT basic-auth'd here — it authenticates with
 * CRON_SECRET instead (see app/api/cron/pull/route.ts), so it's excluded below.
 * Reads process.env directly (not lib/env) to stay edge-safe.
 */
export function middleware(req: NextRequest) {
  const user = process.env.DASHBOARD_USER || "verihubs";
  const password = process.env.DASHBOARD_PASSWORD;

  // If no password is configured, don't lock the operator out in local dev.
  if (!password) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(":");
      const u = decoded.slice(0, idx);
      const p = decoded.slice(idx + 1);
      if (u === user && p === password) return NextResponse.next();
    } catch {
      // fall through to challenge
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Verihubs SEO Dashboard", charset="UTF-8"' },
  });
}

export const config = {
  // Protect everything except the cron endpoint, Next internals, and static files.
  matcher: ["/((?!api/cron|_next/static|_next/image|favicon.ico).*)"],
};

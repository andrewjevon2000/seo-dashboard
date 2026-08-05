/**
 * URL normalization — the single, consistent join key rule (brief §3.4, §8).
 *
 * DECISION (apply identically everywhere a URL becomes a join key):
 *   - force scheme to https
 *   - lowercase host, strip a leading "www."
 *   - drop the port if it is the default (80/443)
 *   - strip ALL query params (incl. UTM) and the #fragment
 *   - strip a trailing slash (except for the root path "/")
 *   - preserve path case (paths can be case-sensitive on some servers)
 *
 * GSC reports full URLs; GA4 (Phase 2) reports page paths. `normalizePath`
 * exists so a GA4 path can be normalized the same way and compared against
 * the path component of an already-normalized article URL.
 */

export function normalizeUrl(raw: string): string {
  if (!raw) return raw;
  let input = raw.trim();
  // Tolerate scheme-less inputs from the sheet, e.g. "verihubs.com/blog/x".
  if (!/^https?:\/\//i.test(input)) {
    input = "https://" + input.replace(/^\/\//, "");
  }

  let u: URL;
  try {
    u = new URL(input);
  } catch {
    // Not a parseable URL — return trimmed original so the caller can decide.
    return raw.trim();
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  // pathname is always present and begins with "/". Strip trailing slashes,
  // collapsing the bare root "/" to a host-only URL.
  const path = u.pathname.replace(/\/+$/, "");
  return `https://${host}${path}`;
}

/** Normalize a bare path (GA4-style) to match a normalized URL's path segment. */
export function normalizePath(rawPath: string): string {
  if (!rawPath) return rawPath;
  let p = rawPath.trim().split(/[?#]/)[0];
  if (!p.startsWith("/")) p = "/" + p;
  if (p !== "/") p = p.replace(/\/+$/, "");
  return p;
}

/** Extract the normalized path from a full URL (for joining GA4 → articles). */
export function pathOf(url: string): string {
  try {
    return normalizePath(new URL(url).pathname);
  } catch {
    return normalizePath(url);
  }
}

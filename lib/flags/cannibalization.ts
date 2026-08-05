import { readFile } from "node:fs/promises";
import { env } from "@/lib/env";
import { normalizeUrl } from "@/lib/pipeline/normalize";

/**
 * Cannibalization risk is PIPED IN from the existing `cannibalization-check`
 * skill output (brief §6) — never recomputed here. CANNIBALIZATION_SOURCE points
 * at a JSON file path or URL. If unset, the flag is unavailable and the column
 * hides itself.
 *
 * Accepted JSON shapes (tolerant):
 *   - { "https://verihubs.com/blog/x": true, ... }
 *   - { "https://.../x": { "risk": true, "note": "overlaps /y" }, ... }
 *   - [ { "url": "...", "risk": true, "note": "..." }, ... ]
 */

export interface CannibalizationEntry {
  risk: boolean;
  note?: string;
}

export type CannibalizationMap = Map<string, CannibalizationEntry>;

let cache: { map: CannibalizationMap; available: boolean } | null = null;

async function loadRaw(source: string): Promise<unknown> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { cache: "no-store" });
    if (!res.ok) throw new Error(`cannibalization source fetch failed: ${res.status}`);
    return res.json();
  }
  const text = await readFile(source, "utf8");
  return JSON.parse(text);
}

function coerce(raw: unknown): CannibalizationMap {
  const map: CannibalizationMap = new Map();
  const add = (url: string, entry: CannibalizationEntry) => {
    if (url) map.set(normalizeUrl(url), entry);
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === "object" && "url" in item) {
        const o = item as { url: string; risk?: boolean; note?: string };
        add(o.url, { risk: o.risk ?? true, note: o.note });
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [url, val] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof val === "boolean") add(url, { risk: val });
      else if (val && typeof val === "object") {
        const o = val as { risk?: boolean; note?: string };
        add(url, { risk: o.risk ?? true, note: o.note });
      }
    }
  }
  return map;
}

/** Load (and memoize) the cannibalization map. Never throws to the caller. */
export async function loadCannibalization(): Promise<{
  map: CannibalizationMap;
  available: boolean;
}> {
  if (cache) return cache;
  if (!env.CANNIBALIZATION_SOURCE) {
    cache = { map: new Map(), available: false };
    return cache;
  }
  try {
    const map = coerce(await loadRaw(env.CANNIBALIZATION_SOURCE));
    cache = { map, available: true };
  } catch {
    // Source configured but unreadable — treat as unavailable, don't break the page.
    cache = { map: new Map(), available: false };
  }
  return cache;
}

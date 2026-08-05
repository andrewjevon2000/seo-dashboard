"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ArticleRow } from "@/lib/db/queries";
import { Sparkline } from "./sparkline";

/**
 * Sortable/filterable article table (brief §6). Filtering happens server-side via
 * URL params (see FilterChips); sorting is client-side over the already-filtered
 * rows. Each row links to the article detail view. Computed flag columns:
 * Declining, CTR-position mismatch, and Cannibalization (piped in).
 */

type SortKey = "url" | "clicks" | "impressions" | "ctr" | "position";
type Dir = "asc" | "desc";

function pathLabel(url: string): string {
  try {
    return new URL(url).pathname || url;
  } catch {
    return url;
  }
}

function fmtNum(v: number | null): string {
  return v == null ? "—" : Math.round(v).toLocaleString();
}
function fmtCtr(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}
function fmtPos(v: number | null): string {
  return v == null ? "—" : v.toFixed(1);
}

function Delta({ cur, prev, invert = false }: { cur: number | null; prev: number | null; invert?: boolean }) {
  if (cur == null || prev == null) return null;
  const diff = cur - prev;
  if (Math.abs(diff) < 0.0001) return <span className="text-[10px] text-muted">·</span>;
  // For position, down (lower number) is good → invert color meaning.
  const good = invert ? diff < 0 : diff > 0;
  return (
    <span className={`ml-1 text-[10px] tabular ${good ? "text-good" : "text-bad"}`}>
      {diff > 0 ? "▲" : "▼"}
    </span>
  );
}

function FlagPill({ tone, title, children }: { tone: "bad" | "warn"; title: string; children: React.ReactNode }) {
  const cls = tone === "bad" ? "border-bad/40 text-bad" : "border-warn/40 text-warn";
  return (
    <span title={title} className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

export function ArticleTable({
  rows,
  cannibalizationAvailable,
}: {
  rows: ArticleRow[];
  cannibalizationAvailable: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("clicks");
  const [dir, setDir] = useState<Dir>("desc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sortKey === "url") {
        av = a.url;
        bv = b.url;
      } else {
        av = a.latest[sortKey] ?? -Infinity;
        bv = b.latest[sortKey] ?? -Infinity;
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, dir]);

  function toggle(key: SortKey) {
    if (key === sortKey) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setDir(key === "url" ? "asc" : "desc");
    }
  }

  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th
      onClick={() => toggle(k)}
      className={`cursor-pointer select-none px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-ink ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
      {sortKey === k && <span className="ml-1 text-accent">{dir === "asc" ? "↑" : "↓"}</span>}
    </th>
  );

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-edge bg-panel p-8 text-center text-sm text-muted">
        No articles match this filter yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-edge">
      <table className="w-full border-collapse bg-panel text-sm">
        <thead className="border-b border-edge bg-canvas/40">
          <tr>
            <Th k="url">Article</Th>
            <Th k="clicks" right>Clicks</Th>
            <Th k="impressions" right>Impr.</Th>
            <Th k="ctr" right>CTR</Th>
            <Th k="position" right>Pos.</Th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              Trend
            </th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              Flags
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className="border-b border-edge/60 last:border-0 hover:bg-canvas/30">
              <td className="max-w-[380px] px-3 py-2">
                <Link href={`/articles/${r.id}`} className="block">
                  <div className="truncate font-medium text-ink hover:text-accent">
                    {pathLabel(r.url)}
                  </div>
                  <div className="flex items-center gap-2 truncate text-[11px] text-muted">
                    {r.keyword && <span className="truncate">{r.keyword}</span>}
                    {r.contentType && (
                      <span className="rounded bg-edge px-1 py-0.5 text-[9px] uppercase tracking-wide">
                        {r.contentType}
                      </span>
                    )}
                    {r.topicCluster && (
                      <span className="rounded bg-accent/15 px-1 py-0.5 text-[9px] text-accent">
                        {r.topicCluster}
                      </span>
                    )}
                  </div>
                </Link>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular text-ink">
                {fmtNum(r.latest.clicks)}
                <Delta cur={r.latest.clicks} prev={r.previous.clicks} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular text-muted">
                {fmtNum(r.latest.impressions)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular text-muted">
                {fmtCtr(r.latest.ctr)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular text-muted">
                {fmtPos(r.latest.position)}
                <Delta cur={r.latest.position} prev={r.previous.position} invert />
              </td>
              <td className="px-3 py-2">
                <Sparkline values={r.clicksSparkline.map((p) => p.value)} />
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {r.flags.declining && (
                    <FlagPill tone="bad" title="Clicks trending down over consecutive periods">
                      Declining
                    </FlagPill>
                  )}
                  {r.flags.ctrMismatch && (
                    <FlagPill tone="warn" title="Ranks well but CTR is below the benchmark for its position">
                      CTR gap
                    </FlagPill>
                  )}
                  {cannibalizationAvailable && r.flags.cannibalization && (
                    <FlagPill
                      tone="warn"
                      title={r.flags.cannibalizationNote ?? "Cannibalization risk (from cannibalization-check)"}
                    >
                      Cannib.
                    </FlagPill>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

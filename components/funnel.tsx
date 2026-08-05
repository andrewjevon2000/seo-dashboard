import type { FunnelStage } from "@/lib/db/queries";

/**
 * Per-article funnel (brief §6 Phase 2): impression → click → session →
 * engaged session → CTA click. The first two stages are GSC (search-side), the
 * rest are GA4 (site-side). Those systems measure differently and never
 * reconcile (§3.4), so every stage is labeled with its source and the two groups
 * are visually separated — never presented as one directly-comparable count.
 *
 * Degrades gracefully: GA4 stages render as "not connected" until GA4 lands, and
 * the CTA stage renders as "not tracked" until the GTM event exists (§3.3).
 */

function fmt(v: number | null): string {
  return v == null ? "—" : Math.round(v).toLocaleString();
}

function SourceBadge({ source }: { source: "gsc" | "ga4" }) {
  const cls = source === "gsc" ? "bg-accent/15 text-accent" : "bg-good/15 text-good";
  return (
    <span className={`rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide ${cls}`}>
      {source}
    </span>
  );
}

export function Funnel({ stages, hasGa4 }: { stages: FunnelStage[]; hasGa4: boolean }) {
  // Scale bars against the largest available value (impressions, typically).
  const max = Math.max(1, ...stages.filter((s) => s.value != null).map((s) => s.value as number));

  return (
    <div className="rounded-lg border border-edge bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Conversion funnel</h2>
        <span className="text-[11px] text-muted">latest period</span>
      </div>

      <div className="flex flex-col gap-2">
        {stages.map((s, i) => {
          const prev = stages[i - 1];
          // Stage-to-stage conversion only within the same source (cross-source
          // ratios would be misleading — different measurement methodology).
          const showConv =
            i > 0 &&
            prev.source === s.source &&
            prev.value != null &&
            s.value != null &&
            prev.value > 0;
          const conv = showConv ? ((s.value as number) / (prev.value as number)) * 100 : null;
          const widthPct = s.value != null ? Math.max(2, ((s.value as number) / max) * 100) : 0;
          const barCls = s.source === "gsc" ? "bg-accent/40" : "bg-good/40";

          // Separator between the GSC group and the GA4 group.
          const groupBreak = i > 0 && prev.source === "gsc" && s.source === "ga4";

          return (
            <div key={s.key}>
              {groupBreak && (
                <div className="my-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted/70">
                  <span className="h-px flex-1 bg-edge" />
                  search → site (different measurement; not directly comparable)
                  <span className="h-px flex-1 bg-edge" />
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="flex w-40 shrink-0 items-center gap-2">
                  <SourceBadge source={s.source} />
                  <span className="text-xs text-ink">{s.label}</span>
                </div>
                <div className="relative h-6 flex-1 overflow-hidden rounded bg-canvas/50">
                  {s.available ? (
                    <div className={`h-full rounded ${barCls}`} style={{ width: `${widthPct}%` }} />
                  ) : (
                    <div className="flex h-full items-center px-2 text-[10px] italic text-muted/70">
                      {s.source === "ga4" && !hasGa4
                        ? "GA4 not connected yet"
                        : s.key === "cta_clicks"
                          ? "CTA event not tracked (configure in GTM)"
                          : "no data"}
                    </div>
                  )}
                </div>
                <div className="w-24 shrink-0 text-right">
                  <span className="tabular text-sm text-ink">{fmt(s.value)}</span>
                  {conv != null && (
                    <span className="ml-1 text-[10px] tabular text-muted">{conv.toFixed(0)}%</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted/80">
        GSC (search) and GA4 (site) use different measurement methodology, bot filtering, and
        consent handling — the counts are not directly comparable. Conversion percentages are shown
        only within the same source.
      </p>
    </div>
  );
}

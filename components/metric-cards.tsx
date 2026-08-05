import type { AggregateSummary } from "@/lib/db/queries";
import { Sparkline } from "./sparkline";

/**
 * Filter-aware aggregate cards (brief §6). These recompute for the active filter
 * — that is what makes cluster-level performance comparison possible ("how is the
 * whole deepfake cluster trending"), not just row narrowing.
 */

function pct(cur: number, prev: number): { text: string; cls: string } {
  if (prev === 0) return { text: cur > 0 ? "new" : "—", cls: "text-muted" };
  const delta = ((cur - prev) / prev) * 100;
  const cls = delta > 0.5 ? "text-good" : delta < -0.5 ? "text-bad" : "text-muted";
  const sign = delta > 0 ? "+" : "";
  return { text: `${sign}${delta.toFixed(1)}%`, cls };
}

function Card({
  label,
  value,
  delta,
  children,
}: {
  label: string;
  value: string;
  delta?: { text: string; cls: string };
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-edge bg-panel p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="tabular text-2xl font-semibold text-ink">{value}</span>
        {delta && <span className={`tabular text-xs font-medium ${delta.cls}`}>{delta.text}</span>}
      </div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function MetricCards({ agg }: { agg: AggregateSummary }) {
  const clicksSeries = agg.series.map((s) => s.clicks);
  const imprSeries = agg.series.map((s) => s.impressions);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Card
        label="Articles"
        value={agg.articleCount.toLocaleString()}
      />
      <Card
        label="Clicks (latest)"
        value={agg.totalClicks.toLocaleString()}
        delta={pct(agg.totalClicks, agg.totalClicksPrev)}
      >
        <Sparkline values={clicksSeries} width={140} />
      </Card>
      <Card
        label="Impressions (latest)"
        value={agg.totalImpressions.toLocaleString()}
        delta={pct(agg.totalImpressions, agg.totalImpressionsPrev)}
      >
        <Sparkline values={imprSeries} width={140} strokeClass="stroke-muted" />
      </Card>
      <Card
        label="Avg CTR · Avg pos"
        value={`${(agg.avgCtr * 100).toFixed(1)}%`}
        delta={
          agg.avgPosition != null
            ? { text: `pos ${agg.avgPosition.toFixed(1)}`, cls: "text-muted" }
            : undefined
        }
      />
    </div>
  );
}

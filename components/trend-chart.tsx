"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import type { MetricPoint } from "@/lib/db/queries";

/**
 * Full historical trend for one article (brief §6, detail view). Clicks &
 * impressions on a left axis; CTR (%) and average position on a right axis.
 * Position is inverted so "up = better" reads intuitively.
 */

type Metric = "clicks" | "impressions" | "ctr" | "position";

export function TrendChart({ series }: { series: Record<Metric, MetricPoint[]> }) {
  // Merge all metrics onto a shared date axis.
  const byDate = new Map<string, Record<string, number>>();
  (Object.keys(series) as Metric[]).forEach((m) => {
    for (const p of series[m]) {
      const row = byDate.get(p.date) ?? { date: p.date as unknown as number };
      row[m] = m === "ctr" ? p.value * 100 : p.value;
      byDate.set(p.date, row);
    }
  });
  const data = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, v]) => v);

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-edge bg-panel p-8 text-center text-sm text-muted">
        No performance history yet for this article.
      </div>
    );
  }

  const axis = { stroke: "#8a94a6", fontSize: 11 };

  return (
    <div className="h-[360px] w-full rounded-lg border border-edge bg-panel p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#232a36" />
          <XAxis dataKey="date" tick={axis} tickLine={false} axisLine={{ stroke: "#232a36" }} />
          <YAxis yAxisId="left" tick={axis} tickLine={false} axisLine={false} width={48} />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={axis}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          {/* Position axis inverted: lower (better) rank plots higher. */}
          <YAxis
            yAxisId="pos"
            orientation="right"
            reversed
            tick={axis}
            tickLine={false}
            axisLine={false}
            width={32}
            hide
          />
          <Tooltip
            contentStyle={{
              background: "#141922",
              border: "1px solid #232a36",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "#e6eaf0" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line yAxisId="left" type="monotone" dataKey="clicks" stroke="#4c8dff" dot={false} strokeWidth={2} />
          <Line yAxisId="left" type="monotone" dataKey="impressions" stroke="#8a94a6" dot={false} strokeWidth={1.5} />
          <Line yAxisId="right" type="monotone" dataKey="ctr" name="CTR %" stroke="#3fb950" dot={false} strokeWidth={1.5} />
          <Line yAxisId="pos" type="monotone" dataKey="position" name="Avg position" stroke="#d29922" dot={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

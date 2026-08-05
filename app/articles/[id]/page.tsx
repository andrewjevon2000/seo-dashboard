import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticleDetail } from "@/lib/db/queries";
import { TrendChart } from "@/components/trend-chart";
import { Funnel } from "@/components/funnel";

/**
 * Article detail view (brief §6): full historical trend chart, plus the target
 * keyword(s) from the content plan shown alongside actual performance.
 */

export const dynamic = "force-dynamic";

function latest(series: { value: number }[]): number | null {
  return series.length ? series[series.length - 1].value : null;
}

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const article = await getArticleDetail(id);
  if (!article) notFound();

  const stats: { label: string; value: string }[] = [
    { label: "Clicks", value: fmt(latest(article.series.clicks)) },
    { label: "Impressions", value: fmt(latest(article.series.impressions)) },
    {
      label: "CTR",
      value: (() => {
        const v = latest(article.series.ctr);
        return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
      })(),
    },
    {
      label: "Avg position",
      value: (() => {
        const v = latest(article.series.position);
        return v == null ? "—" : v.toFixed(1);
      })(),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/articles" className="text-xs text-muted hover:text-ink">
          ← Back to articles
        </Link>
        <h1 className="break-words text-lg font-semibold text-ink">
          <a href={article.url} target="_blank" rel="noreferrer" className="hover:text-accent">
            {article.url}
          </a>
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
          {article.contentType && (
            <span className="rounded bg-edge px-1.5 py-0.5 uppercase tracking-wide">
              {article.contentType}
            </span>
          )}
          {article.topicCluster && (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">{article.topicCluster}</span>
          )}
          {article.batch && <span>Batch {article.batch}</span>}
          {article.publishDate && <span>Published {article.publishDate}</span>}
        </div>
      </div>

      {/* Target keyword from the content plan, alongside actual performance. */}
      <div className="rounded-lg border border-edge bg-panel p-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Target keyword (content plan)
        </div>
        <div className="mt-1 text-sm text-ink">{article.keyword ?? "— (not set in plan)"}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-edge bg-panel p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{s.label}</div>
            <div className="tabular mt-1 text-2xl font-semibold text-ink">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Phase 2 funnel: impression → click → session → engaged → CTA. */}
      <Funnel stages={article.funnel} hasGa4={article.hasGa4} />

      {article.hasGa4 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: "Sessions", value: gaLatest(article.ga4Series.sessions) },
            { label: "Engaged sessions", value: gaLatest(article.ga4Series.engaged_sessions) },
            {
              label: "Avg engagement",
              value: (() => {
                const eng = latest(article.ga4Series.engagement_time);
                const es = latest(article.ga4Series.engaged_sessions);
                return eng != null && es && es > 0 ? `${Math.round(eng / es)}s` : "—";
              })(),
            },
            { label: "CTA clicks", value: gaLatest(article.ga4Series.cta_clicks) },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-edge bg-panel p-4">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                <span className="rounded bg-good/15 px-1 py-0.5 text-[9px] text-good">GA4</span>
                {s.label}
              </div>
              <div className="tabular mt-1 text-2xl font-semibold text-ink">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-ink">Historical trend (GSC)</h2>
        <TrendChart series={article.series} />
      </div>
    </div>
  );
}

function gaLatest(series: { value: number }[]): string {
  return fmt(latest(series));
}

function fmt(v: number | null): string {
  return v == null ? "—" : Math.round(v).toLocaleString();
}

import { getArticleList, getDistinctTopicClusters } from "@/lib/db/queries";
import { FilterChips } from "@/components/filter-chips";
import { MetricCards } from "@/components/metric-cards";
import { ArticleTable } from "@/components/article-table";

/**
 * Article list view (brief §6). Server Component: reads filters from the URL,
 * queries the DB directly (no API layer — single user), and renders filter-aware
 * aggregates + the sortable table. Filters live in the query string so a filtered
 * view is bookmarkable.
 */

export const dynamic = "force-dynamic"; // always reflect latest snapshots

function normType(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.toLowerCase();
  return t === "pillar" || t === "cluster" ? t : null;
}

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; cluster?: string }>;
}) {
  const sp = await searchParams;
  const contentType = normType(sp.type);
  const topicCluster = sp.cluster?.trim() || null;

  const [result, clusters] = await Promise.all([
    getArticleList({ contentType, topicCluster }),
    getDistinctTopicClusters(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-ink">Articles</h1>
        <p className="text-xs text-muted">
          GSC performance per article, joined to the Verihubs content plan. Aggregates below
          reflect the active filter.
        </p>
      </div>

      <FilterChips
        contentType={contentType}
        topicCluster={topicCluster}
        clusters={clusters}
        clusterFilterAvailable={result.topicClusterFilterAvailable}
      />

      <MetricCards agg={result.aggregates} />

      <ArticleTable rows={result.rows} cannibalizationAvailable={result.cannibalizationAvailable} />
    </div>
  );
}

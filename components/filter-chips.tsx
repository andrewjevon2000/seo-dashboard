"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback } from "react";

/**
 * Filter chips (brief §6). Two groups — content_type and topic_cluster — that
 * are COMBINABLE and reflected in the URL query string so a filtered view is
 * bookmarkable. The topic_cluster group degrades gracefully: when no clusters
 * exist yet (column not backfilled), it renders disabled instead of breaking.
 */

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        disabled
          ? "cursor-not-allowed border-edge/60 text-muted/50"
          : active
            ? "border-accent bg-accent/15 text-ink"
            : "border-edge text-muted hover:border-accent/60 hover:text-ink",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function FilterChips({
  contentType,
  topicCluster,
  clusters,
  clusterFilterAvailable,
}: {
  contentType: string | null;
  topicCluster: string | null;
  clusters: string[];
  clusterFilterAvailable: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value == null) next.delete(key);
      else next.set(key, value);
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Type
        </span>
        <Chip active={!contentType} onClick={() => setParam("type", null)}>
          All
        </Chip>
        <Chip active={contentType === "pillar"} onClick={() => setParam("type", "pillar")}>
          Pillar
        </Chip>
        <Chip active={contentType === "cluster"} onClick={() => setParam("type", "cluster")}>
          Cluster
        </Chip>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
          Topic cluster
        </span>
        {!clusterFilterAvailable ? (
          <span className="text-[11px] italic text-muted/70">
            No clusters yet — add a “Cluster” column to the content plan and backfill it.
          </span>
        ) : (
          <>
            <Chip active={!topicCluster} onClick={() => setParam("cluster", null)}>
              All
            </Chip>
            {clusters.map((c) => (
              <Chip
                key={c}
                active={topicCluster === c}
                onClick={() => setParam("cluster", topicCluster === c ? null : c)}
              >
                {c}
              </Chip>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

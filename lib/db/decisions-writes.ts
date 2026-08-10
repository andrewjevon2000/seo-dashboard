import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { articles, clients, decisions, changelog } from "./schema";
import type { NewClient, NewDecision, NewChangelogEntry } from "./schema";
import { normalizeUrl } from "@/lib/pipeline/normalize";

/**
 * Write layer for the DECISION store (build plan Fase 0/2). Mirrors the invariants
 * of pipeline-writes.ts, adapted to the decision layer:
 *
 *   - `clients` is UPSERTED on id (the site slug) — re-running config is safe.
 *   - `decisions` / `changelog` are APPEND-ONLY history. There is no UPDATE path
 *     to a verdict; a decision is replaced by inserting a NEW row and marking the
 *     old one superseded. These helpers only INSERT.
 *   - Backfill and skill re-runs must be IDEMPOTENT without a DB unique constraint
 *     (a URL legitimately has many decisions over time). So the *-IfAbsent helpers
 *     dedupe on a natural key before inserting, and never double-write on re-run.
 */

/** Upsert a client profile by id (site slug). */
export async function upsertClient(client: NewClient): Promise<void> {
  await db
    .insert(clients)
    .values(client)
    .onConflictDoUpdate({
      target: clients.id,
      set: {
        name: client.name,
        successDefinition: client.successDefinition ?? null,
        activeScope: client.activeScope ?? null,
        dataTier: client.dataTier ?? null,
        locale: client.locale ?? null,
        keywordBlacklist: client.keywordBlacklist ?? null,
        publishPath: client.publishPath ?? null,
        approver: client.approver ?? null,
        active: client.active ?? true,
        updatedAt: new Date(),
      },
    });
}

/** Resolve a (possibly un-normalized) URL to an existing article id, or null. */
export async function resolveArticleId(
  url: string,
  site: string,
): Promise<string | null> {
  const norm = normalizeUrl(url);
  const [row] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.site, site), eq(articles.url, norm)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Insert a decision only if an equivalent one is not already stored. The natural
 * dedupe key is (site, url, verdict, decided_at, produced_by): the same producer
 * asserting the same verdict for the same URL on the same day is treated as the
 * same decision, so a re-run is a no-op rather than a duplicate.
 */
export async function insertDecisionIfAbsent(
  d: NewDecision,
): Promise<{ inserted: boolean; id: string | null }> {
  const url = normalizeUrl(d.url);
  const existing = await db
    .select({ id: decisions.id })
    .from(decisions)
    .where(
      and(
        eq(decisions.site, d.site ?? "verihubs"),
        eq(decisions.url, url),
        eq(decisions.verdict, d.verdict),
        eq(decisions.decidedAt, d.decidedAt),
        eq(decisions.producedBy, d.producedBy),
      ),
    )
    .limit(1);
  if (existing.length) return { inserted: false, id: existing[0].id };

  const [row] = await db
    .insert(decisions)
    .values({ ...d, url })
    .returning({ id: decisions.id });
  return { inserted: true, id: row.id };
}

/**
 * Append a changelog entry unconditionally (no dedupe). Use for genuine repeatable
 * events — e.g. a pre-publish sweep run before and after a fix on the same day
 * are two real events and must both be recorded. (Contrast insertChangelogIfAbsent,
 * which is for idempotent backfill/skill re-runs that must not duplicate.)
 */
export async function appendChangelog(
  c: NewChangelogEntry,
): Promise<{ id: string }> {
  const url = normalizeUrl(c.url);
  const [row] = await db
    .insert(changelog)
    .values({ ...c, url })
    .returning({ id: changelog.id });
  return { id: row.id };
}

/**
 * Insert a changelog entry only if an equivalent one is not already stored. The
 * natural dedupe key is (site, url, action, action_date, executed_by).
 */
export async function insertChangelogIfAbsent(
  c: NewChangelogEntry,
): Promise<{ inserted: boolean; id: string | null }> {
  const url = normalizeUrl(c.url);
  const existing = await db
    .select({ id: changelog.id })
    .from(changelog)
    .where(
      and(
        eq(changelog.site, c.site ?? "verihubs"),
        eq(changelog.url, url),
        eq(changelog.action, c.action),
        eq(changelog.actionDate, c.actionDate),
        eq(changelog.executedBy, c.executedBy),
      ),
    )
    .limit(1);
  if (existing.length) return { inserted: false, id: existing[0].id };

  const [row] = await db
    .insert(changelog)
    .values({ ...c, url })
    .returning({ id: changelog.id });
  return { inserted: true, id: row.id };
}

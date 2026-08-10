# Skill → Store wiring (Fase 2) — source patches

These 6 skills were wired to the decision store during Fase 2. The edits were
applied to the **session caches**, which agent-mode re-syncs from your account —
so they are **not permanent** until you paste them into the skill **sources**
(the claude.ai / Cowork skill editor, or your `verihubs-seo-ops` plugin project).

Each block below is additive: find the anchor line in the skill and insert the
block right after it. None of them change any check/analysis logic — they only
add a store read/write step. All the `npm run db:*` commands they call already
live in this repo (`package.json`), committed on `main`.

Skill → store map:

| Skill | Plugin | Store | Command |
|---|---|---|---|
| post-draft-sweep | verihubs-seo-ops | `changelog` | `db:sweep-log` |
| gsc-weekly-digest | verihubs-seo-ops | `keyword_snapshots` | `db:keyword-log` |
| cannibalization-check | verihubs-seo-ops | `decisions` | `db:canni-log` |
| verihubs-site-audit | anthropic-skills | `findings` | `db:findings-log` |
| verihubs-link-health | anthropic-skills | `findings` | `db:findings-log` |
| seo-report-verihubs | anthropic-skills | reads all | `db:report-read` |

> Adjust the project path in each block if the dashboard lives somewhere other
> than `C:\Users\MyBook SAGA 10\Downloads\SEO App Claude Build`.

---

## 1. post-draft-sweep (verihubs-seo-ops)

**Insert after:** `After a NOT READY result, fix the failures directly in the file without asking for confirmation, then re-run the sweep and report the new result.`

````markdown
---

## Step 8 — Persist the result to the decision store

This step ONLY records the outcome you already produced above. It changes none
of the checks. Do it after emitting the report table on **every** run (both the
initial run and any re-run after fixes) so the fail → pass trail is captured.

1. Build a JSON object matching this shape (map ✅→`pass`, ❌→`fail`, ⚠→`review`;
   READY→`ready`, NOT READY→`not_ready`; `url` = the article's target/canonical
   URL if the draft declares one, else `null`; `file` = the swept filename):

   ```json
   {
     "url": null,
     "file": "artikel-kyc-ph.html",
     "language": "en",
     "result": "not_ready",
     "checks": [
       {"n":1,"name":"Em Dash","status":"pass","note":""},
       {"n":2,"name":"Internal Links","status":"pass","note":"3 relevant links"},
       {"n":3,"name":"CTA URL","status":"fail","note":"/kontak in EN-PH article, line ~120"},
       {"n":4,"name":"Meta Title","status":"pass","note":"58 chars"},
       {"n":5,"name":"Meta Desc Language","status":"pass","note":"matches EN"},
       {"n":6,"name":"Quantitative Claims","status":"review","note":"'meningkat 40%' line ~87 no source"},
       {"n":7,"name":"Image Placeholder","status":"pass","note":"1 placeholder"}
     ]
   }
   ```

2. Write it to a temp file, then run the writer from the SEO dashboard project
   (adjust the project path if it differs on this machine):

   ```bash
   cd "C:\Users\MyBook SAGA 10\Downloads\SEO App Claude Build" && npm run db:sweep-log -- --file="<path-to-your-temp>.json"
   ```

3. The writer appends one `changelog` row (`action = pre_publish_sweep`) and prints
   the `changelog_id`. Mention it in one line, e.g.
   `Logged to decision store (changelog_id …).` If the writer errors, report the
   error but do NOT block delivery — the sweep result itself still stands.
````

---

## 2. gsc-weekly-digest (verihubs-seo-ops)

**Insert after:** `If Ahrefs GSC data is unavailable for PH market separately, note it and proceed with ID data only — do not block or ask for clarification.`

````markdown
### Step 7 — Persist keyword snapshots to the decision store

This step ONLY records the keyword data you already pulled in Step 2. It changes
none of the analysis or flagging above. Keyword-level history accumulates here so
week-over-week AI-Overview-suppression and cannibalization trends become
queryable over time (previously this data was discarded each run).

For **each market you pulled** (ID = country `id`; PH = country `ph`, only if PH
data was available):

1. Build a JSON file wrapping that market's Step-2 keyword rows. `date` = the
   current window's `date_to`. `ctr` may be percent or fraction — the writer
   normalizes it. Extra fields from `gsc-keywords` (urls_count, top_url) are
   ignored, so the raw rows can be passed through:

   ```json
   {
     "date": "2026-07-31",
     "country": "id",
     "keywords": [
       { "keyword": "apa itu kyc", "clicks": 120, "impressions": 3400, "ctr": 3.5, "position": 2.3 }
     ]
   }
   ```

2. Run the writer from the SEO dashboard project (adjust the path if it differs):

   ```bash
   cd "C:\Users\MyBook SAGA 10\Downloads\SEO App Claude Build" && npm run db:keyword-log -- --file="<path-to-your-temp>.json"
   ```

3. The writer is append-only + idempotent (re-running the same week never
   duplicates) and prints `inserted` / `skipped`. Mention it in one line, e.g.
   `Stored 30 ID keyword snapshots (0 dupes).` If it errors, report the error but
   do NOT block the digest — the readable output above still stands.
````

---

## 3. cannibalization-check (verihubs-seo-ops)

**Insert after:** `Keep verdict as the very first thing. User should be able to read verdict + recommendation in 15 seconds without reading the full table.`

````markdown
### Step — Persist the verdict to the decision store

After presenting the report, record the verdict. This does NOT change the risk
logic above — it only logs the result so the Decision Agent later has a labeled
history and the dashboard can surface the risk.

1. Map your recommendation to a `verdict` (the decision-store vocabulary):

   | Recommendation | verdict | notes |
   |---|---|---|
   | Proceed safely (existing URL) | `leave` | |
   | Proceed safely (planned keyword) | `create` | use `planned_keyword`, not `url` |
   | Differentiate angle | `leave` (existing) / `create` (planned) | say so in `rationale` |
   | Merge with [URL] | `merge` | set `target` to that URL |
   | Do not publish without redirecting [URL] | `redirect` | set `target` to that URL |

2. Build the JSON (`url` for an existing page, OR `planned_keyword` for a planned
   article; `overlaps` = your overlap table rows; omit `confidence` to derive it
   from `risk`):

   ```json
   {
     "url": "https://verihubs.com/blog/slug",
     "country": "id",
     "verdict": "merge",
     "risk": "HIGH",
     "target": "https://verihubs.com/blog/other",
     "rationale": "2 URLs rank top 5 for 'apa itu kyc'; merge to consolidate.",
     "overlaps": [ { "url": "...", "keyword": "apa itu kyc", "position": 2, "traffic": 120 } ]
   }
   ```

3. Write it to a temp file, then run from the SEO dashboard project (adjust path
   if it differs):

   ```bash
   cd "C:\Users\MyBook SAGA 10\Downloads\SEO App Claude Build" && npm run db:canni-log -- --file="<path-to-your-temp>.json"
   ```

4. The writer records a `proposed` decision (append-only, idempotent per
   URL+verdict+day) and prints the `decision_id`. Destructive verdicts
   (`merge`/`redirect`) stay `proposed` until a human approves — never auto-execute
   them. Mention the id in one line; if the write errors, report it but do not
   block the check result.
````

---

## 4. verihubs-site-audit (anthropic-skills)

**Insert after:** `Maksimum 10 baris tindakan per audit. Daftar 60 item tidak akan dikerjakan siapa pun.` (before `## Cadence`)

````markdown
---

## Step 6 — Simpan temuan ke findings store

Setelah deliverable, catat temuan P1–P6 yang **actionable** (bukan yang diabaikan)
ke store. Ini tidak mengubah triase di atas; hanya melacak agar issue yang sama
tidak "ditemukan ulang" tiap crawl dan resolusinya terlacak.

1. Bangun JSON. `detected_at` = tanggal crawl. Satu entri per temuan actionable
   (biasanya ≤10). Kosongkan `url` untuk temuan agregat/site-level.

   ```json
   {
     "source_skill": "site-audit",
     "detected_at": "2026-08-01",
     "findings": [
       {
         "category": "status-code",
         "issue": "4XX page receives organic traffic",
         "severity": "P1",
         "url": "https://verihubs.com/blog/x",
         "affected_count": 3,
         "recommended_action": "Restore atau 301 ke padanan terdekat",
         "owner": "web",
         "detail": { "issue_id": "c64d3b5a-d0f4-11e7-8ed1-001e67ed4656" }
       }
     ]
   }
   ```

2. Tulis ke file temp, jalankan dari project dashboard (sesuaikan path bila beda):

   ```bash
   cd "C:\Users\MyBook SAGA 10\Downloads\SEO App Claude Build" && npm run db:findings-log -- --file="<path-temp>.json"
   ```

3. Writer meng-UPSERT per identity (site, source_skill, issue, url): re-crawl
   meng-update `last_detected_at` (tidak duplikat), dan temuan yang sudah
   `resolved` tapi muncul lagi otomatis di-reopen. Sebut `inserted`/`updated` satu
   baris. Kalau error, laporkan tapi jangan blokir deliverable.

**Batas:** verdict destruktif (merge/redirect/prune) TIDAK masuk findings. Setelah
membaca isi halaman (Aturan 4), catat itu ke `decisions` lewat
`npm run db:canni-log` (verdict merge/redirect). findings = issue teknis;
decisions = verdict konten.

---
````

---

## 5. verihubs-link-health (anthropic-skills)

**Insert after** the Format output code fence (the line ``Sumber: Ahrefs backlink index (estimasi), ditarik [tanggal]. Bukan data Google.`` and its closing ` ``` `), before `## Cadence`.

````markdown
---

## Step 5 — Simpan temuan ke findings store

Setelah deliverable, catat temuan actionable ke store (sama seperti site-audit).
Ini tidak mengubah diagnosis; hanya melacak agar reclamation & eskalasi terlacak
lintas bulan.

Yang dicatat:
- **D1 reclamation** → satu entri per link rusak. `category: "link-reclamation"`,
  `severity: "high"`, `url` = halaman rusak (`url_to`), `owner: "web"`,
  `recommended_action` = tujuan 301, `detail: { redirect_to, dr_source, refdomains_lost }`.
- **D3 anchor exact-match >10%** → satu entri agregat (tanpa `url`).
  `category: "anchor-risk"`, `owner: "client-decision"`, `severity: "med"`.
- **D4 refdomain turun >5%** → satu entri agregat. `category: "trend"`,
  `owner: "client-decision"`.

```json
{
  "source_skill": "link-health",
  "detected_at": "2026-08-01",
  "findings": [
    {
      "category": "link-reclamation",
      "issue": "Broken backlink to 404 (DR60 source)",
      "severity": "high",
      "url": "https://verihubs.com/blog/halaman-rusak",
      "owner": "web",
      "recommended_action": "301 ke pillar cluster yang relevan",
      "detail": { "redirect_to": "https://verihubs.com/blog/pillar", "dr_source": 60, "refdomains_lost": 4 }
    }
  ]
}
```

Jalankan dari project dashboard (sesuaikan path bila beda):

```bash
cd "C:\Users\MyBook SAGA 10\Downloads\SEO App Claude Build" && npm run db:findings-log -- --file="<path-temp>.json"
```

Writer meng-UPSERT per identity (re-run bulanan meng-update, tidak duplikat;
temuan `resolved` yang muncul lagi otomatis reopen). Sebut `inserted`/`updated`
satu baris. Kalau error, laporkan tapi jangan blokir deliverable. Reclamation
yang butuh keputusan klien (mis. biarkan 410) set `status: "escalated"`.

---
````

---

## 6. seo-report-verihubs (anthropic-skills)

**Insert after** the Step 1 date-variable list (ending `- \`prevMonthLabel\`: e.g. "May"`), before `## Step 2 — Pull Data`.

````markdown
---

## Step 1.5 — Read the decision store first (Fase 2)

Before pulling live data, read what the SEO system already recorded for this
period. This is what lets Insights (Slide 12) and Recommendations (Slide 13) cite
**what was actually decided, done, and found** instead of being re-invented each
month. Run from the SEO dashboard project (adjust path if it differs):

```bash
cd "C:\Users\MyBook SAGA 10\Downloads\SEO App Claude Build" && npm run db:report-read -- --month=<YYYY-MM of reportDate>
```

It prints JSON with `reportContext`:
- `openFindings` — technical/link issues still open (from site-audit + link-health),
  severity-ranked, with owner. → feed Slide 13 recommendations.
- `pendingDecisions` — verdicts awaiting the human gate (esp. merge/redirect). →
  surface as "awaiting sign-off" in recommendations; never report them as done.
- `periodChangelog` — what actually happened this month (merges, redirects,
  publishes, external events). → use in Slide 12 to explain movements.
- `periodDecisions` — verdicts made this month.
- `keywordTrends` — store-backed GSC keywords + WoW position delta.

**How to use it:**
- **Slide 6 (GSC keywords):** if `keywordTrends.keywords` is populated, prefer it
  (it carries WoW `posDelta`); if empty, fall back to the live `G1` pull.
- **Slide 12 (Insights):** at least one insight must reference `periodChangelog` /
  `periodDecisions` when non-empty — e.g. attribute a traffic change to a recorded
  action, or note a recorded external event. Do NOT attribute movements to causes
  that contradict the changelog.
- **Slide 13 (Recommendations):** ground recommendations in `openFindings` and
  `pendingDecisions` first (real, already-triaged work) before proposing new ideas.
  A pending destructive decision (merge/redirect/prune) awaiting sign-off is a
  higher-priority recommendation than a fresh suggestion.

If the store is empty for the period (young system), note that and proceed with
live data only — do not block.

**Scope (be honest about the boundary).** The store serves the items above only.
Everything else on the deck still needs its live pull (Step 2): Ahrefs traffic
estimate, backlinks/DR/refdomains, competitors, metrics-by-country, AI citations,
and web analytics are NOT in the store. Do not claim a slide is "from the store"
unless it came from `reportContext`.

---
````

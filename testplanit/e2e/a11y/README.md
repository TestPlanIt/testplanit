# Accessibility scan (`e2e/a11y`)

Automated WCAG 2.2 AA baseline scan across every app route, built on the
existing Playwright e2e setup. Produces a deduped, WCAG-success-criterion-grouped
report intended to feed a VPAT 2.5 (INT) conformance review.

> Automated tooling (axe-core) reliably catches ~30–40% of WCAG issues. A green
> report is **not** a conformance claim — manual keyboard and screen-reader
> testing is still required.

## What it does

1. **`fixtures.setup.ts`** (Playwright `setup` project) seeds one richly
   populated project (folders, 14 cases, a run with mixed results, a session, a
   milestone, tags, a public share link) via the existing `ApiHelper`, writes
   the resolved IDs to `.a11y-fixtures.json`, and triggers an Elasticsearch
   reindex so search-driven views are populated.
2. **`scan.spec.ts`** iterates `routes.ts` (one test per route), waits for the
   page to settle (bounded `networkidle` + a sanity selector), runs axe with
   tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa best-practice`, and — on a few
   routes — re-scans cheap interactive states (open the primary dialog, open a
   row/action menu). Raw per-route JSON lands in `results/`.
3. **`aggregate.ts`** dedupes findings across routes, groups them by WCAG
   success criterion, and writes `results/report.md` + `results/report.json`.

## Running

Requires the same infra as the e2e suite (`.env.e2e`: Postgres, Valkey, and
`ELASTICSEARCH_NODE`). Build first — the scan runs against a production build.

```bash
cd testplanit
pnpm build                      # production build (needs ~16–24 GB RAM)
pnpm a11y:scan                  # full scan → results/report.md (report mode)
pnpm a11y:scan -- --route=admin-users   # single route (fixtures still seed)
pnpm a11y:report                # regenerate the report from existing results/
```

The server, DB reseed, admin login, and worker startup are handled automatically
by the reused `globalSetup` (set `E2E_BASE_URL` / `E2E_PORT` to point at an
already-running server; `reuseExistingServer` is on).

### Pass/fail modes

- **Report mode (default):** never fails on violations; just writes the report.
- **Strict mode:** `A11Y_STRICT=on pnpm a11y:scan` (or `CI=strict`) fails any
  route with a serious/critical WCAG violation, and the aggregator exits non-zero.

## Outputs (all gitignored)

| Path | Contents |
| --- | --- |
| `results/<route>.json` | Raw axe result per route + interactive state |
| `results/report.md` | Deduped report grouped by WCAG success criterion |
| `results/report.json` | Machine-readable rollup |
| `.a11y-fixtures.json` | Seeded entity IDs for this run |

## Adding / changing routes

Edit `routes.ts`. Each entry: `name` (unique slug = result filename), `group`,
`path(fixtures)` (locale-less), `authRequired`, optional `sanity` selector,
`needs` (fixtures that must exist or the route is recorded as skipped),
`mayRedirect`, and `interactions` (`"dialog"` / `"menu"`). Routes that can't be
scanned are recorded in the report's **Coverage notes**, never silently dropped.

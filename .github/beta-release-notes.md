**Beta pre-release of TestPlanIt 1.0 — source only.**

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.11

#### Reporter packages — beta channel on npm

- **The integration packages now ship betas on npm** under the `beta`
  dist-tag: `npm i @testplanit/wdio-reporter@beta` (likewise
  `playwright-reporter`, `api`, and `mcp-server`). These track the 1.0 app;
  the default `latest` install is unaffected.
- **One run across sharded CI** — set `TESTPLANIT_RUN_ID` (or `testRunId`)
  and every WebdriverIO or Playwright invocation attaches to that run instead
  of creating its own. The pipeline owns the lifecycle through the new
  `testplanit create-run` / `complete-run` CLI in `@testplanit/api`. Each
  execution records its own suite, named by capability/project and spec
  (`testSuiteName` overrides it; Playwright adds a `{shard}` placeholder).
- The WebdriverIO service now hands its run id to forked workers, so workers
  on separate agents or containers attach to the service's run instead of
  creating runs of their own.
- New `excludeSkipped` reporter option omits skipped results from runs.

#### Automation runs

- **Automation Runs card** — project cards show automated-run activity with
  live updates.
- **Abandoned runs can auto-close** — an aborted CI job used to leave its run
  In Progress forever. An opt-in sweep now closes automated runs idle past a
  threshold (system default plus per-project override). Off by default.
- **The MCP server understands automated runs** — run results tools return
  JUnit results (with stack trace, stdout/stderr, and timing detail), status
  rollups count those results instead of reporting automated runs as 100%
  untested, and per-case status falls back to the latest result.
- **Automation Trends counts reality** — flipping a case to automated never
  recorded a version snapshot, so trends undercounted automated cases (one
  project reported 33 instead of 2,316). Flips are snapshotted now and
  history is backfilled; deleted cases count in the periods they existed, the
  chart no longer pads future periods, and CSV percentages keep a decimal.

#### Repository & folders

- **Folders are findable in large trees** — a type-to-filter box above the
  folder tree (appears past 15 folders) keeps each match's ancestors and
  subtree reachable; expand-all no longer freezes the tab, and big trees are
  actually virtualized.
- **Folder pickers are searchable** — the case-edit, import-wizard, and
  results-import folder dropdowns search by name and virtualize long lists,
  keeping the hierarchy indentation.
- Shift+click select-all is scoped to the folder and view you're looking at,
  and respects active text, link, and steps filters.
- Sorting on a Dropdown custom field orders cases by the field's option
  order.

#### Jira issue panel

- **Case fields in the panel** — templates gain a per-field Jira toggle (off
  by default); opted-in fields render as chips under each linked case, with
  dropdown values in their option colors.
- Steps fields show a step-count chip that opens a numbered step list in a
  popover, with shared step groups expanded inline.
- **The Generate QuickScript button appears where it should** — the panel now
  finds linked cases across every accessible project instead of one guessed
  from the Jira-key mapping, and the project picker shows each project's
  linked-case count.
- Generated test names include the case ID in brackets, so imported results
  attach to the case the script was generated from instead of creating
  duplicates.

#### Audit logs

- A new Source column captures the originating table, and project attribution
  reaches attachments and rolled-up child entities.
- Filter pickers no longer scan the whole log: actor, action, entity-type,
  and project options load lazily via index seeks, the Actions filter shows
  only actions actually present, search is debounced, and the date range
  defaults to the current week.

#### Fixes & interface

- **Sign-in matches emails case-insensitively** — SAML and other identity
  flows no longer miss an existing account (or auto-provision a duplicate)
  over letter case.
- Case version history no longer shows a case's attachments as deleted —
  versions now snapshot the attachments that actually exist.
- Kebab menus on horizontally-scrolling pages open reliably — opening one no
  longer locks scroll and shifts the layout out from under the cursor.
- Creating an issue in Jira carries images and videos embedded in the
  description over as attachments.
- Issue tables show clean plain-text previews of rich-text descriptions.
- The reviews inbox gains the docked case details panel.
- AI tag analysis batches more entities per request.

### Try it

1. Download **Source code (zip / tar.gz)** from the Assets below (or
   `git checkout` this tag).
2. Configure your environment:
   ```bash
   cp testplanit/.env.example testplanit/.env.production   # then fill in values
   ```
3. Build and run (the compose file builds from source):
   ```bash
   docker compose -f testplanit/docker-compose.prod.yml up -d --build
   ```
   Serving multiple subdomains off one image? Build with your own wildcard:
   `--build-arg BASE_DOMAIN=<your-domain>`.
4. **Upgrading an existing database?** v3 uses versioned migrations. Run the
   one-time baseline **before** first boot, then start normally (the container
   applies the rest on startup):
   ```bash
   cd testplanit
   npx zenstack migrate resolve --applied 20260625193632_init --schema schema.zmodel
   ```

Full walkthrough: **https://docs.testplanit.com/docs/building-from-source**

Found a problem? [Open an issue](https://github.com/TestPlanIt/testplanit/issues/new)
and add the **beta** label.

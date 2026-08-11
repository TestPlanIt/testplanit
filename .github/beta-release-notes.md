**Beta pre-release of TestPlanIt 1.0 — source only.**

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.12

#### Test runs & sessions

- **Bulk edit, complete, and delete** — row checkboxes and a bulk action bar
  on the Test Runs and Sessions lists. Bulk Edit changes milestone, state,
  and additive tags (plus assignee for sessions); every action is
  permission-gated per item, with partial failures reported.
- **Filter chips and collapsible milestone groups** — Manual, Automated, and
  My Test Runs toggles apply to both the Active and Completed tabs and
  persist per project. Milestone groups collapse (Alt-click for all) and
  remember their state, each header carrying a subtree count; summary charts
  collapse too. Milestones synced from Jira link straight to the sprint or
  release.
- **Runs tell you when they're ready to complete** — a notification goes to
  the people who can actually close a run once every case has a result,
  sent once per run.
- **Edit a test case in place from the execution panel** — the details sheet
  swaps into repository edit mode and back, without leaving the run.
- **Configuration groups are editable after creation** — runs and sessions
  can be linked, relinked, and unlinked from their sibling group, so a run
  created on its own can finally join the group its duplicates formed.
- Fixes: soft-deleted cases no longer inflate run summary counts, a bulk step
  replace no longer destroys recorded step results, and loading a run stops
  hydrating every repository case (with Pass & Next off the ACL-policy path).

#### Repository

- **Filter cases across multiple dimensions** — a new filter bar composes
  predicates over any combination of fields, tags, issues, and system
  attributes, independent of the View-by axis. Filters are editable chips,
  serialized into shareable `?f=` URLs, with any/all/none matching for tags
  and issues and an Assigned-to-me quick chip in run mode. Exports now honor
  the filters the table is showing.
- **An In Review axis and filter** — a project's whole review queue is one
  click away, showing every case under review rather than only the ones
  assigned to you. Appears only where the review workflow is enabled.
- Saved views are offered in the case-selection dialog, and applying a saved
  view keeps the folder you're standing in.
- Moving cases within the same project is a pure relocation — no more
  self-collisions on the unique index or churned case data.
- The folder search dropdown stays inside the window and marks its matches.
- Parallel CI workers racing to create the same folder no longer lose
  results.

#### Reports

- **Metrics read manual and automated results together** — elapsed metrics,
  their drill-downs, and the Test Case dimension now cover both
  `TestRunResults` and JUnit results, keyed by repository case so
  automation-only cases report correctly. Seconds-vs-milliseconds display is
  corrected across tables, charts, drill-downs, and CSV, and elapsed axes
  render real durations (45s / 5m 10s / 2h 5m).
- **Per-dimension value filters** on every custom report, carried through
  share links.
- **New cross-project LLM Usage report** — token counts, estimated cost,
  latency, and success rate, sliceable by feature, model, user, project,
  integration, and outcome.
- Test Result History gains a report action that opens Report Builder
  pre-filtered to that case's elapsed time.
- Report routes are authorization-gated end to end, and drill-down dimension
  keys are validated against a per-report whitelist.

#### Milestones

- **Cross-project coverage on in-scope issues** — issues whose cases live in
  other projects now show those cases as a clickable +N list and blend their
  latest results into the coverage breakdown, readiness rollup, and PDF
  export. Counts are scoped to the projects the viewer can actually see,
  closing a leak where linked-case counts included every project.
- Member coverage falls back to automated results for otherwise-untested
  cases, and deleted runs no longer skew readiness.
- Milestone lists sort by urgency — past due first, then started, delayed,
  upcoming, unscheduled, and completed.

#### Reviews

- Request and decision comments carry a type badge and color accent in entity
  threads and mentioned-comment lists.
- The inbox Decided tab includes decisions on reviews you requested, with a
  Decided by column, and its filters are searchable multi-selects scoped to
  what the current tab actually contains.
- **The MCP server surfaces your review inbox**, so an agent can see what is
  waiting on you and act on it.
- Reviews are cancelled when their subject is deleted, and the dashboard's
  pending-review query is bounded.

#### Search & pickers

- **Advanced Filters are searchable comboboxes** — the ten checkbox lists
  become pickers, and several controls that looked functional but filtered
  nothing (estimate/elapsed ranges, tags and created-by on runs and sessions,
  case source, date ranges) now work. Re-tagged cases are findable again.
- Async comboboxes scroll infinitely instead of paging, with a loaded-of-total
  footer, virtualized long lists, and no more fetch loops or off-screen
  panels.
- Numeric queries match entities by exact ID.

#### Integrations

- **Expired OAuth tokens refresh during background syncs** instead of failing
  the sync, refreshing five minutes ahead of expiry behind a lock so
  rotating-refresh-token providers can't have the family revoked. When a
  refresh is terminally rejected, you get a one-time bell and email notice
  with a reconnect link.
- Jira and OAuth callbacks are no longer blocked by stale API grants.
- Webhook deliveries record the entity they were about, shown as a Reference
  column.

#### Tables

- **One table component for paged and virtualized views** — virtualized
  tables gain the paged engine's column drag-reorder, resizing, and per-column
  header menu, with layout remembered per surface.
- The column-selection popover grows wider instead of scrolling.

#### Import & generation

- Edits made on the Review & Import step of AI generation are kept.
- CSV import previews every step it will create, validates required fields,
  and explains ID-field errors instead of failing opaquely.
- Testmo imports convert tables inside step content.

#### Fixes & interface

- **The seed no longer overwrites settings an admin changed.** It re-ran on
  every deploy and re-asserted defaults onto existing rows — silently
  re-enabling disabled workflow states and undoing role permission grants,
  admin account edits, milestone types, and retired priority options. A seed
  now creates what is missing and leaves the rest alone. (It does not repair
  data an earlier run already overwrote.)
- Dialogs and sheets stay open when you press a resize handle inside them —
  this was closing the Add Test Run wizard, the Add Case dialog, and the run
  page's case-edit sheet, discarding in-progress edits.
- **The accessible-theme accessibility gate passes.** Unnamed comboboxes and
  switches got real labels, and admin-chosen status, tag, and result colors
  publish a readable foreground that only the accessible themes consume — the
  brand themes look unchanged.
- Case-insensitive tag matching in the CLI and auto-tag routes, so CI jobs
  and the tagger stop creating duplicates that differ only by case.
- Audit rows attribute child-table and API-token writes to the acting user,
  by name and email.
- Upgraded to Next.js 16.3 with dependencies brought current.

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

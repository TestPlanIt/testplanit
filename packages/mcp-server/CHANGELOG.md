# @testplanit/mcp-server

## 1.0.0

### Minor Changes

- [#604](https://github.com/TestPlanIt/testplanit/pull/604) [`dcfc040`](https://github.com/TestPlanIt/testplanit/commit/dcfc0405418616dc9e1dd56840a0555853e8b9e6) Thanks [@therealbrad](https://github.com/therealbrad)! - Surface automated-run (JUnit/TestNG/xUnit/NUnit/MSTest/Mocha/Cucumber) results through the run results tools. Automated runs store results in the JUnit suite tables rather than TestRunResults, so `testplanit_test_run_results_list` previously returned an empty list for them. The list tool now merges both sources (each row carries a `source` discriminator of "TestRun" or "JUnit") with a compound per-source cursor; bare numeric cursors from older clients are still accepted. `testplanit_test_run_results_get` accepts an optional `source` parameter — pass "JUnit" to fetch an automated result's detail (type, message, stack trace, stdout/stderr, timing, suite, attachments). The `latestResult` field on run case rows (`testplanit_test_runs_get` / `testplanit_test_runs_cases_list`) is now a run-scoped union of the two sources with the same discriminator.

- [#604](https://github.com/TestPlanIt/testplanit/pull/604) [`dcfc040`](https://github.com/TestPlanIt/testplanit/commit/dcfc0405418616dc9e1dd56840a0555853e8b9e6) Thanks [@therealbrad](https://github.com/therealbrad)! - Repository reporting: server-side counts, subtree scoping, and honest folder trees. Previously, answering "how many cases are automated, by feature area?" required paginating every case and hand-walking the folder tree; these changes make it a two-call query.

  `testplanit_cases_count` is new: it accepts the same filters as `testplanit_cases_list` (kept in lockstep by a shared where-builder, so counts always reconcile with enumeration) and returns `{total}` or, with `groupBy`, `{total, groups: [{key, count}]}` across `folder` (keys carry `path`/`rootId`/`rootName` inline), `folderRoot`, `tag`, `state`, `source`, and `creator`. Groupings are batched groupBy calls — never per-folder N+1 — and subtree scoping post-filters grouped folderIds, so it works on arbitrarily large subtrees. `staleSinceUpdate` is deliberately refused (it is a bounded post-filter scan on cases_list and a count built on it could disagree with enumeration).

  `testplanit_cases_list` gains `includeDescendants` (a `folderId` filter can now cover the folder's whole subtree instead of exact-match only, capped at 500 subtree folders with an explicit error pointing at cases_count beyond that), `includeFolderPath` (each row's folder widens to `{id, name, path, ancestorIds, rootId, rootName}` from one flat folder fetch), and the automation-reality surface: rows carry `hasAutomatedResults` + `lastAutomatedResultAt`, and new filters `hasAutomatedResults`, `automatedResultSince`, and `noAutomatedResultSince` distinguish execution evidence (JUnit result rows) from the user-set `automated` intent flag — `automated: true, noAutomatedResultSince: <30 days ago>` finds automation that has gone quiet. Case detail responses (get/create/update) now include the same latest-version/latest-result sub-includes as list rows, so their `lastUpdatedAt`, `latestResult`, and the new pair are real values instead of the always-null placeholders they were. JUnit latest-result ordering is now `nulls: "last"`, so a timestampless imported row no longer shadows the real latest result.

  `testplanit_folders_list` is rebuilt on one flat project-folder fetch: every serialized node carries its accurate direct `caseCount` and `hasChildren`, `depth` is tunable (default 2, `'all'` for the entire tree), and `includeRecursiveCounts: true` adds `caseCountRecursive`, `automatedCaseCount`, and `automatedCaseCountRecursive` to every node from one extra batched groupBy. This also fixes a correctness bug: nodes beyond the fetched depth used to come back as `caseCount: 0, children: []` — wire-identical to a genuinely empty leaf, silently undercounting for any consumer. Nodes at the depth cut are now explicitly `children: null, truncated: true`, with their real counts. `testplanit_folders_get` returns the same direct + recursive count fields on the folder and each child; the folder create/update response shape is unchanged.

- [#604](https://github.com/TestPlanIt/testplanit/pull/604) [`dcfc040`](https://github.com/TestPlanIt/testplanit/commit/dcfc0405418616dc9e1dd56840a0555853e8b9e6) Thanks [@therealbrad](https://github.com/therealbrad)! - Add Review inbox tools. `testplanit_reviews_list` returns the review requests assigned to the authenticated user — the same queue as the app's Review inbox: `view: "pending"` (default) returns PENDING requests awaiting the caller's decision oldest-first, `view: "decided"` returns the caller's own decision history newest-first. Both assignment branches are covered — direct assignment and assignment to a role the caller holds — and there is deliberately no user filter, so the tool can only ever return the caller's own work. Rows resolve the polymorphic subject to `entityName` (with `entityDeleted`, since a request can outlive its subject), and carry the requested workflow `transition`, the requester, `assignedTo` with its `via: "USER" | "ROLE"` discriminator, the requester's submit-time note as plain text, and — on the decided view — the decision, its comment, and who made it. Requests from projects with the review workflow turned off are excluded, and `reviewFeatureEnabled: false` distinguishes "the feature is off system-wide" from "nothing is assigned to you". Filters: `projectId`, `entityType`; cursor pagination throughout.

  `testplanit_reviews_decide` records an APPROVED / CHANGES_REQUESTED / REJECTED decision on behalf of the token owner. It calls the same host route the app does, so every rule still applies: eligibility (assignee — directly or through an assigned role — with approve permission for the entity's area, or system admin), the append-only PENDING-guarded flip, the paired decision comment addressed to the requester, the requester's notification, the webhook, the audit event, and the fact that **approving applies the requested workflow transition** to the entity. A comment is required for CHANGES_REQUESTED and REJECTED. Read-only (`mode:read`) tokens are refused before the decision runs, and the tool description tells agents to confirm with their user before deciding.

  `testplanit_reviews_decide` requires a TestPlanIt instance whose `POST /api/reviews/{id}/decide` accepts an API token — that server change ships with this release. Against an older instance the tool reports exactly that rather than blaming the token, and `testplanit_reviews_list` is unaffected because it needs no new server surface.

- [#604](https://github.com/TestPlanIt/testplanit/pull/604) [`dcfc040`](https://github.com/TestPlanIt/testplanit/commit/dcfc0405418616dc9e1dd56840a0555853e8b9e6) Thanks [@therealbrad](https://github.com/therealbrad)! - Add run-case editing tools. `testplanit_runs_cases_update` edits a test case's row within a run — assign or unassign a tester (`assignedToId`, null to unassign) and change its position (`order`) — returning the row in the same shape as `testplanit_test_runs_cases_list`. `testplanit_runs_cases_remove` removes cases from a run by repository case ID (the counterpart of `testplanit_runs_cases_add`), soft-deleting the junction rows along with their results, step results, and iterations to match the web UI's remove-cases flow; completed and composition-locked runs are rejected with a clear error. `testplanit_runs_cases_add` now restores a previously removed case instead of silently skipping it, and reports a `restored` count. Run listings and rollups (`testplanit_test_runs_list` / `testplanit_test_runs_get` / `testplanit_test_runs_cases_list`) now exclude soft-removed run cases, matching the web UI — previously cases removed from a run in the app still appeared in MCP results and status counts.

- [#604](https://github.com/TestPlanIt/testplanit/pull/604) [`dcfc040`](https://github.com/TestPlanIt/testplanit/commit/dcfc0405418616dc9e1dd56840a0555853e8b9e6) Thanks [@therealbrad](https://github.com/therealbrad)! - Mark a case as automated once it starts receiving automated results.

  - **`@testplanit/api`**: new `client.updateTestCase(caseId, { automated? })` — a minimal, forward-compatible partial update (only the fields you pass are written, so more can be added later without a breaking change). `findOrCreateTestCase` now also flips an existing **found** case to `automated: true` when the caller wants an automated case (the default) and the case isn't already automated; the write is skipped when it already is.
  - **`@testplanit/wdio-reporter`**: when `matchByCustomField` attaches a result to an existing case (typically a migrated `MANUAL` case), the reporter now flips that case to `automated: true` if it isn't already — so a case that started manual but now runs under automation stops showing as "not automated". The write is skipped when the case is already automated (no redundant call per run) and, like the rest of the `matchByCustomField` path, a failure here never aborts result reporting.
  - **`@testplanit/mcp-server`**: `testplanit_cases_update` accepts an `automated` boolean, for one-off cleanup of cases that should be flagged automated.

### Patch Changes

- [#604](https://github.com/TestPlanIt/testplanit/pull/604) [`dcfc040`](https://github.com/TestPlanIt/testplanit/commit/dcfc0405418616dc9e1dd56840a0555853e8b9e6) Thanks [@therealbrad](https://github.com/therealbrad)! - Fix the run-level status rollup (`statusCounts` / `untested` / `total`) reporting automated runs as 100% untested. Automated runs (testRunType JUNIT/TESTNG/xUnit/NUnit/MSTest/Mocha/Cucumber) store results in the JUnit suite tables and never set a status on their TestRunCases junction rows, so the TestRunCases groupBy behind `testplanit_test_runs_list`, `testplanit_test_runs_get`, and `testplanit_test_runs_update` counted nothing. The rollup for automated runs now counts JUnitTestResult rows by status — attempt semantics (retries count once per imported row), matching the web UI's run summary — while REGULAR runs keep the TestRunCases rollup. The list tool stays batched: one suite lookup plus one groupBy per page, never per-row calls. Inline run-case rows (`testplanit_test_runs_get` / `testplanit_test_runs_cases_list`) now also fall back to `latestResult.status` for their `status` field when the junction row carries none, so automated runs get a real per-case status instead of null.

## 0.2.0

### Minor Changes

- [#457](https://github.com/TestPlanIt/testplanit/pull/457) [`6d6d802`](https://github.com/TestPlanIt/testplanit/commit/6d6d802bc5f012011b3f59cd7a7b8a16d93fa0c1) Thanks [@therealbrad](https://github.com/therealbrad)! - Add bulk test-case creation and template tools:
  - `testplanit_cases_create_many` — create many test cases in one call, with a per-case results array so partial failures are visible. Each case takes the same fields as a single create plus optional per-case `folderId`/`stateName`.
  - `testplanit_templates_list` — list a project's enabled templates with the case fields each defines (display name, system name, type, required).
  - `testplanit_cases_create` and `testplanit_cases_create_many` accept an optional `templateId` (defaults to the project's first enabled template). Custom fields are resolved and validated against the chosen template — and the case's own template on update — so an out-of-template field returns a clear error instead of being silently dropped.

  Requires a TestPlanIt instance (app v0.39.0+) exposing the `/api/projects/{projectId}/cases/bulk-create` endpoint.

## 0.1.4

### Patch Changes

- [#398](https://github.com/TestPlanIt/testplanit/pull/398) [`b19d07b`](https://github.com/TestPlanIt/testplanit/commit/b19d07bb3d7245534c8100b58554bdd573dfdbfb) Thanks [@therealbrad](https://github.com/therealbrad)! - `testplanit_test_run_results_create` now accepts an optional `fieldValues: [{ name, value }]` input to record custom Result Field entries alongside the result. Resolution is by display name (case-insensitive) or system name, scoped to the case's template; unknown names are rejected with the available field list in the error message. This unblocks result submission against templates that mark any Result Field required — previously the server rejected those submissions with `REQUIRED_FIELDS_MISSING` because the tool surface couldn't construct a valid payload.

## 0.1.3

### Patch Changes

- [#389](https://github.com/TestPlanIt/testplanit/pull/389) [`28121cd`](https://github.com/TestPlanIt/testplanit/commit/28121cd565165135f38c032c073fe5964efbdab7) Thanks [@therealbrad](https://github.com/therealbrad)! - Lower minimum Node.js requirement to 20

  Relaxes `engines.node` from `>=24` to `>=20` so the packages can be installed on projects that have not yet upgraded to Node 24. The client code only relies on APIs available since Node 18 (`fetch`, `FormData`, `Blob`, `AbortSignal.timeout`, and Web Streams); the previous `>=24` pin came from a workspace-wide standardization rather than an actual code requirement.

## 0.1.2

### Patch Changes

- [#345](https://github.com/TestPlanIt/testplanit/pull/345) [`0d98a50`](https://github.com/TestPlanIt/testplanit/commit/0d98a50fa5b61a6ebbe071713ffaed3584b470ee) Thanks [@therealbrad](https://github.com/therealbrad)! - Rewrite the README as concise, plain-English usage documentation: quick start, configuration, client setup, and a compact tool reference. Removes internal planning jargon and the 1000+ line per-tool schema dump (the MCP client discovers parameters at runtime).

## 0.1.1

### Patch Changes

- [#342](https://github.com/TestPlanIt/testplanit/pull/342) [`ea13125`](https://github.com/TestPlanIt/testplanit/commit/ea13125ad1354c6dab439871e6ec9ad6972fc700) Thanks [@therealbrad](https://github.com/therealbrad)! - Honor the `customField` value filter in `cases_list`. Passing `{ name, value }` now filters by value (resolving Dropdown/Multi-Select option names to the stored option ids), unknown keys are rejected by a strict schema, and an unknown field name or invalid option returns a validation error instead of silently returning unfiltered results. Fixes #333.

## 0.1.0

### Minor Changes

- [#289](https://github.com/TestPlanIt/testplanit/pull/289) [`1d711b2`](https://github.com/TestPlanIt/testplanit/commit/1d711b20982bf44f2447be0bf812c86c363e2e79) Thanks [@therealbrad](https://github.com/therealbrad)! - Add execution + session read tools (Phase 7):
  - 5 new test-run tools: `testplanit_test_runs_list` (with `statusCounts` inline on every row — D7-06), `testplanit_test_runs_get` (with status rollup), `testplanit_test_runs_cases_list`, `testplanit_test_run_results_list`, `testplanit_test_run_results_get` (with step-level drill-down).
  - 5 new session tools: `testplanit_sessions_list`, `testplanit_sessions_get` (up to 100 sessionResults inline + truncated marker), `testplanit_session_results_list`, `testplanit_session_results_get`, `testplanit_sessions_findings_list` (sessionId / issueId modes).
  - Extend `testplanit_cases_list` with an additive `issueId` filter — enables the killer-app chain `cases_list({issueId}) → test_run_results_list({caseIds})` in two MCP calls (no aggregate helper needed).
  - Total registered tools after Phase 7: 22 (12 from Phase 6 + 10 new).
  - Read-only domain — no write paths added; existing `mode:read` token enforcement (Phase 5) covers all new tools without modification.

- [#289](https://github.com/TestPlanIt/testplanit/pull/289) [`1d711b2`](https://github.com/TestPlanIt/testplanit/commit/1d711b20982bf44f2447be0bf812c86c363e2e79) Thanks [@therealbrad](https://github.com/therealbrad)! - Initial release: Model Context Protocol server for TestPlanIt.
  - Stdio MCP server invokable via `npx @testplanit/mcp-server`.
  - Authenticates via `TESTPLANIT_API_TOKEN`; supports self-hosted instances via `TESTPLANIT_API_URL`.
  - Token validation on startup with clear error and clean exit on failure.
  - Single `whoami` tool returns the authenticated user and scopes (debug). Production tool catalog lands in Phase 6+.
  - Read-only API token flag (`mode:read` scope tag on the existing `ApiToken.scopes` field) enforced symmetrically across REST and MCP.
  - MCP audit attribution (`metadata.source: "mcp"`) derived from `client:mcp` scope tag — unforgeable by request-time headers.

- [#289](https://github.com/TestPlanIt/testplanit/pull/289) [`1d711b2`](https://github.com/TestPlanIt/testplanit/commit/1d711b20982bf44f2447be0bf812c86c363e2e79) Thanks [@therealbrad](https://github.com/therealbrad)! - Add new read tools — three new milestones-domain tools and three new `cases_list` filter dimensions:
  - `testplanit_milestones_list` — list milestones scoped to a project, with **pooled `statusCounts` rollup** (merged across linked test runs AND linked sessions in a single response) inline on every row, plus `untested + total` (counts SUM to total). Filters: `isCompleted`, `isStarted`, `milestoneTypeId`, `createdById`, `from`/`to` (createdAt range), `parentId` (`null` = root-only, `number` = direct children of, omitted = all). Each row also carries `directChildrenCount`, `commentCount`, and `totalDescendants` (computed via a single batched recursive CTE per page through a new host endpoint). Cost model: at most 5 backend round trips per page — never per-row.
  - `testplanit_milestones_get` — fetch a single milestone with denormalized header, plain-text `note` and `docs` (ProseMirror), pooled `statusCounts`, and three inlined linked arrays — `linkedTestRuns` (cap **250** — wider than the standard 100 to cover the dominant fan-out), `linkedSessions` (cap 100), `children` (cap 100, 1-level deep with each child carrying `totalDescendants`). Per-array `truncated.<key>: true` overflow stamps.
  - `testplanit_milestone_types_list` — list milestone types assigned to a project via the `MilestoneTypesAssignment` junction. Returns `{items: [{id, name, isDefault}]}` ordered by name; no cursor pagination.
  - `testplanit_cases_list` (extended) — adds `creatorIds: string[]` (array — deliberately wider than `runs_list` / `sessions_list` single-string `createdById`), and `from` / `to` (ISO 8601 createdAt range). Closes the gap _"How many test cases did I write last month?"_.

  Total registered tools: **31** (up from 28). All tools are read-only; existing `mode:read` token enforcement covers them without modification. New host endpoint `GET /api/mcp/milestones-descendants` (recursive CTE) is required for the `totalDescendants` denorm — ZenStack RPC has no `$queryRaw` passthrough.

- [#289](https://github.com/TestPlanIt/testplanit/pull/289) [`1d711b2`](https://github.com/TestPlanIt/testplanit/commit/1d711b20982bf44f2447be0bf812c86c363e2e79) Thanks [@therealbrad](https://github.com/therealbrad)! - Add Phase 8 read tools for the repository + issue surface — six new tools and two extended ones:
  - `testplanit_code_repositories_list` — list the project's code-repository configuration with a derived web URL per provider; the underlying `credentials` column is never selected and the `settings` JSON is stripped to a per-provider public-key allow-list at the mapper boundary.
  - `testplanit_issues_find_by_key` — resolve `(externalKey, externalSystem, projectId)` to an Issue, with multi-match fallback when two integrations of the same provider share an external key in the same project.
  - `testplanit_issues_list` — list issues scoped to a project, filtered by `externalSystem`, `integrationId`, `status`, `externalStatus`. Each row carries `linkedCaseCount` inline (the dominant fan-out — median 6, p95 35 in the dev DB).
  - `testplanit_issues_get` — fetch a single issue with three inlined linked arrays (cases, sessions, test runs) capped at 100 rows each, with per-array `truncated` markers when overflow occurs.
  - `testplanit_issues_list_links` — single dual-mode XOR tool covering all six Issue M:N junctions. Outbound: `{ issueId, target }` over `cases | sessions | sessionResults | testRuns | testRunResults | testRunStepResults`. Inbound: exactly one of `caseId | sessionId | sessionResultId | runId | runResultId | runStepResultId`.
  - `testplanit_repository_case_links_list` — traverse the manual-vs-imported case linkage graph. 3-way XOR over `caseId` (bidirectional via OR clause), `caseAId` (one-way originating), or `caseBId` (one-way destination); optional `linkType` filter (`SAME_TEST_DIFFERENT_SOURCE | DEPENDS_ON`).
  - `testplanit_cases_list` (extended) — adds 7 maintenance filters (`automated`, `source`, `repositoryId`, `hasNeverExecuted`, `staleSinceUpdate`, `updatedAfter`, `updatedBefore`) and 2 row fields (`lastUpdatedAt`, `latestResult`). The `where` literal is now a typed `Prisma.RepositoryCasesWhereInput` so any unknown column or relation accessor trips TS2353 at compile time.
  - `testplanit_cases_get` (extended) — adds inline `codeRepository: { id, name, type, url? } | null` derived from the project's configured code repository.

  Total registered tools: 28 (up from 22). All tools are read-only; existing `mode:read` token enforcement covers them without modification.

- [#289](https://github.com/TestPlanIt/testplanit/pull/289) [`1d711b2`](https://github.com/TestPlanIt/testplanit/commit/1d711b20982bf44f2447be0bf812c86c363e2e79) Thanks [@therealbrad](https://github.com/therealbrad)! - Test-case domain (Phase 6): add 11 production MCP tools.
  - **Cases:** `testplanit_cases_list`, `testplanit_cases_get`, `testplanit_cases_create`, `testplanit_cases_update`, `testplanit_cases_delete`. Cursor pagination, full denormalized detail (folder breadcrumb, custom-fields flat dict, plain-text steps from Tiptap, linked issues + automated tests inline).
  - **Folders:** `testplanit_folders_list` (tree with case counts), `testplanit_folders_get` (breadcrumb + cases summary), `testplanit_folders_create`, `testplanit_folders_update` (rename + reparent), `testplanit_folders_delete` (MCP tool enforces "no cases, no sub-folders" before issuing soft-delete).
  - **Tags + Context:** `testplanit_tags_list` with usage counts (project-scoped when projectId supplied), `testplanit_projects_list` for agent context disambiguation.
  - **Soft-delete invariant:** all delete tools use PATCH update with `isDeleted: true`; never the ZenStack `delete` operation.
  - **Read-only token enforcement:** all write tools inherit Phase 5's `WRITE_HTTP_METHODS` host gate — `mode:read` tokens receive HTTP 403 + `READ_ONLY_TOKEN` and the MCP error mapper surfaces a structured tool error naming the scope.

- [#289](https://github.com/TestPlanIt/testplanit/pull/289) [`1d711b2`](https://github.com/TestPlanIt/testplanit/commit/1d711b20982bf44f2447be0bf812c86c363e2e79) Thanks [@therealbrad](https://github.com/therealbrad)! - Add write tools for the runs, sessions, and milestones domains (Phase 9):
  - `testplanit_runs_create` — create a test run with optional initial case list
  - `testplanit_runs_update` — update name, state, milestone, tags, and completion status
  - `testplanit_runs_cases_add` — add cases to an existing run
  - `testplanit_test_run_results_create` — submit a pass/fail/blocked result for a run case
  - `testplanit_sessions_create` — create an exploratory test session
  - `testplanit_sessions_update` — update session name, mission, state, milestone, and tags
  - `testplanit_milestones_create` — create a milestone with optional parent nesting
  - `testplanit_milestones_update` — update milestone name, type, note, parent, and completion status

### Patch Changes

- [#289](https://github.com/TestPlanIt/testplanit/pull/289) [`1d711b2`](https://github.com/TestPlanIt/testplanit/commit/1d711b20982bf44f2447be0bf812c86c363e2e79) Thanks [@therealbrad](https://github.com/therealbrad)! - Add Cursor configuration snippet to the README alongside the existing Claude Desktop snippet so npm visitors can wire either MCP-aware client without bouncing to the Docusaurus site. Documentation-only change — no behavior change to the published binary.

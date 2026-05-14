# @testplanit/mcp-server

Model Context Protocol server for [TestPlanIt](https://github.com/testplanit/testplanit) — exposes test-management data to AI agents (Claude Desktop, Cursor, etc.) over stdio JSON-RPC.

## Quick install

```sh
npx @testplanit/mcp-server
```

The server runs as a stdio MCP transport — your MCP-aware client (Claude Desktop, Cursor, etc.) starts it on demand. There is no daemon to manage and no port to forward.

## Environment variables

| Variable               | Required | Description                                                                                              |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `TESTPLANIT_API_TOKEN` | yes      | API token from your TestPlanIt profile. Must start with `tpi_`. Mint one under **Profile → API Tokens**. |
| `TESTPLANIT_API_URL`   | yes      | Base URL of your TestPlanIt instance (e.g. `https://testplanit.yourcompany.com`).                        |

The server validates `TESTPLANIT_API_TOKEN` against the TestPlanIt API on startup. Invalid, expired, or revoked tokens cause the server to exit with code 1 before the MCP handshake completes — the agent will report a clean failure rather than hang.

## Token scopes

API tokens have two optional scope tags that change the server's behavior:

- **`mode:read`** — narrows the token to read-only operations across REST and MCP. The host enforces a single chokepoint that returns HTTP 403 with `code: "READ_ONLY_TOKEN"` on any write attempt; the MCP server translates that into a friendly agent-visible error. Recommended for AI agents that should be able to query data but never modify it.
- **`client:mcp`** — attributes audit-log entries from this token to the MCP source (`metadata.source: "mcp"`). The attribution is derived from the token scope itself — it cannot be forged by request-time headers. Recommended for any token used by an MCP-aware agent so administrators can correctly attribute agent-driven changes.

Set scopes when creating the token in **Profile → API Tokens** (checkboxes: "Read-only" and "Mark as agent token"). A token with no scopes behaves as a full-access traditional API token (backwards compatible).

## Tool Catalog

Phase 6 + Phase 7 + Phase 8 ship 27 production tools across cases / folders / tags / projects / runs / sessions / findings / code-repositories / issues / repository-case-links, plus three milestones-domain read tools (`testplanit_milestones_list`, `testplanit_milestones_get`, `testplanit_milestone_types_list`), two issue-link write tools (`testplanit_issues_link`, `testplanit_issues_unlink`), and the `testplanit_whoami` debug helper. Phase 9 adds 8 write tools: four for the runs domain (`testplanit_runs_create`, `testplanit_runs_update`, `testplanit_runs_cases_add`, `testplanit_test_run_results_create`), two for sessions (`testplanit_sessions_create`, `testplanit_sessions_update`), and two for milestones (`testplanit_milestones_create`, `testplanit_milestones_update`) — **42 total**. All tools authenticate via the bearer token in `TESTPLANIT_API_TOKEN`. Read tools return JSON; write tools return the same shape as their corresponding `_get` tool.

### Killer-app chain: "Who tested issue X?"

Two MCP calls give an agent the full executor lineage for an issue:

1. `testplanit_cases_list({ projectId: P, issueId: I })` → returns RepositoryCases linked to issue I (Phase 7 / D7-03 — additive filter).
2. `testplanit_test_run_results_list({ caseIds: [<from step 1>] })` → returns the most recent results (default `orderBy executedAt DESC` per D7-02) with `executedBy: { id, name, email }` inline.

No aggregate helper tool needed — the two-call composition is reusable for PR-diff impact (Phase 8) and any future "what tested this?" prompts.

### Context

#### `testplanit_whoami`

Debug helper. Returns the authenticated user (token owner), email, and scopes.

**Input:** None

**Output:**
```json
{ "id": "user-1", "name": "Alice", "email": "alice@example.com", "scopes": ["client:mcp"] }
```

#### `testplanit_projects_list`

List all projects the token has access to. Use this to discover `projectId` for downstream tool calls.

**Input:** None

**Output:**
```json
{ "projects": [{ "id": 1, "name": "TestProject" }] }
```

### Cases

#### `testplanit_cases_list`

List test cases scoped to a project. Supports filters and cursor-based pagination.

**Input:**
```json
{
  "projectId": 1,
  "folderId": 2,
  "tagIds": [3, 4],
  "name": "login",
  "stateId": 5,
  "customField": { "name": "Priority" },
  "issueId": 55,
  "cursor": 100,
  "limit": 25
}
```

The `issueId` filter (Phase 7 / D7-03 — additive) returns RepositoryCases linked to the named Issue. Used as the front-half of the killer-app chain `cases_list({issueId}) → test_run_results_list({caseIds})`.

**Phase 8 maintenance filters (D8-01 / D8-02 — additive):** seven new filters narrow the list to test-maintenance questions:

- `automated: boolean` — narrows to user-flagged automated tests (`RepositoryCases.automated`); independent of `source`.
- `source: 'MANUAL'|'JUNIT'|'TESTNG'|'XUNIT'|'NUNIT'|'MSTEST'|'MOCHA'|'CUCUMBER'|'API'` — single value or array; the import-format that originally created the row.
- `repositoryId: number` — scopes to a specific per-project case container (useful for multi-repository projects).
- `hasNeverExecuted: boolean` — narrows to cases with **zero** JUnit results AND zero TestRunResults (via TestRunCases).
- `staleSinceUpdate: boolean` — narrows to cases whose latest execution timestamp is earlier than the latest update timestamp (or never executed). Implemented as a handler-side post-filter with a bounded scan cap of 400 rows; the response stamps `truncated: true` when the cap is hit.
- `updatedAfter: ISODate`, `updatedBefore: ISODate` — calendar filters that route through the `repositoryCaseVersions` relation (`RepositoryCases` has no `updatedAt` column).

**Creator + creation-date filters (additive):** three more optional inputs narrow the list to authorship questions like *"How many test cases did I write last month?"*:

- `creatorIds: string[]` — array of user IDs; matches any. Deliberately wider than `runs_list` / `sessions_list` `createdById` (single string) — a frequent question is "what did **anyone on my team** write" and the array shape avoids round-tripping through union of single-creator calls.
- `from: ISODate`, `to: ISODate` — `createdAt` range filter. Naming mirrors `runs_list` / `sessions_list` for consistency.

**Phase 8 row fields (additive):** every row carries `lastUpdatedAt` (from `repositoryCaseVersions[currentVersion].createdAt`) and `latestResult: { id, status, executedAt, source: 'TestRun' | 'JUnit' } | null` (the most recent execution across both pipelines, with a `source` discriminator). Returns `null` when the case has never been executed.

**Output:**
```json
{
  "items": [
    {
      "id": 99,
      "name": "Login flow",
      "source": "MANUAL",
      "automated": false,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "project": { "id": 1, "name": "TestProject" },
      "folder": { "id": 2, "name": "Auth" },
      "state": { "id": 5, "name": "Active" },
      "creator": { "id": "user-1", "name": "Alice", "email": "alice@example.com" },
      "tags": [{ "id": 3, "name": "regression" }]
    }
  ],
  "hasNextPage": false,
  "nextCursor": null
}
```

When `hasNextPage` is `true`, pass `nextCursor` as `cursor` to fetch the next page.

#### `testplanit_cases_get`

Fetch full details for a single test case, including steps (plain text), custom fields (flat dict keyed by display name), folder breadcrumb, linked issues, and linked automated tests. **Phase 8 (additive):** the response now includes inline `codeRepository: { id, name, type, url? } | null` derived from the project's configured `ProjectCodeRepositoryConfig.repository` — surfaces the test-framework source location alongside the existing case detail. The repository's `credentials` column is never returned and `settings` is stripped to a per-provider public-key allow-list.

**Input:**
```json
{ "caseId": 99 }
```

**Output:**
```json
{
  "id": 99,
  "name": "Login flow",
  "source": "MANUAL",
  "automated": false,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "project": { "id": 1, "name": "TestProject" },
  "folder": { "id": 2, "name": "Auth" },
  "folderBreadcrumb": [{ "id": 10, "name": "Regression" }, { "id": 2, "name": "Auth" }],
  "folderFullPath": "Regression / Auth",
  "state": { "id": 5, "name": "Active" },
  "creator": { "id": "user-1", "name": "Alice", "email": "alice@example.com" },
  "tags": [{ "id": 3, "name": "regression" }],
  "steps": [
    { "id": 1, "order": 0, "step": "Open the login page", "expectedResult": "Login form is visible" }
  ],
  "customFields": { "Priority": "High", "Severity": 2 },
  "issues": [{ "id": 55, "externalKey": "JIRA-99", "title": "Login bug", "externalStatus": "Open" }],
  "linkedAutomatedTests": [{ "id": 9, "name": "automated_test_a", "source": "JUNIT" }]
}
```

#### `testplanit_cases_create`

Create a new test case. Returns the full CASE-02 shape (same as `testplanit_cases_get`).

**Input:**
```json
{
  "projectId": 1,
  "folderId": 2,
  "name": "New login test",
  "stateName": "Active",
  "steps": [
    { "text": "Open the login page", "expectedResult": "Login form is visible", "order": 0 }
  ],
  "tags": [3, "regression"],
  "customFields": { "Priority": "High" }
}
```

- `stateName` — defaults to the first CASES-scope workflow state for the project.
- `tags` — accepts tag IDs (numbers) or tag names (strings, created if missing).
- `customFields` — flat dict keyed by display name; unknown names return a structured error.

**Output:** Same shape as `testplanit_cases_get`.

#### `testplanit_cases_update`

Partially update a test case (name, stateName, folderId, steps, tags, customFields). Providing `steps` replaces the entire step set (old steps are soft-deleted). Returns the full CASE-02 shape.

**Input:**
```json
{
  "caseId": 99,
  "name": "Updated name",
  "stateName": "In Progress",
  "folderId": 3,
  "steps": [{ "text": "Step 1", "expectedResult": "Expected 1" }],
  "tags": ["smoke"],
  "customFields": { "Priority": "Low" }
}
```

**Output:** Same shape as `testplanit_cases_get`.

#### `testplanit_cases_delete`

Soft-delete a test case (sets `isDeleted: true`). The case is hidden from subsequent list/get calls but retained in the database for audit purposes.

**Input:**
```json
{ "caseId": 99 }
```

**Output:**
```json
{ "id": 99, "isDeleted": true }
```

### Folders

#### `testplanit_folders_list`

List all folders for a project as a tree. Returns root folders with up to 2 levels of children inline. Each node includes a case count (non-deleted cases only). For deeper subtrees, use `testplanit_folders_get`.

**Input:**
```json
{ "projectId": 1 }
```

**Output:**
```json
{
  "tree": [
    {
      "id": 10,
      "name": "Regression",
      "parentId": null,
      "caseCount": 3,
      "children": [
        { "id": 2, "name": "Auth", "parentId": 10, "caseCount": 1, "children": [] }
      ]
    }
  ]
}
```

#### `testplanit_folders_get`

Fetch full details for a single folder, including parent breadcrumb, direct children, and a summary of cases (capped at 100 rows).

**Input:**
```json
{ "folderId": 2 }
```

**Output:**
```json
{
  "id": 2,
  "name": "Auth",
  "parentId": 10,
  "breadcrumb": [{ "id": 10, "name": "Regression" }, { "id": 2, "name": "Auth" }],
  "fullPath": "Regression / Auth",
  "children": [{ "id": 20, "name": "OAuth", "parentId": 2, "caseCount": 0, "children": [] }],
  "cases": [{ "id": 99, "name": "Login flow" }],
  "caseCount": 1
}
```

#### `testplanit_folders_create`

Create a folder. Omit `parentId` for a root folder. Returns the full `testplanit_folders_get` shape.

**Input:**
```json
{
  "projectId": 1,
  "name": "New Folder",
  "parentId": 10
}
```

**Output:** Same shape as `testplanit_folders_get`.

#### `testplanit_folders_update`

Rename a folder, reparent it, or both. Pass `parentId: null` to move the folder to root (disconnect from parent). Returns the full `testplanit_folders_get` shape.

**Input:**
```json
{
  "folderId": 2,
  "name": "Auth Tests",
  "parentId": null
}
```

**Output:** Same shape as `testplanit_folders_get`.

#### `testplanit_folders_delete`

Soft-delete a folder. The tool checks that the folder has no active cases and no active sub-folders before issuing the delete — non-empty folders surface a structured CASE-12 error naming the violation. Returns `{ id, isDeleted: true }` on success.

**Input:**
```json
{ "folderId": 2 }
```

**Output:**
```json
{ "id": 2, "isDeleted": true }
```

### Tags

#### `testplanit_tags_list`

List all tags (global). When `projectId` is provided, usage counts are scoped to that project's cases, test runs, and sessions.

**Input:**
```json
{ "projectId": 1 }
```

**Output:**
```json
{
  "tags": [
    {
      "id": 3,
      "name": "regression",
      "usageCounts": { "repositoryCases": 12, "testRuns": 5, "sessions": 0 }
    }
  ]
}
```

### Execution + Session Read (Phase 7)

Phase 7 ships 10 read-only tools across the test-execution domain (5 run-side tools + 5 session-side tools). All carry `isDeleted: false` filters, deterministic `[{<order>:'desc'},{id:'desc'}]` orderBy, and cursor pagination capped at `limit: 100` (T-07-06 DoS guard).

#### `testplanit_test_runs_list` (EXEC-01)

List test runs scoped to a project. Each row carries `statusCounts: [{id,name,count}]` + `untested` + `total` inline (per D7-06 — counts SUM to `total` per R3 invariant). The rollup is fetched via a SINGLE batched groupBy per page (no N+1) so an agent can list 100 runs in one tool call.

**Input:**
```json
{
  "projectId": 1,
  "stateId": 3,
  "isCompleted": false,
  "createdById": "user-1",
  "from": "2026-01-01T00:00:00Z",
  "to": "2026-02-01T00:00:00Z",
  "cursor": 100,
  "limit": 25
}
```

**Output:**
```json
{
  "items": [
    {
      "id": 5,
      "name": "Sprint 12 regression",
      "isCompleted": false,
      "completedAt": null,
      "createdAt": "2026-01-05T00:00:00Z",
      "testRunType": "REGULAR",
      "project": { "id": 1, "name": "TestProject" },
      "state": { "id": 3, "name": "In Progress" },
      "createdBy": { "id": "user-1", "name": "Alice", "email": "alice@example.com" },
      "configuration": null,
      "milestone": null,
      "tags": [],
      "issues": [],
      "statusCounts": [
        { "id": 1, "name": "Passed", "count": 5 },
        { "id": 2, "name": "Failed", "count": 2 }
      ],
      "untested": 1,
      "total": 8
    }
  ],
  "hasNextPage": false,
  "nextCursor": null
}
```

**Example:** "List the most recent 10 test runs in project 5."

#### `testplanit_test_runs_get` (EXEC-02)

Fetch a single test run with the first 50 testCases inline + status rollup. Each inline testCase carries `latestResult: { id, status, executedBy, executedAt }` so the agent sees the most-recent execution per case in one call.

**Input:**
```json
{ "runId": 5 }
```

**Output:**
```json
{
  "id": 5,
  "name": "Sprint 12 regression",
  "project": { "id": 1, "name": "TestProject" },
  "state": { "id": 3, "name": "In Progress" },
  "createdBy": { "id": "user-1", "name": "Alice", "email": "alice@example.com" },
  "statusCounts": [{ "id": 1, "name": "Passed", "count": 5 }],
  "untested": 1,
  "total": 8,
  "testCases": [
    {
      "id": 100,
      "order": 0,
      "isCompleted": false,
      "repositoryCase": { "id": 99, "name": "Login flow", "source": "MANUAL" },
      "assignedTo": null,
      "status": { "id": 1, "name": "Passed" },
      "latestResult": {
        "id": 555,
        "status": { "id": 1, "name": "Passed" },
        "executedBy": { "id": "user-1", "name": "Alice", "email": "alice@example.com" },
        "executedAt": "2026-01-05T01:00:00Z"
      }
    }
  ],
  "testCasesNextCursor": null
}
```

**Example:** "Show me the details of run 5 including the status counts."

#### `testplanit_test_runs_cases_list` (EXEC-03)

Paginate testCases for a run beyond the 50-cap returned by `testplanit_test_runs_get`. Same row shape as the inline `testCases[i]`.

**Input:**
```json
{
  "runId": 5,
  "isCompleted": false,
  "statusId": 2,
  "assignedToId": "user-1",
  "cursor": 100,
  "limit": 25
}
```

**Output:** `{ items: [...], hasNextPage, nextCursor }` — items match the `testCases[i]` shape from `testplanit_test_runs_get`.

**Example:** "List the failed cases in run 5."

#### `testplanit_test_run_results_list` (EXEC-04 + EXEC-06 back-half)

List test-run results with denormalized status / executedBy / testRunCase. The `caseIds` filter ships the **back-half** of the killer-app chain — pass the RepositoryCase ids returned by `testplanit_cases_list({issueId})` to get the latest results per case (`orderBy executedAt DESC` matches the schema index).

**Input:**
```json
{
  "runId": 5,
  "caseIds": [99, 100],
  "executedById": "user-1",
  "statusId": 2,
  "from": "2026-01-01T00:00:00Z",
  "to": "2026-02-01T00:00:00Z",
  "cursor": 200,
  "limit": 25
}
```

**Output:**
```json
{
  "items": [
    {
      "id": 555,
      "attempt": 1,
      "executedAt": "2026-01-05T01:00:00Z",
      "status": { "id": 1, "name": "Passed" },
      "executedBy": { "id": "user-1", "name": "Alice", "email": "alice@example.com" },
      "testRunCase": {
        "id": 100,
        "repositoryCaseId": 99,
        "repositoryCase": { "id": 99, "name": "Login flow", "source": "MANUAL" },
        "testRun": { "id": 5, "name": "Sprint 12 regression" }
      }
    }
  ],
  "hasNextPage": false,
  "nextCursor": null
}
```

**Example:** "Who tested the cases linked to issue JIRA-42?" — chain `cases_list({issueId})` then this tool with `caseIds`.

#### `testplanit_test_run_results_get` (EXEC-05)

Drill-down — fetch a single test-run result with `stepResults: [...]` inlined. Each step result carries `stepText` / `expectedResultText` (ProseMirror-extracted) + `status` (from the `stepStatus` relation per R2) + `notes` + `evidence` (as-is per D7-08) + `attachments` + `issues`. Top-level result carries `customFields` denormalized and the parent `testRunCase` summary.

**Input:**
```json
{ "resultId": 555 }
```

**Output:**
```json
{
  "id": 555,
  "attempt": 1,
  "executedAt": "2026-01-05T01:00:00Z",
  "elapsed": 320,
  "notes": "Step 2 had a 200ms hiccup",
  "evidence": { "url": "https://traces.example.com/run-5/case-100" },
  "status": { "id": 1, "name": "Passed" },
  "executedBy": { "id": "user-1", "name": "Alice", "email": "alice@example.com" },
  "testRunCase": {
    "id": 100,
    "repositoryCaseId": 99,
    "repositoryCase": { "id": 99, "name": "Login flow", "source": "MANUAL" },
    "testRun": { "id": 5, "name": "Sprint 12 regression" }
  },
  "customFields": { "Priority": "High" },
  "stepResults": [
    {
      "id": 7000,
      "status": { "id": 1, "name": "Passed" },
      "stepId": 1,
      "stepOrder": 0,
      "stepText": "Open the login page",
      "expectedResultText": "Login form is visible",
      "notes": "",
      "evidence": null,
      "executedAt": "2026-01-05T01:00:00Z",
      "elapsed": 80,
      "attachments": [],
      "issues": []
    }
  ],
  "attachments": [],
  "issues": []
}
```

**Example:** "Show me the step-level breakdown for result 555."

#### `testplanit_runs_create`

Create a new test run. Optionally adds repository test cases in the same call (up to 250). Defaults to the first RUNS-scope workflow state if `stateName` is omitted.

**Input:**
```json
{
  "projectId": 1,
  "name": "Sprint 13 regression",
  "caseIds": [99, 100, 101],
  "milestoneId": 7,
  "configId": 3,
  "stateName": "In Progress",
  "tags": [3, "smoke"]
}
```

- `caseIds` — optional, max 250; appended as TestRunCases in order.
- `tags` — accepts tag IDs (numbers) or tag names (strings, created if missing).
- `stateName` — defaults to the first RUNS-scope workflow state for the project.

**Output:** Same shape as `testplanit_test_runs_get`.

#### `testplanit_runs_update`

Update an existing test run. Pass `milestoneId: null` or `configId: null` to remove those associations. Providing `tags` replaces the full tag set.

**Input:**
```json
{
  "runId": 5,
  "name": "Sprint 13 regression (updated)",
  "stateName": "Completed",
  "milestoneId": null,
  "configId": null,
  "tags": ["smoke"],
  "isCompleted": true
}
```

**Output:** Same shape as `testplanit_test_runs_get`.

#### `testplanit_runs_cases_add`

Add repository test cases to an existing run. Cases are appended in order after any existing cases; duplicates are skipped silently.

**Input:**
```json
{
  "runId": 5,
  "caseIds": [102, 103, 104]
}
```

- `caseIds` — required, 1–250.

**Output:**
```json
{ "runId": 5, "requested": 3, "total": 11 }
```

- `requested` — number of caseIds submitted.
- `total` — total TestRunCases in the run after the add (including pre-existing cases).

#### `testplanit_test_run_results_create`

Submit a test result for a case in a run. Atomically creates the result and updates the run case's current status. The attempt number is auto-incremented — callers do not track it.

**Input:**
```json
{
  "testRunCaseId": 100,
  "statusName": "Passed",
  "notes": "All steps green.",
  "elapsed": 320
}
```

- `statusName` — matched by name within the project's configured statuses.
- `elapsed` — optional duration in seconds; pass `null` to omit.

**Output:** Same shape as `testplanit_test_run_results_get`.

#### `testplanit_sessions_list` (SESS-01)

List exploratory sessions scoped to a project, with denormalized state / createdBy / assignedTo / template / configuration / milestone / tags. Mission and note are extracted from ProseMirror to plain text.

**Input:**
```json
{
  "projectId": 1,
  "stateId": 3,
  "isCompleted": false,
  "createdById": "user-1",
  "from": "2026-01-01T00:00:00Z",
  "to": "2026-02-01T00:00:00Z",
  "cursor": 50,
  "limit": 25
}
```

**Output:**
```json
{
  "items": [
    {
      "id": 12,
      "name": "Login flow exploration",
      "isCompleted": false,
      "completedAt": null,
      "createdAt": "2026-01-10T00:00:00Z",
      "mission": "Explore login edge cases",
      "note": "",
      "project": { "id": 1, "name": "TestProject" },
      "state": { "id": 3, "name": "In Progress" },
      "createdBy": { "id": "user-1", "name": "Alice", "email": "alice@example.com" },
      "assignedTo": null,
      "template": { "id": 4, "name": "ExploratoryTemplate" },
      "configuration": null,
      "milestone": null,
      "tags": []
    }
  ],
  "hasNextPage": false,
  "nextCursor": null
}
```

**Example:** "List my open sessions in project 1."

#### `testplanit_sessions_get` (SESS-02)

Fetch a single session with up to 100 sessionResults inlined and a `truncated: boolean` marker (D7-12). When `truncated: true`, paginate the rest via `testplanit_session_results_list({sessionId})`.

**Input:**
```json
{ "sessionId": 12 }
```

**Output:**
```json
{
  "id": 12,
  "name": "Login flow exploration",
  "mission": "Explore login edge cases",
  "note": "",
  "project": { "id": 1, "name": "TestProject" },
  "state": { "id": 3, "name": "In Progress" },
  "createdBy": { "id": "user-1", "name": "Alice", "email": "alice@example.com" },
  "issues": [],
  "customFields": {},
  "sessionResults": [
    {
      "id": 800,
      "createdAt": "2026-01-10T00:30:00Z",
      "elapsed": 600,
      "resultDataText": "Tried 5 invalid passwords; UI showed correct error.",
      "status": { "id": 1, "name": "Passed" },
      "createdBy": { "id": "user-1", "name": "Alice", "email": "alice@example.com" },
      "session": { "id": 12, "name": "Login flow exploration", "projectId": 1 }
    }
  ],
  "truncated": false
}
```

**Example:** "Show me session 12 with its results."

#### `testplanit_sessions_create`

Create a new exploratory test session. Auto-resolves the default template and the first SESSIONS-scope workflow state if not specified.

**Input:**
```json
{
  "projectId": 1,
  "name": "Login edge case exploration",
  "mission": "Explore login edge cases under slow network conditions",
  "milestoneId": 7,
  "configId": 3,
  "stateName": "In Progress",
  "tags": [3, "exploratory"]
}
```

- `mission` — optional plain-text mission statement.
- `stateName` — defaults to the first SESSIONS-scope workflow state for the project.
- `tags` — accepts tag IDs (numbers) or tag names (strings, created if missing).

**Output:** Same shape as `testplanit_sessions_get`.

#### `testplanit_sessions_update`

Update an existing session. Pass `mission: null`, `milestoneId: null`, or `configId: null` to remove those fields. Providing `tags` replaces the full tag set.

**Input:**
```json
{
  "sessionId": 12,
  "name": "Login edge case exploration (updated)",
  "mission": null,
  "stateName": "Completed",
  "milestoneId": null,
  "configId": null,
  "tags": ["smoke"],
  "isCompleted": true
}
```

**Output:** Same shape as `testplanit_sessions_get`.

#### `testplanit_session_results_list` (SESS-03)

List session results with filters `sessionId` / `createdById` / `statusId`. **NO** `testCaseId` filter — Sessions are exploratory and SessionResults has no `testCaseId` FK (R4 invariant; enforced at the input schema and at the where-clause Prisma type).

**Input:**
```json
{
  "sessionId": 12,
  "createdById": "user-1",
  "statusId": 2,
  "cursor": 100,
  "limit": 25
}
```

**Output:** `{ items, hasNextPage, nextCursor }` — items match the `sessionResults[i]` shape from `testplanit_sessions_get`.

**Example:** "List failed results in session 12."

#### `testplanit_session_results_get` (SESS-04)

Fetch a single session result with denormalized status / `createdBy` (the executor — D7-13: NO separate `executedBy` field) / session / customFields / attachments / issues. **NO** step-level results — sessions are exploratory and don't have ordered steps.

**Input:**
```json
{ "resultId": 800 }
```

**Output:**
```json
{
  "id": 800,
  "createdAt": "2026-01-10T00:30:00Z",
  "elapsed": 600,
  "resultDataText": "Tried 5 invalid passwords; UI showed correct error.",
  "status": { "id": 1, "name": "Passed" },
  "createdBy": { "id": "user-1", "name": "Alice", "email": "alice@example.com" },
  "session": { "id": 12, "name": "Login flow exploration", "projectId": 1 },
  "customFields": { "Severity": "Low" },
  "attachments": [],
  "issues": []
}
```

**Example:** "Show me session result 800."

#### `testplanit_sessions_findings_list` (SESS-05)

Dual-mode (XOR — provide exactly one of `sessionId` or `issueId`):

- **sessionId mode** — returns Issue rows linked to the session OR to any of its sessionResults. Mirrors the agent-facing prompt "what issues surfaced in session X?"
- **issueId mode** — returns the issue plus its `linkedSessions` and `linkedSessionResults`. Mirrors "where did issue Y appear?"

**Input (sessionId mode):**
```json
{ "sessionId": 12 }
```

**Output (sessionId mode):**
```json
{
  "session": { "id": 12, "name": "Login flow exploration" },
  "findings": [
    {
      "id": 55,
      "externalKey": "JIRA-99",
      "title": "Login fails on Safari",
      "status": "Open",
      "externalStatus": "Open",
      "priority": "High",
      "externalSystem": "JIRA"
    }
  ],
  "truncated": false
}
```

**Input (issueId mode):**
```json
{ "issueId": 55 }
```

**Output (issueId mode):**
```json
{
  "issue": { "id": 55, "externalKey": "JIRA-99", "title": "Login fails on Safari", "externalStatus": "Open", "externalSystem": "JIRA" },
  "linkedSessions": [
    {
      "id": 12,
      "name": "Login flow exploration",
      "createdAt": "2026-01-10T00:00:00Z",
      "isCompleted": false,
      "createdBy": { "id": "user-1", "name": "Alice", "email": "alice@example.com" }
    }
  ],
  "linkedSessionResults": [
    {
      "id": 800,
      "sessionId": 12,
      "createdAt": "2026-01-10T00:30:00Z",
      "status": { "id": 1, "name": "Passed" },
      "createdBy": { "id": "user-1", "name": "Alice", "email": "alice@example.com" }
    }
  ]
}
```

**Example:** "What sessions surfaced JIRA-99?"

> Note: For resolving an external key like `JIRA-99` to an Issue, see `testplanit_issues_find_by_key` (Phase 8 — ISSUE-01). The lookup tuple is `(externalKey, externalSystem, projectId)` to disambiguate when multiple integrations of the same provider exist (`Issue.externalKey` is not globally unique — schema enforces only `@@unique([externalId, integrationId])`).

### Code Repositories

#### `testplanit_code_repositories_list` (Phase 8 — REPO-01)

List the project's code-repository configuration. Returns `ProjectCodeRepositoryConfig` rows with the underlying `CodeRepository` denormalized inline. The schema enforces `@@unique([projectId])` so the response carries 0 or 1 row today; cursor pagination is shape-compatible with future multi-config relaxation.

**Input:**
```json
{ "projectId": 1, "cursor": 100, "limit": 25 }
```

**Output:**
```json
{
  "items": [
    {
      "id": 1,
      "projectId": 42,
      "branch": "main",
      "pathPatterns": [{ "path": "src/**", "pattern": "*.test.ts" }],
      "cacheEnabled": true,
      "cacheTtlDays": 7,
      "cacheStatus": "READY",
      "cacheLastFetchedAt": "2026-05-01T12:00:00Z",
      "cacheFileCount": 1234,
      "cacheTotalSize": 5678901,
      "cacheError": null,
      "repository": {
        "id": 5,
        "name": "acme/tools",
        "provider": "GITHUB",
        "status": "ACTIVE",
        "lastTestedAt": "2026-04-30T08:00:00Z",
        "settings": { "owner": "acme", "repo": "tools" },
        "url": "https://github.com/acme/tools"
      }
    }
  ],
  "hasNextPage": false,
  "nextCursor": null
}
```

> **Security (T-08-CRED-LEAK):** the underlying `credentials` column is never selected (defense-in-depth #1 — TS2353 at compile time if reintroduced). The wholesale `settings` JSON is stripped to a per-provider public-key allow-list at the mapper boundary (defense-in-depth #2): `GITHUB ["owner","repo"]`, `GITLAB / BITBUCKET / GITEA ["baseUrl","owner","repo"]`, `AZURE_DEVOPS ["organizationUrl","project","repositoryId"]`. The derived web `url` follows each provider's canonical pattern; trailing slashes sanitized.

### Issues

#### `testplanit_issues_find_by_key` (Phase 8 — ISSUE-01)

Resolve `(externalKey, externalSystem, projectId)` to an Issue. The schema enforces only `@@unique([externalId, integrationId])` — `externalKey` is NOT globally unique when multiple integrations of the same provider exist in the same project. The tool's input tuple matches how integrations are configured in practice and how an agent already disambiguates project context.

**Input:**
```json
{
  "externalKey": "JIRA-123",
  "externalSystem": "JIRA",
  "projectId": 42,
  "integrationId": 7
}
```

- `externalSystem` — `IntegrationProvider` enum: `JIRA | GITHUB | AZURE_DEVOPS | SIMPLE_URL`. Internal-only issues (`Issue.integrationId IS NULL`) are NOT addressable here — agents reach those via `testplanit_issues_list`.
- `integrationId` (optional) — narrows to that integration directly and skips multi-match logic.

**Output (single match):**
```json
{
  "issue": {
    "id": 99,
    "externalKey": "JIRA-123",
    "externalSystem": "JIRA",
    "externalUrl": "https://acme.atlassian.net/browse/JIRA-123",
    "externalStatus": "Open",
    "summary": "Login fails on Safari",
    "status": "open",
    "projectId": 42,
    "integration": { "id": 7, "name": "Acme Jira", "provider": "JIRA" },
    "createdBy": { "id": "user-1", "name": "Alice", "email": "alice@example.com" },
    "createdAt": "2026-01-01T00:00:00Z",
    "lastSyncedAt": "2026-05-01T12:00:00Z",
    "linkedCaseCount": 6
  },
  "multipleMatches": false
}
```

**Output (multi-match fallback):** when `findMany` returns more than one row (rare — happens when two integrations of the same provider share an external key in the same project), the response shape switches:
```json
{
  "issues": [ /* up to 5 issues; same shape as `issue` above */ ],
  "multipleMatches": true,
  "hint": "Pass integrationId to disambiguate."
}
```

#### `testplanit_issues_list` (Phase 8 — ISSUE-02)

List issues scoped to a project, with cursor-based pagination and deterministic `[{createdAt:'desc'},{id:'desc'}]` ordering. Each row carries `linkedCaseCount` inline (the dominant fan-out — median 6, p95 35, max 1061 in dev DB) so agents can rank issues by reach without a follow-up.

**Input:**
```json
{
  "projectId": 42,
  "externalSystem": "JIRA",
  "integrationId": 7,
  "status": "open",
  "externalStatus": "In Progress",
  "cursor": 100,
  "limit": 25
}
```

> **Note:** an `assignee` filter is intentionally absent — `Issue` has no native assignee column; assignee data lives in `Issue.data: Json` (provider-shaped). Filtering on a JSON path would be brittle and per-provider; deferred until a real ask.

**Output:** `{ items, hasNextPage, nextCursor }` — items match the `issue` shape from `testplanit_issues_find_by_key`.

#### `testplanit_issues_get` (Phase 8 — ISSUE-03)

Fetch a single issue header plus three denormalized linked-row arrays inline. Mirrors Phase 7's D7-12 / D7-13 inline-with-truncation pattern.

**Input:**
```json
{ "issueId": 99 }
```

**Output:**
```json
{
  "id": 99,
  "externalKey": "JIRA-123",
  "summary": "Login fails on Safari",
  "description": "Steps to repro: ...",
  "priority": "high",
  "issueTypeName": "Bug",
  "issueTypeIconUrl": "https://...",
  "note": "Reproduced on Safari 17.",
  "status": "open",
  "externalStatus": "In Progress",
  "linkedCases": [
    { "id": 7, "name": "Login flow", "source": "MANUAL", "automated": false, "latestResult": null }
  ],
  "linkedSessions": [
    { "id": 12, "name": "Login flow exploration", "mission": "Try edge cases.", "isCompleted": false, "state": { "id": 1, "name": "Draft" } }
  ],
  "linkedTestRuns": [
    { "id": 200, "name": "Smoke run", "isCompleted": true, "completedAt": "2026-05-01T12:00:00Z" }
  ],
  "truncated": { }
}
```

> Each inline array is capped at 100 rows. When overflow occurs the response stamps `truncated.linkedCases: true` (or `linkedSessions` / `linkedTestRuns` as appropriate); the rest are reachable via `testplanit_cases_list({issueId})` and `testplanit_issues_list_links({issueId, target})`. `linkedSessionResults`, `linkedTestRunResults`, and `linkedTestRunStepResults` are NOT inlined (small junctions; agents reach them via the link tool).

#### `testplanit_issues_list_links` (Phase 8 — ISSUE-04)

Single dual-mode XOR tool covering all six `Issue` M:N junctions. Mirrors Phase 7's D7-11 dual-mode pattern (sessions findings).

- **Outbound mode** — given an `issueId` plus a `target`, returns the linked counterparts denormalized.
- **Inbound mode** — given exactly one of `caseId | sessionId | sessionResultId | runId | runResultId | runStepResultId`, returns the linked Issue rows.

**Input (outbound):**
```json
{ "issueId": 99, "target": "cases", "cursor": 100, "limit": 25 }
```

- `target`: `cases | sessions | sessionResults | testRuns | testRunResults | testRunStepResults` (one of six).

**Input (inbound — exactly ONE inbound ID; the others MUST be omitted):**
```json
{ "caseId": 7 }
```

**Output:** `{ items, hasNextPage, nextCursor }` — items are typed per the queried direction.

> **Why one tool not six:** Phase 7's `sessions_findings_list` already proved the dual-mode shape composes cleanly. Six small tools would push the catalog past 30 and bury the mental model ("I'm walking the issue ↔ X graph") under ceremony.

#### `testplanit_issues_link`

Link one or more entities to an issue in a single call. Batch-capable: pass up to 100 entity IDs.

**Input:**
```json
{ "issueId": 7978, "entityType": "testCase", "entityIds": [201, 202, 203] }
```

- `entityType`: `testCase | session | testRun | testRunResult | testRunStepResult`
- `entityIds`: array of 1–100 entity IDs

**Output:** `{ linked, issueId, entityType, entityIds }`

#### `testplanit_issues_unlink`

Remove links between entities and an issue. Same shape as `issues_link`.

**Input:**
```json
{ "issueId": 7978, "entityType": "testCase", "entityIds": [201] }
```

**Output:** `{ unlinked, issueId, entityType, entityIds }`

### Repository Case Links

#### `testplanit_repository_case_links_list` (Phase 8 — REPO-05)

Traverse the manual-↔-imported case linkage graph. Three input modes (3-way XOR; exactly one ID supplied):

- `caseId` — bidirectional, matches both endpoints via `OR=[{caseAId},{caseBId}]`.
- `caseAId` — one-way, originating side.
- `caseBId` — one-way, destination side.

Optional `linkType` narrows to `SAME_TEST_DIFFERENT_SOURCE` or `DEPENDS_ON`. The response shape varies by mode: `caseId` collapses each row to an inline `otherCase` (the side opposite the queried id); `caseAId` / `caseBId` modes preserve both `caseA` and `caseB`.

**Input:**
```json
{ "caseId": 7, "linkType": "SAME_TEST_DIFFERENT_SOURCE", "cursor": 100, "limit": 25 }
```

**Output (caseId mode):**
```json
{
  "items": [
    {
      "id": 31,
      "type": "SAME_TEST_DIFFERENT_SOURCE",
      "createdAt": "2026-01-01T00:00:00Z",
      "createdBy": { "id": "user-1", "name": "Alice", "email": "alice@example.com" },
      "otherCase": { "id": 9, "name": "automated_login_test", "source": "JUNIT", "automated": true }
    }
  ],
  "hasNextPage": false,
  "nextCursor": null
}
```

> Project scope is enforced transitively by the host's access policy on `caseA.project` — `RepositoryCaseLink` itself is not project-scoped, so the tool deliberately exposes no project-id input.

### Milestones

#### `testplanit_milestones_list`

List milestones scoped to a project, with **pooled `statusCounts` rollup** inline on every row (merged across linked test runs AND linked sessions). Single call answers *"How much work is left in milestone X."*

**Inputs:** `projectId` (required), `isCompleted?`, `isStarted?`, `milestoneTypeId?`, `createdById?` (single string), `from?` / `to?` (ISO 8601 createdAt range), `parentId?` (`null` = root-only, `number` = direct children of, omitted = all), `cursor?`, `limit?` (default 25, max 100).

**Each row carries:** `id`, `name`, `milestoneType: {id, name}`, `creator: {id, name, email}`, `parentId`, `directChildrenCount`, `commentCount`, `totalDescendants` (recursive CTE — counts the full subtree), `statusCounts: [{id, name, count}]`, `untested`, `total` (counts SUM to total), plus `isStarted`, `isCompleted`, `automaticCompletion`, `startedAt`, `completedAt`, `createdAt`.

**Cost model:** at most 5 backend round trips per page — one `milestones.findMany`, two batched `groupBy` calls (`testRunCases` + `sessionResults`; either skipped if the page has no runs or no sessions), one `status.findMany` for the status names, and one batched recursive-CTE call to `/api/mcp/milestones-descendants` for the page's `totalDescendants`. NEVER per-row.

#### `testplanit_milestones_get`

Fetch a single Milestone by id. Returns the full denormalized header + `note` and `docs` rendered to plain text (ProseMirror walked) + three inlined linked arrays:

- `linkedTestRuns` (cap **250** rows — wider than the standard 100 because milestones legitimately carry hundreds of runs; this is the dominant fan-out)
- `linkedSessions` (cap 100)
- `children` (cap 100, **1-level deep only**; each child carries `totalDescendants` so agents can prioritize which subtree to walk first)

When an array is over capacity the response carries `truncated.<key>: true`. The pooled `statusCounts` rollup at the milestone level is included; per-run rollups are reachable via `testplanit_test_runs_get`.

#### `testplanit_milestone_types_list`

List the milestone types assigned to a project (via the `MilestoneTypesAssignment` junction). Returns `{ items: [{id, name, isDefault}] }` ordered by name. No cursor pagination — types-per-project is small. Every `milestones_list` row + `milestones_get` response also denormalizes `milestoneType: {id, name}` inline, so this tool exists for full-catalog and filter-picker use cases.

#### `testplanit_milestones_create`

Create a new milestone. Use `testplanit_milestone_types_list` to enumerate valid `milestoneTypeId` values.

**Input:**
```json
{
  "projectId": 1,
  "name": "v2.0 Release",
  "milestoneTypeId": 3,
  "parentId": 5,
  "note": "Target: end of Q3."
}
```

- `milestoneTypeId` — required; use `testplanit_milestone_types_list` to enumerate.
- `parentId` — optional; omit for a top-level milestone.
- `note` — optional plain text.

**Output:**
```json
{
  "id": 42,
  "name": "v2.0 Release",
  "isStarted": false,
  "isCompleted": false,
  "createdAt": "2026-05-07T00:00:00Z",
  "milestoneType": { "id": 3, "name": "Release" },
  "creator": { "id": "user-1", "name": "Alice", "email": "alice@example.com" },
  "parent": { "id": 5, "name": "Q3 Goals" },
  "note": "Target: end of Q3."
}
```

#### `testplanit_milestones_update`

Update an existing milestone. Pass `note: null` or `parentId: null` to clear those fields. Setting `isStarted: true` records `startedAt`; setting `isCompleted: true` records `completedAt`.

**Input:**
```json
{
  "milestoneId": 42,
  "name": "v2.0 Release (revised)",
  "note": null,
  "milestoneTypeId": 4,
  "parentId": null,
  "isStarted": true,
  "isCompleted": false
}
```

**Output:** Same shape as `testplanit_milestones_create`.

## Killer-app compositions (Phase 8)

### Issue → linked test cases (2 calls)

```json
{ "tool": "testplanit_issues_find_by_key",
  "input": { "externalKey": "JIRA-123", "externalSystem": "JIRA", "projectId": 42 } }
// → { issue: { id: 99, ... }, multipleMatches: false }

{ "tool": "testplanit_cases_list", "input": { "projectId": 42, "issueId": 99 } }
// → { items: [{ id: 7, name: "Login flow", lastUpdatedAt: "...", latestResult: {...} }, ...] }
```

### Stale automated tests (1 call)

```json
{ "tool": "testplanit_cases_list",
  "input": { "projectId": 42, "automated": true, "staleSinceUpdate": true } }
// → each row carries lastUpdatedAt + latestResult; envelope.truncated:true when scan cap (400) hit.
```

### Recently-updated automated scripts (1 call)

```json
{ "tool": "testplanit_cases_list",
  "input": { "projectId": 42, "automated": true, "updatedAfter": "2026-04-01T00:00:00Z" } }
```

### Manual ↔ imported case graph walk (1 call)

```json
{ "tool": "testplanit_repository_case_links_list",
  "input": { "caseId": 7, "linkType": "SAME_TEST_DIFFERENT_SOURCE" } }
// → each row's otherCase carries the counterpart denormalized.
```

### Never-run scripts (1 call)

```json
{ "tool": "testplanit_cases_list",
  "input": { "projectId": 42, "automated": true, "hasNeverExecuted": true } }
```

### Milestone progress overview (1 call)

`testplanit_milestones_list({ projectId, isCompleted: false })` returns every open milestone for a project with pooled `statusCounts + untested + total` inline (merged across linked test runs AND sessions). An agent answers *"How much work is left in each open milestone?"* in a single round trip without any follow-up `_get` calls.

```json
{ "tool": "testplanit_milestones_list",
  "input": { "projectId": 42, "isCompleted": false } }
// → each row: { name, statusCounts:[{name,count}], untested, total, totalDescendants, ... }
```

### Create a run, add cases, and execute (3 calls)

Chain `testplanit_runs_create` → `testplanit_runs_cases_add` (if cases were not supplied at creation) → `testplanit_test_run_results_create` per case.

```json
{ "tool": "testplanit_runs_create",
  "input": { "projectId": 42, "name": "JIRA-892 coverage run", "caseIds": [99, 100, 101] } }
// → full run detail; total: 3, untested: 3

{ "tool": "testplanit_runs_cases_add",
  "input": { "runId": 5, "caseIds": [102, 103] } }
// → { runId: 5, requested: 2, total: 5 }

{ "tool": "testplanit_test_run_results_create",
  "input": { "testRunCaseId": 100, "statusName": "Passed", "elapsed": 320 } }
// → full result detail; attempt: 1, status: { name: "Passed" }
```

## Soft-Delete Invariant

All TestPlanIt MCP "delete" tools perform soft-delete: they set `isDeleted: true` via PATCH update and never call the underlying ZenStack `delete` operation. Soft-deleted records remain in the database for audit purposes and are hidden from subsequent list/get tool calls.

## Read-Only Tokens

Tokens minted with the `mode:read` scope are blocked at the host on POST/PATCH/DELETE — including all Phase 6 write tools. The MCP layer surfaces a structured error message naming the `mode:read` scope. See [Token scopes](#token-scopes) for minting steps.

## Tool registry growth

The registry has grown additively over multiple releases:

- `whoami` — initial debug tool.
- Cases / folders / tags / projects domain — 12 tools.
- Test-run + session + findings read domain — 10 tools, plus an additive `issueId` filter on `testplanit_cases_list`.
- Code-repositories / issues / repository-case-links read domain — 6 tools (`testplanit_code_repositories_list`, `testplanit_issues_find_by_key`, `testplanit_issues_list`, `testplanit_issues_get`, `testplanit_issues_list_links`, `testplanit_repository_case_links_list`), plus 7 maintenance filters + 2 row fields on `testplanit_cases_list` and inline `codeRepository` on `testplanit_cases_get`.
- Milestones domain — 3 read tools (`testplanit_milestones_list`, `testplanit_milestones_get`, `testplanit_milestone_types_list`), plus 3 additive filters on `testplanit_cases_list` (`creatorIds`, `from`, `to`).
- Issue link write domain — 2 write tools (`testplanit_issues_link`, `testplanit_issues_unlink`): batch-link / unlink any entity type to an issue in one call.
- Run / session / milestone write domain — 8 write tools added: `testplanit_runs_create`, `testplanit_runs_update`, `testplanit_runs_cases_add`, `testplanit_test_run_results_create`, `testplanit_sessions_create`, `testplanit_sessions_update`, `testplanit_milestones_create`, `testplanit_milestones_update`.

Total registered tools: **42** (matches the count at the top of this catalog).

## Claude Desktop configuration

Add the server to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "testplanit": {
      "command": "npx",
      "args": ["-y", "@testplanit/mcp-server"],
      "env": {
        "TESTPLANIT_API_TOKEN": "tpi_your_token_here",
        "TESTPLANIT_API_URL": "https://yourcompany.testplanit.com"
      }
    }
  }
}
```

Restart Claude Desktop after editing the config. The TestPlanIt server should appear in the MCP servers list. Send a message asking Claude to "use the testplanit whoami tool" to verify the wiring.

## Cursor configuration

Add the server to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project-scoped):

```json
{
  "mcpServers": {
    "testplanit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@testplanit/mcp-server"],
      "env": {
        "TESTPLANIT_API_TOKEN": "tpi_your_token_here",
        "TESTPLANIT_API_URL": "https://yourcompany.testplanit.com"
      }
    }
  }
}
```

Restart Cursor after editing. If you prefer to pull the token from your shell environment rather than hardcoding it, Cursor supports interpolation: `"TESTPLANIT_API_TOKEN": "${env:TESTPLANIT_API_TOKEN}"`.

## Diagnostics

- All diagnostic output is written to **stderr**. Stdout is reserved for the JSON-RPC stream — never write to it.
- On token-validation failure, a clear error is written to stderr and the process exits with code 1 **before** the agent expects a handshake response. Check the host client's MCP logs for the stderr text.
- Token strings are redacted to the first 8 characters (`tpi_xxxx`) in any error message — the full secret is never logged.

## Security notes

- Published with [npm provenance attestation](https://docs.npmjs.com/generating-provenance-statements). Verify the published artifact's chain of custody with:
  ```sh
  npm audit signatures @testplanit/mcp-server
  ```
- The package's `publishConfig` locks `provenance: true` and `access: "public"` at the source. The release workflow in this repo declares `id-token: write` so npm can attest the build.
- Read-only enforcement (`mode:read`) is verified end-to-end via Playwright in the host repo (`testplanit/e2e/tests/api-tokens/scopes.spec.ts`) — the chokepoint is shared with the REST API, so any client (browser, MCP, custom integration) hits the same gate.

## Roadmap

Phase 6+ adds production tools for the test-case, execution, and repository domains. Each new tool plugs into the same registry pattern (`tools/index.ts → registerAll`) without touching `server.ts`. The error-mapping seam (`mapHttpErrorToToolResult`) is already shared, so write tools that hit a `READ_ONLY_TOKEN` 403 surface the same friendly message Phase 5's `whoami` would.

## License

MIT

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
| `TESTPLANIT_API_URL`   | no       | Override for self-hosted instances. Defaults to the TestPlanIt SaaS endpoint when unset.                 |

The server validates `TESTPLANIT_API_TOKEN` against the TestPlanIt API on startup. Invalid, expired, or revoked tokens cause the server to exit with code 1 before the MCP handshake completes — the agent will report a clean failure rather than hang.

## Token scopes

API tokens have two optional scope tags that change the server's behavior:

- **`mode:read`** — narrows the token to read-only operations across REST and MCP. The host enforces a single chokepoint that returns HTTP 403 with `code: "READ_ONLY_TOKEN"` on any write attempt; the MCP server translates that into a friendly agent-visible error. Recommended for AI agents that should be able to query data but never modify it.
- **`client:mcp`** — attributes audit-log entries from this token to the MCP source (`metadata.source: "mcp"`). The attribution is derived from the token scope itself — it cannot be forged by request-time headers. Recommended for any token used by an MCP-aware agent so administrators can correctly attribute agent-driven changes.

Set scopes when creating the token in **Profile → API Tokens** (checkboxes: "Read-only" and "Mark as agent token"). A token with no scopes behaves as a full-access traditional API token (backwards compatible).

## Tool Catalog

Phase 6 ships 11 production tools across three domains plus a context-disambiguation helper. All tools authenticate via the bearer token in `TESTPLANIT_API_TOKEN`. Read tools return JSON; write tools return the same shape as their corresponding `_get` tool.

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
  "cursor": 100,
  "limit": 25
}
```

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

Fetch full details for a single test case, including steps (plain text), custom fields (flat dict keyed by display name), folder breadcrumb, linked issues, and linked automated tests.

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

## Soft-Delete Invariant

All TestPlanIt MCP "delete" tools perform soft-delete: they set `isDeleted: true` via PATCH update and never call the underlying ZenStack `delete` operation. Soft-deleted records remain in the database for audit purposes and are hidden from subsequent list/get tool calls.

## Read-Only Tokens

Tokens minted with the `mode:read` scope are blocked at the host on POST/PATCH/DELETE — including all Phase 6 write tools. The MCP layer surfaces a structured error message naming the `mode:read` scope. See [Token scopes](#token-scopes) for minting steps.

## Tool catalog (Phase 5)

| Tool     | Description                                                     |
| -------- | --------------------------------------------------------------- |
| `whoami` | Debug: returns the authenticated user (token owner) and scopes. |

Phase 5 ships the `whoami` tool. Phase 6 adds the full production tool surface documented above.

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
        "TESTPLANIT_API_URL": "https://your-instance.testplanit.com"
      }
    }
  }
}
```

Restart Claude Desktop after editing the config. The TestPlanIt server should appear in the MCP servers list. Send a message asking Claude to "use the testplanit whoami tool" to verify the wiring.

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

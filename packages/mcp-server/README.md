# @testplanit/mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server for [TestPlanIt](https://github.com/testplanit/testplanit). It lets AI agents — Claude Desktop, Cursor, and other MCP clients — read and update your test management data (test cases, runs, results, sessions, issues, and milestones).

## Quick start

```sh
npx @testplanit/mcp-server
```

The server speaks MCP over stdio, so your client launches it on demand — there's no daemon to run and no port to expose. You'll normally configure it inside your client rather than running it by hand (see [Client setup](#client-setup)).

## Requirements

Set two environment variables:

| Variable               | Required | Description                                                                                |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `TESTPLANIT_API_TOKEN` | yes      | An API token from **Profile → API Tokens** in TestPlanIt. Starts with `tpi_`.              |
| `TESTPLANIT_API_URL`   | yes      | The base URL of your TestPlanIt instance, e.g. `https://testplanit.yourcompany.com`.        |

The token is validated on startup. If it's invalid, expired, or revoked, the server exits immediately with a clear error (check your client's MCP logs) instead of hanging.

## Token scopes

When you create the token, two optional checkboxes change how the server behaves:

- **Read-only** (`mode:read`) — the token can query data but never modify it. Any write attempt is rejected with a clear error. Recommended for agents that should look but not touch.
- **Mark as agent token** (`client:mcp`) — changes made with this token are attributed to MCP in the audit log, so admins can tell agent-driven changes apart from human ones.

A token with neither option set behaves as a normal full-access API token.

## Client setup

### Claude Desktop

Add the server to `claude_desktop_config.json`:

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

Restart Claude Desktop, then ask it to "use the testplanit whoami tool" to confirm the connection.

### Cursor

Add the server to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project):

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

Restart Cursor after editing. To read the token from your shell instead of hardcoding it, use `"TESTPLANIT_API_TOKEN": "${env:TESTPLANIT_API_TOKEN}"`.

## Available tools

Your MCP client discovers each tool's full parameters automatically, so the list below is a quick map of what's available. Tools that create, update, or delete data are unavailable when the token is read-only.

### Discovery

| Tool | Description |
| --- | --- |
| `testplanit_whoami` | Show the authenticated user and token scopes — useful for verifying setup. |
| `testplanit_projects_list` | List the projects your token can access (to find project IDs). |

### Test cases

| Tool | Description |
| --- | --- |
| `testplanit_cases_list` | List and filter test cases in a project (by folder — optionally with all its descendants — tag, name, state, custom field, linked issue, automation flag, automated-result evidence, and more). Rows can inline the full folder path for leaf-to-area mapping. |
| `testplanit_cases_count` | Count test cases server-side under the same filters as `cases_list`, optionally grouped by folder, top-level folder, tag, state, source, or creator — coverage rollups in one call instead of paginating. |
| `testplanit_cases_get` | Get a single test case with its fields and steps. |
| `testplanit_cases_create` | Create a test case. Optionally pass `templateId` to choose a template (defaults to the project's first enabled template); custom fields are validated against the chosen template. Records the version 1 snapshot, so the case has history from the start. |
| `testplanit_cases_create_many` | Create many test cases in one call — far faster than per-case creates. Each case takes the same fields as a single create plus optional per-case `folderId`/`stateName`; returns a per-case success/failure result so partial failures are visible. |
| `testplanit_cases_update` | Update a test case. Custom fields are validated against the case's template. Bumps the case version and records a snapshot, the same as saving in the web UI. |
| `testplanit_cases_delete` | Delete a test case. |
| `testplanit_cases_generate_script` | Generate a QuickScript (AI automation test script) from one or more test cases. Resolves the project's export template and, when a code repository is connected, follows the repo's existing framework/fixtures/page objects. Requires QuickScript to be enabled for the project. Returns the generated file(s) plus the resolved framework/language/fileExtension. |

### Templates

| Tool | Description |
| --- | --- |
| `testplanit_templates_list` | List a project's enabled templates, each with the case fields it defines (display name, system name, type, required) — use it to pick a `templateId` for case creation and to learn which custom fields a template accepts. |

### Folders

| Tool | Description |
| --- | --- |
| `testplanit_folders_list` | List a project's folder tree to any depth, with accurate per-folder case counts and optional recursive + automated subtree totals. Nodes cut off by the depth limit are explicitly marked `truncated`. |
| `testplanit_folders_get` | Get a single folder with breadcrumb, children, and direct + recursive case counts (total and automated). |
| `testplanit_folders_create` | Create a folder. |
| `testplanit_folders_update` | Rename or move a folder. |
| `testplanit_folders_delete` | Delete a folder. |

### Tags

| Tool | Description |
| --- | --- |
| `testplanit_tags_list` | List tags in a project. |

### Test runs & results

| Tool | Description |
| --- | --- |
| `testplanit_test_runs_list` | List test runs in a project. |
| `testplanit_test_runs_get` | Get a single test run. |
| `testplanit_test_runs_cases_list` | List the cases included in a test run. |
| `testplanit_runs_create` | Create a test run. |
| `testplanit_runs_update` | Update a test run. |
| `testplanit_runs_cases_add` | Add test cases to a run (restores previously removed cases). |
| `testplanit_runs_cases_update` | Edit a case's row within a run — assign/unassign a tester or change its position. |
| `testplanit_runs_cases_remove` | Remove test cases from a run (soft-delete, including their recorded results). |
| `testplanit_test_run_results_list` | List execution results — manual and automated (JUnit-family) rows, discriminated by `source`. |
| `testplanit_test_run_results_get` | Get a single result with detail (step-level for manual results; stack trace / stdout / stderr for automated). |
| `testplanit_test_run_results_create` | Record a result for a case in a run. |

### Sessions

| Tool | Description |
| --- | --- |
| `testplanit_sessions_list` | List exploratory testing sessions. |
| `testplanit_sessions_get` | Get a single session. |
| `testplanit_sessions_create` | Create a session. |
| `testplanit_sessions_update` | Update a session. |
| `testplanit_sessions_findings_list` | List findings logged during sessions. |
| `testplanit_session_results_list` | List session results. |
| `testplanit_session_results_get` | Get a single session result with detail. |

### Issues

| Tool | Description |
| --- | --- |
| `testplanit_issues_list` | List issues in a project. |
| `testplanit_issues_get` | Get a single issue. |
| `testplanit_issues_find_by_key` | Resolve an external key (e.g. `JIRA-123`) to a TestPlanIt issue. |
| `testplanit_issues_list_links` | List the test cases linked to an issue. |
| `testplanit_issues_link` | Link an issue to a test case. |
| `testplanit_issues_unlink` | Remove an issue–case link. |

### Milestones

| Tool | Description |
| --- | --- |
| `testplanit_milestones_list` | List milestones in a project. |
| `testplanit_milestones_get` | Get a single milestone with progress. |
| `testplanit_milestones_create` | Create a milestone. |
| `testplanit_milestones_update` | Update a milestone. |
| `testplanit_milestone_types_list` | List the available milestone types. |

### Reviews

| Tool | Description |
| --- | --- |
| `testplanit_reviews_list` | List the review requests assigned to *you* — the same queue as the Review inbox in the app, covering both direct assignment and assignment to a role you hold. `view: "pending"` (default) is the work awaiting your decision; `view: "decided"` is your own decision history. Rows resolve the polymorphic subject to a name, carry the workflow transition being requested, and include the requester's submit-time note. |
| `testplanit_reviews_decide` | Approve, request changes on, or reject a review request assigned to you. Decisions are append-only and notify the requester, and **approving applies the requested workflow transition** — agents should confirm with you before calling. A comment is required for `CHANGES_REQUESTED` and `REJECTED`. Blocked for read-only (`mode:read`) tokens, and refused unless you are the assignee with approve permission for the entity's area. **Requires a TestPlanIt instance that accepts API-token review decisions** (shipped alongside `@testplanit/mcp-server` 1.0.0-beta.2); against an older instance the tool says so and `testplanit_reviews_list` still works. |

### Code repositories

| Tool | Description |
| --- | --- |
| `testplanit_code_repositories_list` | List code repositories linked to a project. |
| `testplanit_repository_case_links_list` | List links between test cases and repository code. |

## Diagnostics

- Diagnostic output goes to **stderr**; stdout is reserved for the MCP stream. Check your client's MCP logs to see it.
- On a token-validation failure the server writes a clear error to stderr and exits with code 1 before the client expects a response.
- Tokens are redacted to their first 8 characters (`tpi_xxxx`) in any log output — the full secret is never written.

## Security

- Published with [npm provenance attestation](https://docs.npmjs.com/generating-provenance-statements). You can verify the published artifact with:
  ```sh
  npm audit signatures @testplanit/mcp-server
  ```
- Read-only enforcement is shared with the TestPlanIt REST API, so a `mode:read` token is blocked from writes at the same gate regardless of the client.

## License

MIT

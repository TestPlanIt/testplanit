---
title: Example Prompts
sidebar_position: 3
---

# Example Prompts

These are real prompts you can paste into Claude Desktop, Cursor, or any MCP-aware agent once the TestPlanIt server is wired up. Each example shows the user-side text plus the canonical `testplanit_*` tool calls the agent should chain to answer it.

:::tip
Tool names in this guide are the canonical MCP names the server registers (`testplanit_{domain}_{operation}`). The agent decides when to call which tool — these examples document the *expected* chain so you can recognize when the agent gets it right.
:::

## Read-only flows

### "Who tested issue X?"

**User prompt:**

```text
Who tested JIRA-1234? Show me who ran tests for that issue most recently.
```

**Expected tool chain (2 calls):**

1. `testplanit_issues_find_by_key({ projectId: <P>, externalKey: "JIRA-1234", externalSystem: "JIRA" })` — resolves the issue id
2. `testplanit_cases_list({ projectId: <P>, issueId: <id from step 1> })` — returns RepositoryCases linked to the issue
3. `testplanit_test_run_results_list({ caseIds: [<from step 2>] })` — returns most recent results with `executedBy: { id, name, email }` inline

The two-call killer-app chain (`cases_list({ issueId })` → `test_run_results_list({ caseIds })`) is the canonical "who tested this?" pattern. The find-by-key step is optional — if the agent already has an issue id, it skips step 1.

### "What automated tests are stale?"

**User prompt:**

```text
Which automated tests in project Acme have not been updated alongside their code, or have never been run?
```

**Expected tool chain (1-2 calls):**

1. `testplanit_cases_list({ projectId: <P>, automated: true, staleSinceUpdate: true })` — returns automated tests whose latest execution timestamp is older than the latest update timestamp
2. *(optional)* `testplanit_cases_list({ projectId: <P>, automated: true, hasNeverExecuted: true })` — returns automated tests with no execution history at all

The maintenance filters (`staleSinceUpdate`, `hasNeverExecuted`) are designed to surface test debt. Combine with `repositoryId` to scope to a specific code repository in multi-repo projects.

### "Show me failed test runs from last week"

**User prompt:**

```text
Show me test runs in project Acme that completed in the last 7 days with failures.
```

**Expected tool chain (1 call):**

1. `testplanit_test_runs_list({ projectId: <P>, from: "<7 days ago ISO date>", to: "<today ISO date>", isCompleted: true })` — each row carries inline `statusCounts: [{id, name, count}]` so the agent can spot rows where the failed-status count is non-zero without a follow-up call

List rows on `testplanit_test_runs_list` carry inline status counts — a single call gives the agent enough data to filter to runs with failures locally before drilling into individual runs.

## Killer-app flow: PR Test Impact

The PR Test Impact flow is the highest-leverage use of TestPlanIt MCP. The user pastes a PR diff (or links to a PR), the agent reads the changed file paths from a separate tool (the GitHub MCP, a shell command, etc.), and TestPlanIt MCP answers *what tests does this PR affect, and where are the coverage gaps?*

**User prompt:**

```text
Here is the diff for PR #471. What automated tests live in those files, what manual cases are linked to them, and where are the coverage gaps?
```

**Expected tool chain (3-4 calls):**

1. *(Agent reads PR diff via separate tool — not a TestPlanIt MCP call.)*
2. `testplanit_cases_list({ projectId: <P>, name: "<path fragment>" })` per changed path — heuristic name-substring filter against test case titles. Repeated as needed.
3. `testplanit_repository_case_links_list({ caseId: <id from step 2> })` per automated case — returns linked manual cases.
4. `testplanit_cases_get({ id: <linked manual case id> })` — full details for any case the agent wants to summarize, including linked issues.

:::note
Path-array filtering (one tool call to find every automated test in a given list of file paths) is on the roadmap as a future capability. In v1, the agent uses name-substring heuristics on `testplanit_cases_list({ name })` and the maintenance filters from "What automated tests are stale?" to approximate the same answer.
:::

## See also

- [Overview](./mcp-overview.md) — what the MCP server does
- [Configuration](./mcp-configuration.md) — wire your AI client to TestPlanIt
- [npm package README](https://www.npmjs.com/package/@testplanit/mcp-server) — full tool reference for every prompt example above

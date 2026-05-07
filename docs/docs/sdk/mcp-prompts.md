---
title: Example Prompts
sidebar_position: 3
---

# Example Prompts

Real prompts you can paste into Claude Desktop, Cursor, or any MCP-aware agent
once the TestPlanIt server is wired up. Each example shows the user prompt, the
tool call(s) the agent is expected to make, and what the agent will see back.

:::tip
Tool names in this guide are the canonical MCP names the server registers
(`testplanit_{domain}_{operation}`). Most tools require a `projectId` — if the
agent does not already have one, it should call `testplanit_projects_list` first.
:::

## "Show me the most recent issues in project Acme"

```text
Show me the most recent issues in the Acme project.
```

**Tool calls (1–2):**

1. `testplanit_projects_list({})` — only if the agent does not already know the project id; returns `{ items: [{ id, name, ... }] }`.
2. `testplanit_issues_list({ projectId: <id> })` — required `projectId`. Optional filters: `externalSystem` (`JIRA | GITHUB | AZURE_DEVOPS | SIMPLE_URL`), `integrationId`, `status`, `externalStatus`, `cursor`, `limit` (default 25, max 100).

**What comes back:** a page of issues ordered by `createdAt DESC` then `id DESC`. Each row carries `linkedCaseCount` inline so the agent can rank issues by how many test cases reference them. Cursor-pagination via `nextCursor` for older pages.

```json
{
  "items": [
    { "id": 411, "externalKey": "JIRA-892", "summary": "Login fails on Safari",
      "status": "open", "externalStatus": "In Progress", "linkedCaseCount": 6,
      "createdAt": "2026-05-06T18:14:09Z" }
  ],
  "hasNextPage": true,
  "nextCursor": 411
}
```

## "Who tested JIRA-1234?"

```text
Who tested JIRA-1234? Show me the most recent results for that issue.
```

**Tool calls (3):**

1. `testplanit_issues_find_by_key({ projectId: <P>, externalKey: "JIRA-1234", externalSystem: "JIRA" })` → resolves the issue id.
2. `testplanit_cases_list({ projectId: <P>, issueId: <id from step 1> })` → RepositoryCases linked to the issue.
3. `testplanit_test_run_results_list({ caseIds: [<from step 2>] })` → most-recent results per case, ordered by `executedAt DESC`.

**What comes back:** a list of run results, each with `executedBy: { id, name, email }` inline. The agent can summarize "most recent run on case X was 3 days ago by Sarah, status Pass."

If the agent already has the issue id, it skips step 1.

## "Show me failed test runs from last week"

```text
Show me test runs in project Acme that completed in the last 7 days with failures.
```

**Tool calls (1):**

1. `testplanit_test_runs_list({ projectId: <P>, from: "<7-days-ago ISO>", to: "<today ISO>", isCompleted: true })`.

**What comes back:** each row carries inline `statusCounts: [{ id, name, count }]` plus `untested` and `total`. The agent filters to rows where the failed-status count is non-zero locally — no follow-up call needed for status rollup.

## "What automated tests are stale?"

```text
Which automated tests in project Acme have not been updated alongside their code,
or have never been run?
```

**Tool calls (1–2):**

1. `testplanit_cases_list({ projectId: <P>, automated: true, staleSinceUpdate: true })` → automated tests whose latest execution is older than the latest update.
2. (Optional) `testplanit_cases_list({ projectId: <P>, automated: true, hasNeverExecuted: true })` → automated tests with no execution history at all.

**What comes back:** each row carries `lastUpdatedAt` and `latestResult` inline so the agent can describe staleness without a follow-up call. The response stamps `truncated: true` when the post-filter scan cap (400) is hit; combine with `repositoryId` to scope.

## "What test cases live in this code repository?"

```text
List the automated test cases in our `playwright-suite` repository.
```

**Tool calls (2):**

1. `testplanit_code_repositories_list({ projectId: <P> })` → resolves repository ids; credentials are never returned. Note: this lists repositories that hold TestPlanIt's automated test code, not application code.
2. `testplanit_cases_list({ projectId: <P>, repositoryId: <id from step 1>, automated: true })` → cases imported from that test repo, with `lastUpdatedAt` + `latestResult` inline.

## "What manual cases cover this automated test?"

```text
Show me the manual test cases linked to automated test case #7.
```

**Tool calls (1):**

1. `testplanit_repository_case_links_list({ caseId: 7 })` → each row's `otherCase` carries the counterpart denormalized; optional `linkType` filter (e.g., `SAME_TEST_DIFFERENT_SOURCE`).

**What comes back:** a list of links each with `otherCase: { id, name, source, automated }` so the agent can describe the manual side-by-side coverage.

## See also

- [Overview](./mcp-overview.md) — what the MCP server does
- [Configuration](./mcp-configuration.md) — wire your AI client to TestPlanIt
- [npm package README](https://www.npmjs.com/package/@testplanit/mcp-server) — full tool reference for every prompt example above

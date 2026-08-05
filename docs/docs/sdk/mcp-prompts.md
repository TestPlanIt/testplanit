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

## "Create a test run for JIRA-892 with the uncovered cases"

```text
Create a test run for JIRA-892 covering all test cases linked to it.
```

**Tool calls (3):**

1. `testplanit_issues_find_by_key({ projectId: <P>, externalKey: "JIRA-892", externalSystem: "JIRA" })` → resolves the issue id.
2. `testplanit_cases_list({ projectId: <P>, issueId: <id from step 1> })` → gets the caseIds linked to that issue.
3. `testplanit_runs_create({ projectId: <P>, name: "JIRA-892 coverage run", caseIds: [<ids from step 2>] })` → creates the run and adds all the cases in a single call.

**What comes back:** the full run detail with `total` equal to the number of linked cases and `untested` equal to `total` (no results have been submitted yet).

```json
{
  "id": 5,
  "name": "JIRA-892 coverage run",
  "untested": 6,
  "total": 6,
  "statusCounts": [],
  "testCases": [ /* first 50 run cases inline */ ],
  "testCasesNextCursor": null
}
```

## "Mark the login test as passed in run 5"

```text
Mark the login test case as passed in run 5.
```

**Tool calls (2):**

1. `testplanit_test_runs_get({ runId: 5 })` → returns the run with inline `testCases`; each testCase has an `id` (the TestRunCase ID) and `repositoryCase.name` so the agent can identify the login case.
2. `testplanit_test_run_results_create({ testRunCaseId: <id of login case from step 1>, statusName: "Passed" })` → submits the result; the run case's current status is updated atomically.

**What comes back:** the full result detail including `attempt: 1`, the resolved status, and the testRunCase summary.

```json
{
  "id": 555,
  "attempt": 1,
  "executedAt": "2026-05-07T12:00:00Z",
  "status": { "id": 1, "name": "Passed" },
  "executedBy": { "id": "user-1", "name": "Alice", "email": "alice@example.com" },
  "testRunCase": {
    "id": 100,
    "repositoryCaseId": 99,
    "repositoryCase": { "id": 99, "name": "Login flow", "source": "MANUAL" },
    "testRun": { "id": 5, "name": "Sprint 12 regression" }
  },
  "elapsed": null,
  "notes": null,
  "stepResults": [],
  "attachments": [],
  "issues": []
}
```

## "Create these test cases from our checkout spec"

```text
Create these 20 test cases in project Acme under the "Checkout" folder using the
"Regression" template — each has steps and a Priority.
```

**Tool calls (2–3):**

1. (Optional) `testplanit_templates_list({ projectId: <P> })` → lists the project's enabled templates, each with the case fields it defines. The agent picks the right `templateId` and sees which custom fields (e.g. `Priority`) that template accepts.
2. (Optional) `testplanit_folders_list({ projectId: <P> })` → resolves the "Checkout" folder id.
3. `testplanit_cases_create_many({ projectId: <P>, folderId: <id>, templateId: <id>, cases: [ { name, steps, tags, customFields }, ... ] })` → creates all of them in one call. Each case may override `folderId`/`stateName`; `templateId` defaults to the project's first enabled template when omitted.

**What comes back:** a per-case results array so partial failures are visible — each entry is either a success (with the new `caseId`) or an error (with a message). A custom field that isn't part of the chosen template is reported as a per-case error rather than silently dropped.

```json
{
  "importedCount": 19,
  "failedCount": 1,
  "results": [
    { "id": "0", "name": "Guest checkout — valid card", "status": "success", "caseId": 1201 },
    { "id": "1", "name": "Checkout — expired card", "status": "error",
      "error": "Custom field(s) not part of template \"Regression\": Severity." }
  ]
}
```

## "What's waiting on my review?"

```text
What's in my review queue? Summarize each one and what it's asking me to approve.
```

**Tool calls (1–N):**

1. `testplanit_reviews_list({})` → the pending queue for whoever owns the token, oldest first. There is no user parameter — the tool can only return the caller's own work, covering both requests assigned to them directly and requests assigned to a role they hold.
2. (Optional, per row) `testplanit_cases_get` / `testplanit_test_runs_get` / `testplanit_sessions_get` using the row's `entityType` + `entityId` to read the thing under review before summarizing it.

**What comes back:** each row names the subject, the transition being requested, who asked, and their note.

```json
{
  "items": [
    {
      "id": "cm7x9k2p0000abcd",
      "status": "PENDING",
      "entityType": "CASE",
      "entityId": 99,
      "entityName": "Login flow",
      "entityDeleted": false,
      "project": { "id": 3, "name": "Acme" },
      "requestedBy": { "id": "user-2", "name": "Rita", "email": "rita@example.com" },
      "assignedTo": { "via": "ROLE", "userId": null, "name": "QA Lead", "roleId": 7 },
      "transition": { "from": { "id": 5, "name": "Draft" }, "to": { "id": 6, "name": "Approved" } },
      "requestNote": "Rewrote the 2FA steps — please check the lockout path.",
      "requestedAt": "2026-05-07T12:00:00Z",
      "decision": null
    }
  ],
  "hasNextPage": false,
  "nextCursor": null,
  "view": "pending",
  "reviewFeatureEnabled": true
}
```

Add `view: "decided"` to see your own decision history instead.

## "Approve the login flow review"

```text
Approve the review on the login flow case — the 2FA steps look right.
```

**Tool calls (2):**

1. `testplanit_reviews_list({})` → find the request whose `entityName` is the login flow case, and read its `id`.
2. `testplanit_reviews_decide({ reviewRequestId: "<id from step 1>", decision: "APPROVED", comment: "2FA steps look right" })`.

This is a real, irreversible act, so agents should confirm the decision with you before making it: decisions are append-only, the requester is notified, and **approving performs the transition** — the case moves from Draft to Approved as part of the call. `CHANGES_REQUESTED` and `REJECTED` require a `comment` explaining what is wrong; for `APPROVED` it is optional. The comment is posted to the entity's comment thread addressed to the requester.

**What comes back:** the decided request, with `transitionApplied` stating whether the entity moved.

```json
{
  "id": "cm7x9k2p0000abcd",
  "status": "APPROVED",
  "entityType": "CASE",
  "entityId": 99,
  "projectId": 3,
  "decisionComment": "2FA steps look right",
  "decidedAt": "2026-05-07T12:05:00Z",
  "decidedByUserId": "user-1",
  "transitionApplied": true,
  "appliedStateId": 6
}
```

Deciding from an agent needs a TestPlanIt instance that accepts API-token review decisions; against an older instance the tool says so, and listing the inbox still works either way. Eligibility is enforced server-side and is not negotiable from the client: the caller must be the assignee (directly or through an assigned role) **and** hold approve permission for the entity's area, or be a system admin. Anything else returns `INELIGIBLE_REVIEWER`. A read-only (`mode:read`) token is refused before the decision runs, which makes read-only tokens the safe default for agents you do not want approving things.

## See also

- [Overview](./mcp-overview.md) — what the MCP server does
- [Configuration](./mcp-configuration.md) — wire your AI client to TestPlanIt
- [npm package README](https://www.npmjs.com/package/@testplanit/mcp-server) — full tool reference for every prompt example above

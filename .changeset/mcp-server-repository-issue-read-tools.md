---
"@testplanit/mcp-server": minor
---

Add Phase 8 read tools for the repository + issue surface — six new tools and two extended ones:

- `testplanit_code_repositories_list` — list the project's code-repository configuration with a derived web URL per provider; the underlying `credentials` column is never selected and the `settings` JSON is stripped to a per-provider public-key allow-list at the mapper boundary.
- `testplanit_issues_find_by_key` — resolve `(externalKey, externalSystem, projectId)` to an Issue, with multi-match fallback when two integrations of the same provider share an external key in the same project.
- `testplanit_issues_list` — list issues scoped to a project, filtered by `externalSystem`, `integrationId`, `status`, `externalStatus`. Each row carries `linkedCaseCount` inline (the dominant fan-out — median 6, p95 35 in the dev DB).
- `testplanit_issues_get` — fetch a single issue with three inlined linked arrays (cases, sessions, test runs) capped at 100 rows each, with per-array `truncated` markers when overflow occurs.
- `testplanit_issues_list_links` — single dual-mode XOR tool covering all six Issue M:N junctions. Outbound: `{ issueId, target }` over `cases | sessions | sessionResults | testRuns | testRunResults | testRunStepResults`. Inbound: exactly one of `caseId | sessionId | sessionResultId | runId | runResultId | runStepResultId`.
- `testplanit_repository_case_links_list` — traverse the manual-vs-imported case linkage graph. 3-way XOR over `caseId` (bidirectional via OR clause), `caseAId` (one-way originating), or `caseBId` (one-way destination); optional `linkType` filter (`SAME_TEST_DIFFERENT_SOURCE | DEPENDS_ON`).
- `testplanit_cases_list` (extended) — adds 7 maintenance filters (`automated`, `source`, `repositoryId`, `hasNeverExecuted`, `staleSinceUpdate`, `updatedAfter`, `updatedBefore`) and 2 row fields (`lastUpdatedAt`, `latestResult`). The `where` literal is now a typed `Prisma.RepositoryCasesWhereInput` so any unknown column or relation accessor trips TS2353 at compile time.
- `testplanit_cases_get` (extended) — adds inline `codeRepository: { id, name, type, url? } | null` derived from the project's configured code repository.

Total registered tools: 28 (up from 22). All tools are read-only; existing `mode:read` token enforcement covers them without modification.

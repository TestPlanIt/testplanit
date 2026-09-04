---
"@testplanit/mcp-server": minor
---

Attach tracker issues by key, with no web-UI pre-step. Until now the only code path that turned a key like `PROJ-123` into a TestPlanIt `Issue` row was the browser: `testplanit_issues_link` needed an `issueId`, and `testplanit_issues_find_by_key` reported "not found" for any key a human had never opened in the app. An agent working a ticket had to ask someone to open it first — once per distinct ticket, every day — and a team migrating an existing repository had to do it for every key in the file.

`testplanit_issues_resolve` resolves one or more keys to `Issue` rows and creates any row that does not exist yet, reading the ticket through the project's own integration credentials — never client-supplied ones. It returns the same issue shape as `testplanit_issues_find_by_key`, so the two are interchangeable once you have a row; use `resolve` when the key may be new to TestPlanIt and `find_by_key` when you only want to look. `integrationId` is optional when the project has exactly one active issue-tracker integration.

`testplanit_issues_link` now accepts `externalKey` + `projectId` as an alternative to `issueId`, so attaching a ticket to test cases is one call. The two identifying forms are mutually exclusive — passing both is an error rather than a silent preference, because linking a different issue than the key you named is not a failure you would notice.

`testplanit_cases_create_many` takes per-case `issues`: an array of keys resolved and linked as part of the same request, deduplicated across the batch so fifty cases citing one ticket cost one lookup. A key that cannot be resolved fails only the cases citing it and is reported as a per-case error; the rest of the batch still imports.

Resolution upserts on `(externalId, integrationId)` — the same key the web UI writes — so a key resolved through the API and later linked in the browser is one row, not two. GitHub issues need the compound `owner/repo#N` form rather than a bare number, since a number alone does not identify a repository.

These tools require a TestPlanIt instance that serves `POST /api/projects/{projectId}/issues/resolve`; that server change ships with this release. Against an older instance the tools report that directly instead of blaming the token.

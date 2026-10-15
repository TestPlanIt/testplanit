# @testplanit/mcp-server

## 1.1.1

### Patch Changes

- [#693](https://github.com/TestPlanIt/testplanit/pull/693) [`9f844ad`](https://github.com/TestPlanIt/testplanit/commit/9f844ad71a1f5d7a7804d967b3a26567dc7174f4) Thanks [@therealbrad](https://github.com/therealbrad)! - `testplanit_issues_list` and `testplanit_issues_find_by_key` now return every issue the project can reach, not only the ones it imported first. A tracker ticket is one TestPlanIt issue per integration, shared by every project that imported it, resolved it by key, or linked it to a case, run, session, or milestone. Before this change a second project sharing an integration could not see or link a ticket another project had already imported.

## 1.1.0

### Minor Changes

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Run data-driven (parameterized) cases through the MCP server

  A case with a data set runs once per data row in the web UI, but a run
  created with `runs_create` or extended with `runs_cases_add` never got those
  iterations, and `test_run_results_create` could only record a case-level
  result, which overwrote the case's status and skipped the per-row rollup.

  - `runs_create` and `runs_cases_add` now generate the iterations, as the web
    UI does, and report how many in `iterations`. On a host without the
    matching fix the run is still created and `iterations` says why generation
    failed.
  - New `testplanit_test_run_case_iterations_list` lists a run case's iterations
    (row, label, values with sensitive ones redacted, status).
  - `test_run_results_create` takes `iterationId`, requires it for a data-driven
    case, and numbers attempts per iteration.
  - `runs_create` adds its cases in the same create as the run, so a bad case
    id no longer leaves an empty run behind.
  - A case re-added with `runs_cases_add` comes back untested, iterations
    included, instead of showing the status of results that were removed.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Attach tracker issues by key, with no web-UI pre-step. Until now the only code path that turned a key like `PROJ-123` into a TestPlanIt `Issue` row was the browser: `testplanit_issues_link` needed an `issueId`, and `testplanit_issues_find_by_key` reported "not found" for any key a human had never opened in the app. An agent working a ticket had to ask someone to open it first — once per distinct ticket, every day — and a team migrating an existing repository had to do it for every key in the file.

  `testplanit_issues_resolve` resolves one or more keys to `Issue` rows and creates any row that does not exist yet, reading the ticket through the project's own integration credentials — never client-supplied ones. It returns the same issue shape as `testplanit_issues_find_by_key`, so the two are interchangeable once you have a row; use `resolve` when the key may be new to TestPlanIt and `find_by_key` when you only want to look. `integrationId` is optional when the project has exactly one active issue-tracker integration.

  `testplanit_issues_link` now accepts `externalKey` + `projectId` as an alternative to `issueId`, so attaching a ticket to test cases is one call. The two identifying forms are mutually exclusive — passing both is an error rather than a silent preference, because linking a different issue than the key you named is not a failure you would notice.

  `testplanit_cases_create_many` takes per-case `issues`: an array of keys resolved and linked as part of the same request, deduplicated across the batch so fifty cases citing one ticket cost one lookup. A key that cannot be resolved fails only the cases citing it and is reported as a per-case error; the rest of the batch still imports.

  Resolution upserts on `(externalId, integrationId)` — the same key the web UI writes — so a key resolved through the API and later linked in the browser is one row, not two. GitHub issues need the compound `owner/repo#N` form rather than a bare number, since a number alone does not identify a repository.

  These tools require a TestPlanIt instance that serves `POST /api/projects/{projectId}/issues/resolve`; that server change ships with this release. Against an older instance the tools report that directly instead of blaming the token.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Return rich text as Markdown so it survives a read, edit and write back

  Rich-text fields were flattened to plain text on read: case steps and
  expected results, `Text Long` custom fields, session missions and notes,
  milestone notes and docs, issue notes, result notes and review notes. An
  agent that read a case with `cases_get`, changed one step and sent the steps
  back with `cases_update` erased every step's bold, lists, links and code, and
  multi-line text came back joined. These values are now returned as Markdown
  (paragraphs separated by a blank line, a line break as a newline), which the
  host converts back into the same document on write.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Create cases through the same writer as `cases_create_many`, with the web UI's checks

  `cases_create` and `cases_create_many` used to store the same input
  differently: one built the case row by row, the other went through the host's
  bulk-create route. `cases_create` now calls bulk-create with a single case, so
  both write in one transaction and store identical data. On a host that
  includes the matching fixes, custom field values are also checked and stored
  the way the web UI stores them:

  - Dropdown and Multi-Select options by name (any case) or id; unknown options
    are refused rather than stored raw.
  - Integer and Number values as numbers within the field's min/max; Checkbox
    values as true/false, including the strings "true" and "false"; dates as
    ISO timestamps, a bare `YYYY-MM-DD` reading as that day everywhere; Links as
    http(s) URLs.
  - Template defaults fill the fields you leave out (the Dropdown option marked
    default, a Checkbox's default, default text), and a required field without
    a value fails the case with a message naming it.
  - Restricted fields need the restricted-fields permission.

  `cases_create` also accepts `issues` (tracker keys) and `integrationId`, as
  `cases_create_many` does, and refuses names over 255 characters instead of
  cutting them.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Add `runs_execute`, `runs_automation_plan` and `automation_targets_list`

  An agent can now list a project's execution targets, ask TestPlanIt to run a
  run's automated cases on one of them (optionally a subset of cases or a
  different ref), and read the plan a dispatched job executes. `HYBRID` runs —
  manual runs that also received automated results — roll up by case like
  `REGULAR` runs.

  Requires a TestPlanIt host with automated execution (the
  `/api/test-runs/{id}/execute`, `/automation-plan` and
  `/api/projects/{id}/execution-targets` routes).

### Patch Changes

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Default to the workflow state marked Default when none is named

  Creating a case, run or session without a state name picked the enabled
  state with the lowest order, so an admin's Default state was ignored and new
  items landed in a different state than the web UI puts them in. The MCP
  `cases_create`, `cases_create_many`, `runs_create` and `sessions_create`
  tools, and `createTestCase` / `createTestCases` in the API client, now prefer
  the state marked Default and fall back to the first by order.

  The API client's published build also catches up with `getAutomationPlan`
  and `finishExecution`, which were in the source but missing from `dist`.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Record a case version whenever `cases_create` or `cases_update` changes a case

  Creating or editing a case through this server left no version history: the
  case sat at `currentVersion: 1` with no snapshot row, while the same edit made
  in the web UI produced a version per save. That is not only an audit gap — a
  run result records the case version it executed against and links back to it,
  so a case maintained over the API could never be read back as it was when it
  ran.

  `cases_create` now writes the version 1 snapshot last, once steps, tags and
  custom fields are attached, and a failure there rolls the new case back the
  same way any other post-create failure does. `cases_update` bumps the case's
  version and snapshots it after the edit lands, and skips both when the call
  carried no writable field.

  Requires a TestPlanIt host that accepts API tokens on
  `POST /api/repository/cases/{caseId}/versions`; on an older host the version
  call fails and the tool reports it rather than silently leaving no history.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - `cases_get` reads the project's QuickScript repository through the new
  `codeRepositoryConfigs` relation (a project can now bind one repository per
  purpose), so the inline `codeRepository` block keeps resolving after the
  server upgrade.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Move a run or session to its Done state when `runs_update` or `sessions_update` completes it

  Completing a run or session with `isCompleted: true` only set the completed
  flag, so it showed as completed while its workflow state still read "In
  Progress". Without a `stateName`, completion now moves it to the project's
  first Done state, as the web UI's Complete dialog does. A state named in the
  same call is kept.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Use the template marked Default when `cases_create` omits `templateId`

  With no `templateId`, `cases_create` picked the project's enabled template with
  the lowest id, so a project whose admin had marked a different template as
  Default got cases on the wrong template, and custom fields that exist only on
  the Default template were rejected. The tool now prefers the Default template
  when it is assigned to the project and falls back to the lowest id otherwise,
  the same choice the web UI makes. `cases_create_many` gets the same behaviour
  from the host's bulk-create route on a host that includes the matching fix.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Stop returning trashed sessions and counting removed rows

  `sessions_get` and `session_results_get` returned sessions and results that
  were in the Trash, and `session_results_list` listed the results of trashed
  sessions. Those now read as not found, or are left out. Milestone status
  counts in `milestones_list` and `milestones_get` counted cases removed from
  their runs, and `commentCount` counted deleted comments; both now count only
  live rows.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Keep the host's error code in tool errors

  A host error with a code the MCP server has no friendly message for lost the
  code, so a completion refused for lack of permission read only "HTTP 403".
  The code is now kept in the text, e.g. `(HTTP 403, COMPLETE_NOT_PERMITTED)`.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Rename a folder aside when `folders_delete` deletes it

  The web UI appends `_deleted_<timestamp>` to a folder's name when it deletes
  it, because folder names are unique among siblings together with the deleted
  flag. `folders_delete` only set the flag, so deleting a folder, creating a new
  one with the same name and deleting that too failed on the unique index.
  It now renames the folder the same way.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Link issues to test cases with `issues_link`, `issues_unlink` and `issues_list_links`

  Test cases reach issues through a join model, but these tools addressed a
  direct relation that does not exist, so linking or unlinking a test case was
  rejected and listing the cases linked to an issue (or the issues linked to a
  case) failed. Case links are now created and removed through the join model,
  the same way the web UI does it, and a repeated link is a no-op.

  Delete operations now send their filter where the host reads it. None of the
  existing tools used one, but a filter sent the old way would have been ignored
  and the delete applied to every row the caller could reach; a delete with no
  filter is now refused outright.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - `testplanit_issues_list` used to return every issue row in a project, with no distinction between rows tracked as defects and rows tracked as requirements. TestPlanIt can now classify an issue as a requirement — a different kind of row from a defect, used to express what a project needs rather than what is broken. `testplanit_issues_list` now returns only non-requirement issues by default, matching the defect-focused view most agents expect. Pass `includeRequirements: true` to widen the result back to both kinds. Single-issue lookups by id or key are unaffected — an agent that fetched a specific issue before still gets it, requirement or not.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Place new cases and folders after their siblings

  `cases_create` and `folders_create` wrote no order, so every case or folder
  created through them got 0 and sorted to the top of its folder, tied with the
  first item there. New cases now go after the folder's last case and new
  folders after their last sibling, as in the web UI, and a folder moved with
  `folders_update` goes after its new siblings.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Offer the Default milestone type, and make it the default for `milestones_create`

  `milestone_types_list` listed only the types assigned to the project, but the
  type marked Default is available to every project and is the one the web UI
  preselects, so an agent could miss the most common choice.
  It is now included, and `milestones_create` uses it when `milestoneTypeId` is
  omitted. `milestones_create` also works again on a host with the matching
  fix, which fills in the creator the tool never sent.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Record the case's current version on results from `test_run_results_create`

  Every result submitted through `test_run_results_create` claimed it ran
  against version 1 of the case, whatever version the case was at, so opening an
  agent-written result showed the steps of the case's first version. The tool
  now records the case's current version at submission, the same value the web
  UI sends.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Record results like the web UI's result dialog

  `test_run_results_create` accepted any status enabled for the project,
  including automation-only ones the web UI never offers for a manual result;
  it now accepts only test-run statuses. It also moves the run to its In
  Progress state with the first result, as the web UI does, so runs worked
  only through the MCP server no longer stay in their initial state. A new
  `issueIds` input links issues to the result, which a project that requires an
  issue on failure needs before it accepts a failed result.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Report whether an approval actually moved the entity

  `reviews_decide` set `transitionApplied: true` for every approval, but the
  host applies the transition best-effort and can skip it (the entity is gone
  or already past the target state) without failing the decision. The tool
  now reads the entity back and reports `transitionApplied` from its actual
  state, adding `currentStateId`.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Return plain text for rich-text fields no matter which client saved the record

  The web UI stores rich text as a JSON string while this server stores the
  document object, so `cases_get` returned step text as plain text right after
  an MCP write but as a raw Tiptap JSON string once the case had been saved from
  the UI. Reading a serialized document now yields the same plain text either
  way, so an agent no longer has to detect and parse both shapes. This applies
  everywhere rich text is read — case steps and expected results, `Text Long`
  custom fields, session missions and notes, milestone notes and docs, issue
  notes, run and result notes, and review comments.

  A string that is not a serialized document still passes through untouched, so
  plain-text values that merely look like JSON are never flattened.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - `runs_update` no longer reopens a completed run

  The web UI has no way to reopen a completed test run. `runs_update` now
  refuses `isCompleted: false` with an error instead of clearing the run's
  completion. The `cases_update` tool description and the README now note that
  shared steps aren't supported: replacing a case's steps removes its shared
  step groups.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Record session version history from `sessions_create` and `sessions_update`

  The web UI writes a version snapshot when a session is created, edited or
  completed; sessions written through the MCP server had no history. On a
  host that includes the matching versions route, `sessions_create` now
  records version 1 and `sessions_update` records the next version, reported
  as `version` in the result. On an older host the session is still written
  and `version` says why no snapshot was taken.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Convert Markdown in step text written by `cases_create` and `cases_update`

  Steps were wrapped in a single plain paragraph before they reached the host,
  so `Open the **New leads** board` was stored with the asterisks in it and the
  editor showed them literally. Step text and expected results are now sent as
  written, and the host converts Markdown, HTML or plain text into a rich-text
  document the same way the bulk-create route and CSV import do.

  `Text Long` custom field values are converted by the host as well, on a host
  that includes the matching fix; an older host stores them as written.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Accept the same tag twice in one call

  Tag names match case-insensitively, so `["Smoke", "smoke"]`, or a tag's id
  together with its name, resolved to the same tag twice; `cases_create` then
  failed and rolled the new case back, and `cases_update` errored. Each tag is
  now linked once. On a host with the matching fix, new tag names are also
  trimmed and cleaned the way the web UI does, so " smoke" joins "Smoke".

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Keep the issue a failed result requires when unlinking

  `issues_unlink` could remove the last issue from a failed result in a project
  that requires an issue on failure, which the web UI refuses. Unlinking from a
  result or step result now fails with ISSUE_REQUIRED_ON_FAILURE when it would
  leave such a result with no issue, counting issues on its steps too.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Store custom field values from `cases_update` the way the web UI does

  `cases_update` passed every value other than a Dropdown or Multi-Select
  straight through, so a Checkbox sent as "false" was stored as a string that
  rendered checked, numbers sent as strings sorted as text, and a date without a
  time showed as the day before for users west of UTC. Values are now stored in
  the web UI's shapes, matching `cases_create`: numbers within the field's
  min/max, true/false for Checkbox, ISO dates (a bare YYYY-MM-DD reads as that
  day everywhere), http(s) links, and option names matched case-insensitively.
  A single Multi-Select option is taken as a one-item list, and disabled
  options are no longer accepted. The same rules apply to `cases_list` custom
  field filters.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Record one version per `cases_update`, even when it flips `automated`

  `cases_update` wrote the case, then its steps and fields, then bumped the
  version in a separate call. Flipping `automated` let the host record an
  extra version of the half-written case in between, so one edit produced two
  versions, the first with the old steps. Steps and fields are now written
  first, and the version bump travels with the case's own changes in a single
  write, as a web UI save does.

- [#674](https://github.com/TestPlanIt/testplanit/pull/674) [`733a195`](https://github.com/TestPlanIt/testplanit/commit/733a1956aa0fa16e2de03fa58c37afc146c3ed43) Thanks [@therealbrad](https://github.com/therealbrad)! - Keep the tags `cases_update` sets

  `cases_update` with `tags` cleared the existing links and created the new
  ones in one nested write, and the host ran the create first, so the call
  removed every tag and the version it recorded had none. The update now
  removes only the links that are no longer wanted and adds only the missing
  ones, so the case ends up with exactly the requested tags.

## 1.0.1

### Patch Changes

- [#642](https://github.com/TestPlanIt/testplanit/pull/642) [`1b4bf39`](https://github.com/TestPlanIt/testplanit/commit/1b4bf39af86bce705de7cec6623745a8e9e6bbc2) Thanks [@therealbrad](https://github.com/therealbrad)! - Result `elapsed` is documented as seconds everywhere (the unit the database, UI, exports and `/api/test-runs/submit-result` use — the MCP tool described it as milliseconds and stored the value unchanged, so 95000 showed as "1 day 2 h"), and plain-text result `notes` are stored as a rich-text document (one paragraph per line) so they render in the Test Result History panel instead of an empty editor. `@testplanit/api`'s `createTestResult` now accepts a plain string for `notes` and wraps it the same way.

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

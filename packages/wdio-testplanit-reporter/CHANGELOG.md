# @testplanit/wdio-reporter

## 0.8.2

### Patch Changes

- [#564](https://github.com/TestPlanIt/testplanit/pull/564) [`ba7e7a5`](https://github.com/TestPlanIt/testplanit/commit/ba7e7a504e31ed723bf7fc72850173a6111f2cfa) Thanks [@therealbrad](https://github.com/therealbrad)! - Stop losing test results when parallel workers race to create the same folder. The API client now recognizes a unique-constraint violation in every form the server reports it (Postgres SQLSTATE 23505 and message, Prisma message, P2002 code) and recovers by fetching the folder the other worker created. Folder creation is also memoized per `projectId` + `parentId` + `name` within a client instance, so concurrent describe paths that share an ancestor issue a single create instead of racing. And if folder resolution still fails, both reporters now file the case under the configured parent folder instead of dropping the result.

- Updated dependencies [[`ba7e7a5`](https://github.com/TestPlanIt/testplanit/commit/ba7e7a504e31ed723bf7fc72850173a6111f2cfa)]:
  - @testplanit/api@0.9.2

## 0.8.1

### Patch Changes

- [#560](https://github.com/TestPlanIt/testplanit/pull/560) [`34c8079`](https://github.com/TestPlanIt/testplanit/commit/34c8079e00c325df6af7955babfbade8a5a064fb) Thanks [@therealbrad](https://github.com/therealbrad)! - Export the service-created run ID so forked workers report into it

  `TestPlanItService.onPrepare` now sets `TESTPLANIT_RUN_ID` to the run it just
  created. Workers are forked from the launcher, so they inherit the variable and
  their reporters take the same externally managed path a pipeline-pinned run
  uses: they attach results only, and never create a run, discover one through the
  `oneReport` shared-state file, or complete one. Previously workers could only
  find the service's run by reading that shared-state file, which requires
  `oneReport` and a temp directory every worker can reach — neither holds for
  workers on separate agents or in separate containers, and those workers created
  a run of their own.

  The service still owns the lifecycle and completes the run in `onComplete`, so
  no external sweep is needed. Exporting the ID does not make the service treat
  its own run as externally managed.

  A run pinned by the pipeline is untouched: the variable is already set, nothing
  is created, and the original value is left alone. The export is reverted in
  `onComplete` — and if `onPrepare` fails — so a completed run's ID cannot leak
  into a later launcher in the same process.

## 0.8.0

### Minor Changes

- [#555](https://github.com/TestPlanIt/testplanit/pull/555) [`9f838ab`](https://github.com/TestPlanIt/testplanit/commit/9f838ab3ff546166b25d96db6d944da2c9d3465d) Thanks [@therealbrad](https://github.com/therealbrad)! - Attach every invocation to one externally managed test run

  A suite executed as several separate wdio invocations — shards across CI agents,
  or sequential retry waves — created a run per invocation, since `oneReport`
  coordinates through a file in the OS temp directory that cannot reach another
  agent and resets once a run's workers have finished.

  Set `TESTPLANIT_RUN_ID` (or pass `testRunId`) and the reporter attaches to that
  run instead. Such a run is externally managed: the reporter never creates it,
  never completes it regardless of `completeRunOnFinish`, never discards it
  through the "start fresh" recovery paths, and leaves its configuration,
  milestone, state and tags alone. The pipeline owns the lifecycle via the new
  `testplanit create-run` / `testplanit complete-run` commands.

  `TestPlanItService` honours the same variable and its own `testRunId` option, so
  the recommended service + reporter setup needs no config change: the service
  reports into the pinned run rather than creating one in `onPrepare`, and leaves
  it open in `onComplete`. It applies `runLinks` and `runMetadata` only to runs it
  created, since those describe the run as a whole; `runAttachments` still upload
  from every execution.

  Each execution records its own JUnit suite under the shared run, named
  `{suite} - {browser}/{platform} - {spec}` by default; results roll up at the run
  level. The new `testSuiteName` option overrides that on both the reporter and
  the service, using the same placeholders as `runName` (plus `{env:VAR}` on the
  service, whose launcher process has no browser or spec to name shards by).

  Also fixes suite state being adopted across runs: the shared-state file is keyed
  by project, so a suite recorded by an earlier invocation could capture results
  belonging to a different run. Suite state is now only reused when it belongs to
  the run being reported into.

  With no run supplied, behaviour is unchanged.

### Patch Changes

- Updated dependencies [[`9f838ab`](https://github.com/TestPlanIt/testplanit/commit/9f838ab3ff546166b25d96db6d944da2c9d3465d)]:
  - @testplanit/api@0.9.0

## 0.7.0

### Minor Changes

- [#550](https://github.com/TestPlanIt/testplanit/pull/550) [`5145332`](https://github.com/TestPlanIt/testplanit/commit/51453327f9750da7bee8eea4c7a663936f2e8474) Thanks [@therealbrad](https://github.com/therealbrad)! - Add an `excludeSkipped` option to both reporters. When enabled, skipped results are not reported to TestPlanIt at all — they don't appear on the run and don't count toward its totals. The check runs before any API work, so a spec whose tests were all skipped never creates a test run. For the WebdriverIO reporter this also covers `pending` results and Cucumber scenarios whose steps were skipped. Default is disabled: skipped results keep being reported exactly as before.

## 0.6.0

### Minor Changes

- [#548](https://github.com/TestPlanIt/testplanit/pull/548) [`65a5452`](https://github.com/TestPlanIt/testplanit/commit/65a545262b02a39bf31b73cfcd9439b4d5c258f7) Thanks [@therealbrad](https://github.com/therealbrad)! - Add first-class run-level attachments — links, files, and key/value metadata on the test run itself (not on individual results) — so consumers no longer need to import `@testplanit/api` or call private client internals.

  - **`@testplanit/wdio-reporter`**: new declarative `TestPlanItService` options applied exactly once (in the launcher) right after the run is created: `runLinks` (clickable link attachments, e.g. a CI build URL), `runAttachments` (file attachments; a `path` that doesn't exist yet is retried once after all workers finish), and `runMetadata` (rendered as `**key:** value` lines in the run's documentation). All string values support `{env:VAR}` placeholders; entries referencing unset environment variables are skipped instead of producing broken values. New runtime API installed on the WebdriverIO browser in every worker — `browser.testplanit.attachToRun({ url | path | buffer, ... })`, `browser.testplanit.setRunMetadata({...})`, and `browser.testplanit.getRunId()` — always resolving to the single service-managed run regardless of which worker calls it. All run-level operations log and swallow failures; they can never fail the test run.
  - **`@testplanit/playwright-reporter`**: the same declarative `runLinks` / `runAttachments` / `runMetadata` options on the reporter, applied once right after the reporter creates the run (skipped when appending to an existing run via `testRunId`, so re-runs don't attach duplicates); unreadable `runAttachments` paths are retried once in `onEnd`. New runtime helpers `attachToRun(testInfo, { url | path | buffer, ... })` and `setRunMetadata(testInfo, {...})` — they ride Playwright's own attachment transport under reserved `testplanit:run-*` names, which the reporter intercepts in the main process and routes to run-level API calls (never uploaded to the result; identical operations are deduped so retried tests don't create duplicates).
  - **`@testplanit/api`**: new public `TestPlanItClient` methods `addTestRunLink(testRunId, url, name?, note?)` (creates a `text/uri-list` link attachment on the run), `uploadTestRunAttachment(testRunId, file, fileName, mimeType?)` (uploads and attaches a file to the run), and `setTestRunMetadata` / `getTestRunMetadata` (merge/read key-value metadata in the run's `docs` field, preserving hand-written content). Also exports the pure `mergeRunMetadataIntoDoc` / `parseRunMetadataFromDoc` helpers and `RunMetadata` types, and `createTestRun` now honors its previously declared-but-ignored `note`/`docs` options.

### Patch Changes

- Updated dependencies [[`65a5452`](https://github.com/TestPlanIt/testplanit/commit/65a545262b02a39bf31b73cfcd9439b4d5c258f7)]:
  - @testplanit/api@0.8.0

## 0.5.1

### Patch Changes

- [#526](https://github.com/TestPlanIt/testplanit/pull/526) [`9c2fc5c`](https://github.com/TestPlanIt/testplanit/commit/9c2fc5c5df41393cb29996d4233b5a86d14f3128) Thanks [@therealbrad](https://github.com/therealbrad)! - Mark a case as automated once it starts receiving automated results.

  - **`@testplanit/api`**: new `client.updateTestCase(caseId, { automated? })` — a minimal, forward-compatible partial update (only the fields you pass are written, so more can be added later without a breaking change). `findOrCreateTestCase` now also flips an existing **found** case to `automated: true` when the caller wants an automated case (the default) and the case isn't already automated; the write is skipped when it already is.
  - **`@testplanit/wdio-reporter`**: when `matchByCustomField` attaches a result to an existing case (typically a migrated `MANUAL` case), the reporter now flips that case to `automated: true` if it isn't already — so a case that started manual but now runs under automation stops showing as "not automated". The write is skipped when the case is already automated (no redundant call per run) and, like the rest of the `matchByCustomField` path, a failure here never aborts result reporting.
  - **`@testplanit/mcp-server`**: `testplanit_cases_update` accepts an `automated` boolean, for one-off cleanup of cases that should be flagged automated.

- Updated dependencies [[`9c2fc5c`](https://github.com/TestPlanIt/testplanit/commit/9c2fc5c5df41393cb29996d4233b5a86d14f3128)]:
  - @testplanit/api@0.7.0

## 0.5.0

### Minor Changes

- [#521](https://github.com/TestPlanIt/testplanit/pull/521) [`53f406b`](https://github.com/TestPlanIt/testplanit/commit/53f406b78f60766e07b6f2c4783b33aa020d32b2) Thanks [@therealbrad](https://github.com/therealbrad)! - Add `matchByCustomField` case resolution to the WebdriverIO reporter — attach automated results to an existing case by a custom field value.

  - **`@testplanit/wdio-reporter`**: new opt-in `matchByCustomField: { fieldName, idPattern? }` option. When a test title carries a legacy external identifier (default `idPattern: /^(\d+)/`, a bare leading number) that was backfilled onto migrated cases as a custom field, the reporter resolves the existing case by that field's value and attaches the result **directly** to it — regardless of the case's `source` (e.g. `MANUAL`), creating no new case, folder, or link. It runs before the name-matching / `autoCreateTestCases` fallback and is independent of `caseIdPattern`; on no match, or if the named field does not exist, it falls through to the existing behavior without error. Off by default, so existing configurations are unaffected.
  - **`@testplanit/api`**: new `client.findTestCaseByCustomField({ projectId, fieldName, value })` that resolves a case by a custom field value (matched on the field's display name, in both its numeric and string forms) rather than by name/className/source.

### Patch Changes

- Updated dependencies [[`53f406b`](https://github.com/TestPlanIt/testplanit/commit/53f406b78f60766e07b6f2c4783b33aa020d32b2)]:
  - @testplanit/api@0.6.0

## 0.4.3

### Patch Changes

- Updated dependencies [[`79c4db0`](https://github.com/TestPlanIt/testplanit/commit/79c4db008dc0d021844a1aaf60c6e790f750582f)]:
  - @testplanit/api@0.5.0

## 0.4.2

### Patch Changes

- Updated dependencies [[`ea8f7cd`](https://github.com/TestPlanIt/testplanit/commit/ea8f7cd199dc239bb105cb876bc4120dff43827e)]:
  - @testplanit/api@0.4.0

## 0.4.1

### Patch Changes

- [#389](https://github.com/TestPlanIt/testplanit/pull/389) [`28121cd`](https://github.com/TestPlanIt/testplanit/commit/28121cd565165135f38c032c073fe5964efbdab7) Thanks [@therealbrad](https://github.com/therealbrad)! - Lower minimum Node.js requirement to 20

  Relaxes `engines.node` from `>=24` to `>=20` so the packages can be installed on projects that have not yet upgraded to Node 24. The client code only relies on APIs available since Node 18 (`fetch`, `FormData`, `Blob`, `AbortSignal.timeout`, and Web Streams); the previous `>=24` pin came from a workspace-wide standardization rather than an actual code requirement.

- Updated dependencies [[`28121cd`](https://github.com/TestPlanIt/testplanit/commit/28121cd565165135f38c032c073fe5964efbdab7)]:
  - @testplanit/api@0.3.1

## 0.4.0

### Minor Changes

- [#262](https://github.com/TestPlanIt/testplanit/pull/262) [`478e170`](https://github.com/TestPlanIt/testplanit/commit/478e170e5d395c18ce4a9593f765f4a2db26cc33) Thanks [@therealbrad](https://github.com/therealbrad)! - Require Node.js 24 LTS or later
  - Bumps `engines.node` to `>=24` (was `>=18`) to align with the rest of the workspace, which is now standardized on Node 24 LTS
  - `@testplanit/wdio-reporter` also refreshes `@types/node` from `^20` to `^25` to match

### Patch Changes

- Updated dependencies [[`478e170`](https://github.com/TestPlanIt/testplanit/commit/478e170e5d395c18ce4a9593f765f4a2db26cc33)]:
  - @testplanit/api@0.3.0

## 0.3.1

### Patch Changes

- [`5e1ab2c`](https://github.com/TestPlanIt/testplanit/commit/5e1ab2ca0f5da500b824286b8554d53fa7068aa5) Thanks [@therealbrad](https://github.com/therealbrad)! - Update README with launcher service documentation, service configuration options, and correct reporter options to match actual implementation

## 0.3.0

### Minor Changes

- [`0173941`](https://github.com/TestPlanIt/testplanit/commit/0173941ca45127d33e79d05c041f23a8b071f29e) Thanks [@therealbrad](https://github.com/therealbrad)! - Add launcher service for single test run across all spec files
  - New `TestPlanItService` WDIO launcher service with `onPrepare`/`onComplete` hooks that create a single test run before workers start and complete it after all finish
  - `captureScreenshots` option on the service to automatically capture screenshots on test failure
  - Extract shared state coordination into `shared.ts` for service-reporter communication
  - String-based `configId`, `milestoneId`, `stateId`, and `tagIds` resolution via API

## 0.2.0

### Minor Changes

- [#25](https://github.com/TestPlanIt/testplanit/pull/25) [`0baed0a`](https://github.com/TestPlanIt/testplanit/commit/0baed0a9145d95994a1a12b068a38016340c1b7d) Thanks [@therealbrad](https://github.com/therealbrad)! - Initial release of TestPlanIt npm packages
  - `@testplanit/api`: Official JavaScript/TypeScript API client for TestPlanIt
  - `@testplanit/wdio-reporter`: WebdriverIO reporter for TestPlanIt test management

### Patch Changes

- Updated dependencies [[`0baed0a`](https://github.com/TestPlanIt/testplanit/commit/0baed0a9145d95994a1a12b068a38016340c1b7d)]:
  - @testplanit/api@0.2.0

## 0.1.0

### Minor Changes

- Initial release of the TestPlanIt WebdriverIO reporter
- Report test results directly to TestPlanIt instances
- Features:
  - Parse test case IDs from test titles (e.g., `C12345 should work`)
  - Support for multiple case IDs per test
  - Automatic test run creation with customizable names
  - Real-time result reporting
  - Screenshot uploads on test failure
  - Auto-create test cases option
  - Configurable status mappings
  - Support for WebdriverIO v8 and v9
- Built on `@testplanit/api` for reliable API communication

# @testplanit/wdio-reporter

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

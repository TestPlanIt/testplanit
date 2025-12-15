# @testplanit/wdio-reporter

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

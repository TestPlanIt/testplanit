# @testplanit/wdio-reporter

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

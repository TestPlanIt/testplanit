---
"@testplanit/mcp-server": patch
---

Fix the run-level status rollup (`statusCounts` / `untested` / `total`) reporting automated runs as 100% untested. Automated runs (testRunType JUNIT/TESTNG/xUnit/NUnit/MSTest/Mocha/Cucumber) store results in the JUnit suite tables and never set a status on their TestRunCases junction rows, so the TestRunCases groupBy behind `testplanit_test_runs_list`, `testplanit_test_runs_get`, and `testplanit_test_runs_update` counted nothing. The rollup for automated runs now counts JUnitTestResult rows by status — attempt semantics (retries count once per imported row), matching the web UI's run summary — while REGULAR runs keep the TestRunCases rollup. The list tool stays batched: one suite lookup plus one groupBy per page, never per-row calls.

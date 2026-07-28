---
"@testplanit/mcp-server": minor
---

Surface automated-run (JUnit/TestNG/xUnit/NUnit/MSTest/Mocha/Cucumber) results through the run results tools. Automated runs store results in the JUnit suite tables rather than TestRunResults, so `testplanit_test_run_results_list` previously returned an empty list for them. The list tool now merges both sources (each row carries a `source` discriminator of "TestRun" or "JUnit") with a compound per-source cursor; bare numeric cursors from older clients are still accepted. `testplanit_test_run_results_get` accepts an optional `source` parameter — pass "JUnit" to fetch an automated result's detail (type, message, stack trace, stdout/stderr, timing, suite, attachments). The `latestResult` field on run case rows (`testplanit_test_runs_get` / `testplanit_test_runs_cases_list`) is now a run-scoped union of the two sources with the same discriminator.

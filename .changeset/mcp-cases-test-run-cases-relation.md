---
"@testplanit/mcp-server": patch
---

`cases_list` and `cases_get` read the renamed `testRunCases` relation

TestPlanIt renamed `RepositoryCases.testRuns` to `testRunCases`: the rows are
TestRunCases join records, but the old name read as a link to TestRuns. The
case tools now send the new name in their includes and in the
`hasNeverExecuted` filter, so they require a server carrying the rename.

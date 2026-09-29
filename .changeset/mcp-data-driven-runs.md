---
"@testplanit/mcp-server": minor
---

Run data-driven (parameterized) cases through the MCP server

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

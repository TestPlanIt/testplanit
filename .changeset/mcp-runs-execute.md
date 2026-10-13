---
"@testplanit/mcp-server": minor
---

Add `runs_execute`, `runs_automation_plan` and `automation_targets_list`

An agent can now list a project's execution targets, ask TestPlanIt to run a
run's automated cases on one of them (optionally a subset of cases or a
different ref), and read the plan a dispatched job executes. `HYBRID` runs —
manual runs that also received automated results — roll up by case like
`REGULAR` runs.

Requires a TestPlanIt host with automated execution (the
`/api/test-runs/{id}/execute`, `/automation-plan` and
`/api/projects/{id}/execution-targets` routes).

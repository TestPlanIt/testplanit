---
sidebar_label: 'Automated Execution'
title: 'Automated Execution'
description: Run a test run's automated cases from TestPlanIt — dispatch to GitHub Actions, GitLab CI or a signed webhook, let the job pull its plan, and collect the results back into the same run
---

# Automated Execution

TestPlanIt can start the CI job that runs a test run's automated cases and collect the results back into that run. It does not run tests itself: an **execution target** names a GitHub Actions workflow, a GitLab CI pipeline, or a signed webhook for any other system, and TestPlanIt starts it with the run id. The job reads the **plan** of cases to execute, runs them with whatever framework it uses, and reports results with a [reporter](../sdk/index.md) or the [CLI](../cli.md) pinned to the run.

## How it works

1. A project administrator adds one or more execution targets under **Project Settings → Automated Execution** (see [Automated Execution settings](projects/settings/automation.md)).
2. On a test run, **Execute automated cases** asks TestPlanIt to run the run's automated cases on a target. A single automated case can also be executed from its case page or from the repository list's row menu (**Execute automated test**), which creates a run holding just that case. That run completes itself once the job finishes and its results are in; if the dispatch fails, times out or is cancelled, the run stays open so the execution can be retried.
3. TestPlanIt records an **execution** for the run, promotes a manual run to a [hybrid run](projects/run-details.md#hybrid-test-runs), and starts the job with these parameters:

   | Parameter | Value |
   | --- | --- |
   | `TESTPLANIT_RUN_ID` | The run the results must attach to |
   | `TESTPLANIT_EXECUTION_ID` | The execution record TestPlanIt is tracking |
   | `TESTPLANIT_PROJECT_ID` | The project |
   | `TESTPLANIT_URL` | The TestPlanIt base URL |
   | `TESTPLANIT_PLAN_URL` | Where the job fetches the plan |

   Any static inputs configured on the target are sent as well. None of these values is secret; the job authenticates to TestPlanIt with its own API token, stored in the CI system's secret store.
4. The job fetches the plan, runs the matching tests, and reports results into the run. The reporters and the CLI treat a run named by `TESTPLANIT_RUN_ID` as externally managed: they attach results and never create or complete a run of their own.
5. The run page shows the execution's status. GitHub Actions and GitLab CI jobs are polled for their state; a generic webhook target is finished either by results arriving and the run being completed, or explicitly with `testplanit run finish`.

## The plan

`GET /api/test-runs/{runId}/automation-plan` (or `testplanit run plan`) returns the run's automated cases:

```json
{
  "runId": 42,
  "projectId": 9,
  "executionId": 17,
  "ref": "main",
  "run": { "name": "Sprint 12 regression", "testRunType": "HYBRID", "configuration": "Chrome", "milestone": "R12" },
  "cases": [
    {
      "id": 123,
      "title": "Login works",
      "className": "tests.auth.LoginTest",
      "source": "JUNIT",
      "automated": true,
      "selector": {
        "name": "Login works",
        "className": "tests.auth.LoginTest",
        "fullName": "tests.auth.LoginTest.Login works",
        "idTokens": { "brackets": "[123]", "c": "C123", "tc": "TC123" }
      },
      "tags": ["smoke"]
    }
  ],
  "totals": { "cases": 1 }
}
```

Only cases marked **Automated** in the repository are listed. An ad-hoc execution (a single case, or a subset chosen through the API) lists only the requested cases when `executionId` is passed.

The plan carries every identifier a runner filter can match on, and nothing framework-specific. Turning selectors into a `--grep`, `-k`, `--tests` or `--filter` expression is the job of a small script in your repository, which knows your framework; the examples below show two.

## Setting up a GitHub Actions target

1. Register the repository under **Administration → Code Repositories** with a token that can start workflows (classic token with the `workflow` scope, or a fine-grained token with *Actions: read and write*). A target can also carry its own token.
2. Give the workflow a `workflow_dispatch` trigger that **declares** the inputs TestPlanIt sends. GitHub refuses a dispatch with undeclared inputs.
3. Add the target under **Project Settings → Automated Execution**, choose the workflow and the default branch, and use **Verify** to confirm the token, the trigger and the declared inputs.

```yaml
name: Automated tests
on:
  workflow_dispatch:
    inputs:
      TESTPLANIT_RUN_ID:
        description: Set by TestPlanIt
        required: false
      TESTPLANIT_EXECUTION_ID:
        description: Set by TestPlanIt
        required: false
      TESTPLANIT_PROJECT_ID:
        description: Set by TestPlanIt
        required: false
      TESTPLANIT_URL:
        description: Set by TestPlanIt
        required: false
      TESTPLANIT_PLAN_URL:
        description: Set by TestPlanIt
        required: false

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      TESTPLANIT_URL: ${{ inputs.TESTPLANIT_URL }}
      TESTPLANIT_RUN_ID: ${{ inputs.TESTPLANIT_RUN_ID }}
      TESTPLANIT_EXECUTION_ID: ${{ inputs.TESTPLANIT_EXECUTION_ID }}
      TESTPLANIT_TOKEN: ${{ secrets.TESTPLANIT_TOKEN }}
      TESTPLANIT_API_TOKEN: ${{ secrets.TESTPLANIT_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - name: Read the plan
        run: npx @testplanit/cli run plan --format lines --selector-field fullName > plan.txt
      - name: Run the selected tests
        run: ./scripts/run-testplanit-plan.sh plan.txt
      - name: Complete the run
        if: always()
        run: npx @testplanit/cli run complete
```

The reporter step is not shown because the [Playwright](../sdk/playwright-overview.md) and [WebdriverIO](../sdk/wdio-overview.md) reporters pick up `TESTPLANIT_RUN_ID` on their own. A framework without a reporter uploads its JUnit-family report with `testplanit import ./results.xml -p <project>`; `-r` defaults to `TESTPLANIT_RUN_ID`.

## Setting up a GitLab CI target

Register the repository with a token that has the `api` scope, or give the target a **pipeline trigger token**. A trigger token can start pipelines but cannot read their status, so the run page shows the execution as dispatched until results arrive or the job calls `testplanit run finish`. TestPlanIt sends the parameters as pipeline variables.

```yaml
automated-tests:
  rules:
    - if: $TESTPLANIT_RUN_ID
  variables:
    TESTPLANIT_API_TOKEN: $TESTPLANIT_TOKEN
  script:
    - npx @testplanit/cli run plan --format lines --selector-field fullName > plan.txt
    - ./scripts/run-testplanit-plan.sh plan.txt
  after_script:
    - npx @testplanit/cli run complete
```

Store `TESTPLANIT_TOKEN` as a masked CI/CD variable. Variables passed at trigger time are visible to anyone who can read the pipeline, which is why TestPlanIt never sends a token.

## Setting up a generic webhook target

For Jenkins, Buildkite, CircleCI, a home-grown runner, or anything else, a generic target POSTs a signed JSON payload to the URL you configure:

```json
{
  "event": "test_run.execute",
  "executionId": 17,
  "runId": 42,
  "projectId": 9,
  "ref": "main",
  "planUrl": "https://testplanit.example.com/api/test-runs/42/automation-plan?executionId=17",
  "appUrl": "https://testplanit.example.com",
  "inputs": { "TESTPLANIT_RUN_ID": "42", "TESTPLANIT_EXECUTION_ID": "17", "ENV": "staging" },
  "requestedAt": "2026-09-10T10:00:00.000Z"
}
```

The request carries `X-TestPlanIt-Event: test_run.execute` and `X-TestPlanIt-Signature: t=<unix seconds>,v1=<hex>`, where `v1` is HMAC-SHA256 over `<t>.<body>` with the target's signing secret, the same scheme as [outbound webhooks](webhooks.md). The secret is generated when the target is saved and shown once. A `2xx` response means the request was accepted; a JSON body with `externalRunId` and `externalUrl` lets the run page link to the job. Because TestPlanIt cannot ask a generic receiver for status, finish the execution from the job:

```bash
testplanit run finish --conclusion success   # or failure / cancelled
```

## Turning the plan into a runner filter

Two example shims. Each reads the selectors written by `testplanit run plan --format lines` and hands them to the runner in the form it expects.

Playwright, matching test titles with `--grep`:

```bash
#!/usr/bin/env bash
# scripts/run-testplanit-plan.sh <plan.txt>
set -euo pipefail
pattern=$(sed 's/[][\\.*^$+?(){}|]/\\&/g' "$1" | paste -sd'|' -)
npx playwright test --grep "$pattern"
```

pytest, matching node ids by class and function name with `-k`:

```bash
#!/usr/bin/env bash
set -euo pipefail
expr=$(sed 's/.*\.\([A-Za-z0-9_]*\)$/\1/' "$1" | paste -sd' or ' -)
python -m pytest -k "$expr" --junitxml=results.xml
testplanit import results.xml -p "$TESTPLANIT_PROJECT_ID"
```

The reporters match results back to cases by an id token in the test name (`[123]`, `C123`, `TC123`), by a `test_id` property, or by class name and name — see [Linking results to existing cases](../cli.md#linking-results-to-existing-cases-by-id). Naming tests with the id token is the most robust choice, since the plan's `idTokens` give the exact strings to use.

## Execution states

| State | Meaning |
| --- | --- |
| Pending | Recorded; the dispatch worker has not started the job yet |
| Dispatched | The provider accepted the request |
| Running | The provider reports the job running, or results started arriving |
| Job succeeded | The CI job finished successfully, the run was completed, or `run finish --conclusion success` was called |
| Job failed | The CI job ran and ended in failure (failing tests included), or `run finish --conclusion failure` was called |
| Could not start | TestPlanIt could not start the job: the provider refused the request, or the dispatch never ran (the error is shown on the run page) |
| Timed out | No completion within the target's timeout (default 2 hours) |
| Cancelled | Cancelled from the run page or by the provider |

A run has at most one execution in flight. **Cancel** on the run page marks it cancelled and asks the provider to stop the job when it can; **Retry** after a failure opens the dialog with the same target. The history sheet lists every execution of the run.

Two [outbound webhook](webhooks.md) events accompany the lifecycle: `test_run.execution_requested` and `test_run.execution_completed`.

## Troubleshooting

- **Could not start: 422 from GitHub.** The workflow does not declare one of the inputs, or has no `workflow_dispatch` trigger. **Verify** on the target lists the declared inputs.
- **Could not start: 403 / 401.** The token cannot start workflows or pipelines. GitHub needs the `workflow` scope (classic) or *Actions: read and write* (fine-grained); GitLab needs the `api` scope or a trigger token.
- **Results landed in a new run instead of this one.** The job did not forward `TESTPLANIT_RUN_ID` into the reporter's environment. Map the workflow input to an environment variable as in the examples.
- **Execution stays "Pending".** The request was recorded but the execution-dispatch worker has not picked it up. Check that the workers are running; after ten minutes the execution is marked *Could not start* so it can be retried.
- **Execution stays "Dispatched" on a generic target.** TestPlanIt cannot poll it; call `testplanit run finish` from the job, or complete the run.
- **Cases were not added to the run.** The run's [composition is locked](projects/run-details.md#composition-lock). Results for cases outside the run are still recorded and reported by the import.

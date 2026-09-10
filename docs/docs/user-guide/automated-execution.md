---
sidebar_label: 'Overview'
title: 'Automated Execution'
description: Execute a test run's automated cases from TestPlanIt — dispatch to GitHub Actions, GitLab CI, Jenkins or any CI behind a signed webhook, let the job pull its plan, and collect the results back into the same run
---

# Automated Execution

TestPlanIt can start the CI job that runs a test run's automated cases and collect the results back into that run. TestPlanIt does not run tests itself. An **execution target** names a GitHub Actions workflow, a GitLab CI pipeline, or a webhook for any other system (Jenkins, Buildkite, CircleCI, a home-grown runner), and TestPlanIt starts it with the run id. The job reads the **plan** of cases to execute, runs them with whatever framework it uses, and reports results with a [reporter](../sdk/index.md) or the [CLI](../cli.md) pinned to that run.

Setting this up touches three systems, so the guides below are step by step. Pick the one for your CI:

| Your CI | Guide |
| --- | --- |
| GitHub Actions (github.com or GitHub Enterprise Server) | [GitHub Actions setup](automated-execution/github-actions.md) |
| GitLab CI (gitlab.com or self-hosted) | [GitLab CI setup](automated-execution/gitlab-ci.md) |
| Jenkins | [Jenkins setup](automated-execution/jenkins.md) |
| Anything else | [Generic webhook setup](automated-execution/generic-webhook.md) |

Then, for every CI, [Reporting results back](automated-execution/reporting-results.md) covers the job's side: reading the plan, filtering the test suite, and getting results into the run. [Troubleshooting](automated-execution/troubleshooting.md) lists what each symptom means.

## What you need before you start

- **Automated cases.** Only cases whose **Automated** switch is on (see [Adding a test case](projects/repository-add-case.md)) are dispatched. A run with no automated cases cannot be executed.
- **A way to match results to cases.** The reporters and the CLI match a result to a case by an id token in the test name (`[123]`, `C123`, `TC123`), by a `test_id` property, or by class name and name. Naming tests with the case id is the most reliable choice, and the plan tells the job the exact token to use.
- **A TestPlanIt API token for the job**, created from the [User Profile](../api-tokens.md#creating-api-tokens) of the user the job should act as. It needs write access to the project's test runs. The token lives in your CI system's secret store; TestPlanIt never sends it.
- **For GitHub and GitLab, a registered code repository** under **Administration → Code Repositories** with a token that can start jobs (see the provider guide for the scopes).
- **Project administrator rights** to add targets under **Project Settings → Automated Execution**, and add/edit rights on test runs to execute one.

## How it works

1. A project administrator adds one or more execution targets under **Project Settings → Automated Execution** ([settings reference](projects/settings/automation.md)) and uses **Verify** on each.
2. On a test run, **Execute automated cases** (in the case list header, next to **Start manual testing**) asks TestPlanIt to run the run's automated cases on a target. A single automated case can also be executed from its case page or from the repository list's row menu (**Execute automated test**), which creates a run holding just that case; that run completes itself once the job finishes and its results are in.
3. TestPlanIt records an **execution** for the run, promotes a manual run to a [hybrid run](projects/run-details.md#hybrid-test-runs), and starts the job with these parameters:

   | Parameter | Value |
   | --- | --- |
   | `TESTPLANIT_RUN_ID` | The run the results must attach to |
   | `TESTPLANIT_EXECUTION_ID` | The execution record TestPlanIt is tracking |
   | `TESTPLANIT_PROJECT_ID` | The project |
   | `TESTPLANIT_URL` | The TestPlanIt base URL |
   | `TESTPLANIT_PLAN_URL` | Where the job fetches the plan |

   Any static inputs configured on the target are sent as well. None of these values is secret; the job authenticates to TestPlanIt with its own API token.
4. The job fetches the plan, runs the matching tests, and reports results into the run. The reporters and the CLI treat a run named by `TESTPLANIT_RUN_ID` as externally managed: they attach results and never create or complete a run of their own.
5. The run page shows the execution's status. GitHub Actions and GitLab CI jobs are polled for their state; a generic webhook target (Jenkins included) is finished by the job itself with `testplanit run finish`, or when the run is completed.

Manual cases in the same run are untouched. A person records them with **Start manual testing** as before, and a manual result recorded on an automated case after the job ran replaces the projected status while both results stay in the case's history.

## The plan

`GET /api/test-runs/{runId}/automation-plan` (or `testplanit run plan`) returns the run's automated cases. The job authenticates with its API token.

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

Only cases marked **Automated** are listed. When `executionId` is passed (the CLI does this from `TESTPLANIT_EXECUTION_ID`), an ad-hoc execution lists only the requested cases. The plan carries every identifier a runner filter can match on and nothing framework-specific; turning selectors into a `--grep`, `-k`, `--tests` or `--filter` expression is the job of a small script in your repository. See [Reporting results back](automated-execution/reporting-results.md#turning-the-plan-into-a-runner-filter).

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

A run has at most one execution in flight. On the run page the execution chip shows the current state, who requested it, and a link to the job when the provider gives one; hovering it shows when TestPlanIt gives up waiting. **Cancel** marks the execution cancelled and asks the provider to stop the job when it can; **Retry** after a failure opens the dialog with the same target and branch; **Execution history** lists every execution of the run and stays available after the run is completed.

Two [outbound webhook](webhooks.md) events accompany the lifecycle: `test_run.execution_requested` and `test_run.execution_completed`. Every request, dispatch and completion is also written to the [audit log](audit-logs.md).

## Security notes

- Dispatch parameters and static inputs are visible to anyone who can read the repository or pipeline. Never put a token in them.
- Credentials stored on a target are encrypted at rest and are used only by the dispatch worker.
- TestPlanIt refuses to send a dispatch to a private or internal address unless the operator lists the host in `ALLOWED_PRIVATE_HOSTS`. This matters for a Jenkins or webhook receiver on an internal network; see [Generic webhook setup](automated-execution/generic-webhook.md#private-addresses).

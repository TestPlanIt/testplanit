---
sidebar_label: 'Troubleshooting'
title: 'Automated Execution troubleshooting'
description: What each execution symptom means and how to fix it — dispatch refused, stuck states, results landing in the wrong run, cases not matched
---

# Troubleshooting

Start from what the run page shows. The execution chip's tooltip and the **Execution history** sheet carry the provider's status text and the error message TestPlanIt recorded.

## Verify fails or warns on the target

| Message | Cause | Fix |
| --- | --- | --- |
| The workflow has no `workflow_dispatch` trigger | The GitHub workflow cannot be started through the API | Add `on: workflow_dispatch:` with the five `TESTPLANIT_*` inputs |
| The workflow does not declare these inputs … | GitHub rejects undeclared inputs at dispatch time | Declare every listed input under `workflow_dispatch.inputs`, including static workflow inputs configured on the target |
| The token does not carry the `workflow` scope | Classic GitHub token without `workflow` | Recreate it with `workflow`, or use a fine-grained token with *Actions: Read and write* |
| The workflow is disabled, not active | Disabled in the repository's Actions tab | Enable it |
| Only a trigger token is configured … | GitLab trigger token without an access token | Expected; the job must call `run finish`. Add an access token with `api` if you want live status |
| No credential is available for this repository | The registered repository has no stored token and the target has no override | Edit the repository or give the target its own credential |
| The webhook URL points at a private or internal address | The receiver is on a private network | Have the operator add the host to `ALLOWED_PRIVATE_HOSTS` and restart |

## The execution shows *Could not start*

The error text on the chip says which:

- **422 from GitHub.** An undeclared input or a missing `workflow_dispatch` trigger. Run **Verify** on the target; it lists what the workflow declares.
- **403 or 401.** The token cannot start jobs. GitHub needs `workflow` (classic) or *Actions: Read and write* (fine-grained); GitLab needs `api` or a trigger token. A 401 can also mean the token was revoked.
- **404.** The workflow file does not exist on the branch being dispatched, or the repository path is wrong. Commit the workflow to that branch, or change the target's branch.
- **Request blocked: "host" is a private or internal address.** See [Private addresses](generic-webhook.md#private-addresses).
- **The provider redirected the request.** The target URL answers with a redirect, which TestPlanIt does not follow. Use the final URL (usually the `https://` one).
- **The dispatch job did not run within 10 minutes.** The execution sat in *Pending* because no worker picked it up. Check that the `execution-dispatch` worker is running ([background processes](../../background-processes.md)); then **Retry**.
- **The webhook endpoint rejected the request (HTTP 4xx/5xx).** A generic receiver answered with a non-2xx. Check its logs; a Jenkins trigger with a wrong token answers 404 or 403.

## The execution stays *Pending*

The request was recorded but the dispatch worker has not processed it. The workers are not running, or cannot reach Valkey. After ten minutes the execution flips to *Could not start* so the run is not blocked; fix the workers and **Retry**.

## The execution stays *Dispatched*

- **Generic webhook or Jenkins target.** Expected until the job reports. If results arrive the execution moves to *Running*; it ends when the job calls `run finish` or the run is completed. If the job never calls `run finish` (it crashed before its final step, or on Jenkins the trigger was not yet registered), cancel the execution from the chip and fix the job.
- **GitHub target with only the workflow page linked.** TestPlanIt could not match a single workflow run to the dispatch, usually because another `workflow_dispatch` run of the same workflow started on that branch within the same couple of minutes. The execution ends when results arrive and the run is completed, or with `run finish`; avoid dispatching the same workflow by hand at the same time.
- **GitLab target with a trigger token.** Status cannot be read; the job must call `run finish`.

## The job starts but fails immediately

Read the job's log. The usual first-step failures:

- **`Invalid token format`, 401 or "Unauthorized" from the CLI.** `TESTPLANIT_TOKEN` is empty, still a placeholder, or was created on a different TestPlanIt instance than `TESTPLANIT_URL` points at. Create the token on the instance the job talks to and update the CI secret; on Jenkins, re-check the credential id.
- **`unknown command 'run'`.** The `testplanit` command on the job's path belongs to the `@testplanit/api` package (installed with the reporters), not the CLI. Call the CLI as `npx @testplanit/cli …`, as the examples do.
- **The plan is empty.** The run's cases are not marked **Automated**, or the execution's subset was removed from the run.
- **`Not started by TestPlanIt` / empty `TESTPLANIT_RUN_ID`.** The job was started by hand or by another trigger; the dispatch inputs were not mapped into the environment (GitHub), or the webhook trigger's JSONPath variables are missing (Jenkins).

## Results landed in a new run instead of this one

The reporter or the import ran without `TESTPLANIT_RUN_ID` in its environment and created a run of its own. On GitHub, map the input in the job's `env:`; on Jenkins, check the trigger variable is named exactly `TESTPLANIT_RUN_ID`; in a reporter configuration, do not set `testRunId` to a hard-coded value.

## Results arrived but some cases did not change

- **The test name carries no id the reporter could read.** Add the case's id token to the test name (`[123]` by default for the Playwright reporter), or set `caseIdPattern` to match your naming. The plan's `selector.idTokens` lists the exact strings.
- **The result matched a different case.** Two cases share a name; use id tokens.
- **The run's composition is locked.** Results for cases outside the run are kept under Automated Results but the cases are not added to the list. Unlock the run and dispatch again, or add the cases first.
- **A manual result was recorded after the job ran.** The manual result wins on the case row; both are in the case history.

## The execution says *Job failed* but the tests passed

The CI job exited non-zero for another reason: a later step failed, the runner could not upload artifacts, or the reporter failed to post. The per-case results in the run are authoritative; open the job log for the failing step. On Jenkins, `run finish --conclusion` follows the build result, so a failing post-test step also reports *Job failed*.

## The execution says *Timed out*

No terminal state was reported within the target's **Timeout** (default 120 minutes from dispatch). Raise the timeout on the target for long suites, or make sure generic-webhook jobs call `run finish`.

## Execute automated cases is missing or disabled

- **Missing.** The project has no enabled execution target, or you cannot add or edit test runs in this project, or the run is completed.
- **Disabled with "no automated cases".** None of the run's cases has the **Automated** switch on.
- **Disabled with "an execution is already in progress".** Cancel the in-flight execution from the chip first.

## Where to look on the server

The `execution-dispatch` worker logs every dispatch and poll; the [audit log](../audit-logs.md) records `EXECUTION_REQUESTED`, `EXECUTION_DISPATCHED`, `EXECUTION_COMPLETED` and `EXECUTION_CANCELLED` with the execution id and the provider's response. See [Background processes](../../background-processes.md) and [Queues](../queues.md).

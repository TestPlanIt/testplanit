---
sidebar_label: 'GitHub Actions'
title: 'Automated Execution with GitHub Actions'
description: Step-by-step setup for dispatching a test run's automated cases to a GitHub Actions workflow and collecting the results back into the run
---

# GitHub Actions setup

This guide takes a repository with an automated test suite and connects it to TestPlanIt so that **Execute automated cases** on a test run starts a workflow, the workflow runs exactly the planned cases, and the results land back in that run. Budget about half an hour the first time.

You will create or touch:

| Where | What |
| --- | --- |
| GitHub | A personal access token that can start workflows; a repository secret holding a TestPlanIt API token; a workflow with a `workflow_dispatch` trigger |
| TestPlanIt, Administration | A registered code repository |
| TestPlanIt, your project | An execution target |
| Your repository | A small script that turns the plan into your test runner's filter, and reporter configuration |

## 1. Create a GitHub token that can start workflows

TestPlanIt starts the workflow through the GitHub API with a token you provide. Either kind works:

- **Fine-grained token** (recommended). Under *Settings → Developer settings → Personal access tokens → Fine-grained tokens*, limit **Repository access** to the repositories that hold your tests, and grant these **Repository permissions**:

  | Permission | Access | Used for |
  | --- | --- | --- |
  | Actions | Read and write | Starting the workflow and reading its status |
  | Contents | Read-only | Listing workflows and checking the trigger during **Verify** |
  | Metadata | Read-only | Added automatically |

- **Classic token** with the `repo` and `workflow` scopes. Without `workflow`, GitHub refuses the dispatch with a 403, and **Verify** warns about the missing scope.

For GitHub Enterprise Server, create the token on your server and note its API base URL (usually `https://github.example.com/api/v3`).

## 2. Register the repository in TestPlanIt

1. Open **Administration → Code Repositories** (under **Tools & Integrations**) and click **Add Repository**.
2. Choose **GitHub**, enter a name, the **Owner** and **Repository**, and paste the token from step 1. For Enterprise Server, fill in the **API Base URL**.
3. Click **Test Connection**, then save.

A repository registered earlier for QuickScript or Impact Analysis can be reused, provided its token has the permissions above. If it does not, either replace the token here or give the execution target its own token in step 5.

## 3. Create a TestPlanIt API token and store it in GitHub

The workflow needs to read the plan and write results, so it authenticates to TestPlanIt with an API token of its own.

1. In TestPlanIt, open your **User Profile → API Tokens** and create a token. It is shown once and starts with `tpi_`. Results will be attributed to this user, so a dedicated service user is a reasonable choice.
2. In the GitHub repository, open *Settings → Secrets and variables → Actions* and add a repository secret named `TESTPLANIT_TOKEN` with that value.

:::caution
Create the token on the TestPlanIt instance the workflow will talk to. A token from another instance (staging versus production, for example) fails with an authentication error at the first step of the job.
:::

## 4. Add the workflow

TestPlanIt sends five inputs with every dispatch. GitHub rejects a `workflow_dispatch` that carries an input the workflow does not declare, so **declare all five**, even the ones you do not use. The example below reads the plan with the TestPlanIt CLI, generates a filter, runs Playwright, and lets the Playwright reporter attach the results. Adapt the two commented steps to your framework; [Reporting results back](reporting-results.md) has recipes for other runners.

```yaml
# .github/workflows/automated-tests.yml
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
      # The five inputs become environment variables the CLI and the reporters read.
      TESTPLANIT_URL: ${{ inputs.TESTPLANIT_URL }}
      TESTPLANIT_RUN_ID: ${{ inputs.TESTPLANIT_RUN_ID }}
      TESTPLANIT_EXECUTION_ID: ${{ inputs.TESTPLANIT_EXECUTION_ID }}
      TESTPLANIT_PROJECT_ID: ${{ inputs.TESTPLANIT_PROJECT_ID }}
      # The CLI reads TESTPLANIT_TOKEN; the reporters read TESTPLANIT_API_TOKEN.
      TESTPLANIT_TOKEN: ${{ secrets.TESTPLANIT_TOKEN }}
      TESTPLANIT_API_TOKEN: ${{ secrets.TESTPLANIT_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci

      - name: Read the plan
        run: npx @testplanit/cli run plan --format lines --selector-field title > plan.txt

      # Adapt: turn plan.txt into your runner's filter and run the tests.
      - name: Run the planned tests
        run: ./scripts/run-testplanit-plan.sh plan.txt
```

Two details that matter:

- **The run id must reach the reporter.** The `env:` block does that for every step. If a reporter runs without `TESTPLANIT_RUN_ID`, it creates a run of its own and the results never reach the run you executed.
- **Do not complete the run from the workflow** unless the run holds nothing but automated cases. Completing a run also closes its manual cases. TestPlanIt polls the workflow for its outcome, so the execution finishes on its own; the run stays open for the manual work and is completed by a person.

Commit the workflow to the branch TestPlanIt will dispatch on. GitHub only accepts a `workflow_dispatch` for a workflow file that exists on that branch.

## 5. Add the execution target

1. Open the project's **Settings → Automated Execution** and click **Add target**.
2. Choose **GitHub Actions**, pick the repository from step 2, and choose the workflow file. If the list cannot be loaded, type the file name (`automated-tests.yml`).
3. Leave **Branch** empty to dispatch on the repository's default branch, or name the branch that carries the workflow. The dialog on the run page lets a user pick a different ref for one execution.
4. Optionally add **Workflow inputs**, static values sent with every dispatch (an environment name, for example). Each one must also be declared under `workflow_dispatch.inputs`, and none of them may be secret.
5. If the repository's stored token cannot start workflows, open **Credentials**, choose **Use a different credential for dispatch**, and paste a token that can.
6. Set the **Timeout** if two hours is wrong for your suite, then save.
7. Click **Verify**. A successful check reports **Target verified** and lists the declared inputs. Fix anything it flags before continuing:

   | Verify says | What to do |
   | --- | --- |
   | The workflow has no `workflow_dispatch` trigger | Add the `on: workflow_dispatch:` block |
   | The workflow does not declare these inputs | Declare the listed inputs |
   | The token does not carry the `workflow` scope | Recreate the classic token with `workflow`, or switch to a fine-grained token with Actions read and write |
   | The workflow is disabled, not active | Enable it in the repository's Actions tab |

## 6. Execute a run

1. Open a test run that holds automated cases (the case list shows a robot icon on each). Runs may mix manual and automated cases.
2. Click **Execute automated cases**, pick the target, and confirm the branch. The dialog states how many automated cases will be requested.
3. Watch the execution chip in the run header:
   - **Dispatched** within a few seconds. The link opens the workflow page; once TestPlanIt has matched the workflow run, it opens that run directly.
   - **Running** when GitHub reports the job running, or as soon as the first results arrive.
   - **Job succeeded** or **Job failed** when the workflow finishes. A job that exits non-zero because tests failed shows as *Job failed*; the individual results in the run are what tell you which cases failed.
4. The automated cases in the run now carry the statuses the job reported, and the run's **Automated Results** section lists the suites and attempts.

## Notes

- **Matching the workflow run.** GitHub does not return the run id when it accepts a dispatch. TestPlanIt attaches the execution to the `workflow_dispatch` run created on that branch within a couple of minutes of the dispatch, as long as there is exactly one. Avoid starting the same workflow by hand at the same moment; if two runs appear, the execution keeps the workflow page link and finishes when results arrive and the run is completed, or with `testplanit run finish`.
- **One execution at a time.** A run cannot be executed again while an execution is in flight. Cancel it from the chip if the job is gone.
- **GitHub Enterprise Server** works the same way with the repository's API base URL set.

---
sidebar_label: 'GitLab CI'
title: 'Automated Execution with GitLab CI'
description: Step-by-step setup for dispatching a test run's automated cases to a GitLab CI pipeline and collecting the results back into the run
---

# GitLab CI setup

This guide connects a GitLab project (gitlab.com or self-hosted) so that **Execute automated cases** on a test run starts a pipeline, the pipeline runs the planned cases, and the results land back in the run.

You will create or touch:

| Where | What |
| --- | --- |
| GitLab | A token that can start pipelines; a masked CI/CD variable holding a TestPlanIt API token; a job in `.gitlab-ci.yml` |
| TestPlanIt, Administration | A registered code repository |
| TestPlanIt, your project | An execution target |
| Your repository | A small script that turns the plan into your test runner's filter, and reporter configuration |

## 1. Choose how TestPlanIt authenticates to GitLab

Two options. The access token gives the run page live status; the trigger token is cheaper to scope.

| Option | Create it at | What TestPlanIt can do |
| --- | --- | --- |
| **Access token** with the `api` scope (a project access token with the Developer role, a group token, or a personal token) | *Project → Settings → Access tokens* | Start pipelines **and** read their status, so the execution finishes on its own |
| **Pipeline trigger token** | *Project → Settings → CI/CD → Pipeline trigger tokens* | Start pipelines only. The execution shows *Dispatched*, then *Running* when results arrive, and must be finished by the job with `testplanit run finish` or by completing the run |

You can combine them: register the repository with a read-only token for file access and give the target a trigger token for dispatch.

## 2. Register the repository in TestPlanIt

1. Open **Administration → Code Repositories** (under **Tools & Integrations**) and click **Add Repository**.
2. Choose **GitLab**, enter a name, the **Project ID or Path** (`group/project`), and the access token. For a self-hosted server, fill in the **GitLab URL**.
3. Click **Test Connection**, then save.

## 3. Create a TestPlanIt API token and store it in GitLab

1. In TestPlanIt, open your **User Profile → API Tokens** and create a token. It is shown once and starts with `tpi_`. Results are attributed to this user.
2. In the GitLab project, open *Settings → CI/CD → Variables* and add `TESTPLANIT_TOKEN` with that value. Mark it **Masked**; do not mark it *Protected* unless the branch TestPlanIt dispatches on is protected.

:::caution
Create the token on the TestPlanIt instance the pipeline will talk to. A token from another instance fails with an authentication error at the first step of the job.
:::

## 4. Add the job

TestPlanIt passes its five parameters as **pipeline variables**, plus any static variables configured on the target. The job below runs only when `TESTPLANIT_RUN_ID` is set, so ordinary pushes do not trigger it.

```yaml
# .gitlab-ci.yml
automated-tests:
  image: mcr.microsoft.com/playwright:v1.50.0-noble
  rules:
    - if: $TESTPLANIT_RUN_ID
  variables:
    # The CLI reads TESTPLANIT_TOKEN; the reporters read TESTPLANIT_API_TOKEN.
    TESTPLANIT_API_TOKEN: $TESTPLANIT_TOKEN
  script:
    - npm ci
    - npx @testplanit/cli run plan --format lines --selector-field title > plan.txt
    # Adapt: turn plan.txt into your runner's filter and run the tests.
    - ./scripts/run-testplanit-plan.sh plan.txt
```

`TESTPLANIT_URL`, `TESTPLANIT_RUN_ID`, `TESTPLANIT_EXECUTION_ID` and `TESTPLANIT_PROJECT_ID` arrive as variables and are already in the job's environment; nothing needs mapping.

With a **trigger token** (no status polling), add a final step that reports the outcome:

```yaml
  after_script:
    - |
      if [ "$CI_JOB_STATUS" = "success" ]; then
        npx @testplanit/cli run finish --conclusion success
      else
        npx @testplanit/cli run finish --conclusion failure
      fi
```

Do not call `run complete` unless the run holds nothing but automated cases; completing a run also closes its manual cases.

## 5. Add the execution target

1. Open the project's **Settings → Automated Execution** and click **Add target**.
2. Choose **GitLab CI**, pick the repository, and set the **Branch** the pipeline should run on (the repository's default branch if left empty).
3. Optionally add **Pipeline variables**, static values sent with every dispatch. They are visible to anyone who can read the pipeline.
4. Under **Credentials**, either rely on the repository's access token, or choose **Use a different credential for dispatch** and enter an access token, a pipeline trigger token, or both.
5. Save, then click **Verify**. It confirms the credential and the project, and warns when only a trigger token is present, since pipeline status cannot be read then.

## 6. Execute a run

1. Open a test run with automated cases and click **Execute automated cases**; pick the target and confirm the branch.
2. The execution chip shows **Dispatched** with a link to the pipeline, **Running** while it runs, and **Job succeeded** or **Job failed** when GitLab reports the pipeline finished (or when the job calls `run finish`, for trigger tokens). A pipeline that fails because tests failed shows as *Job failed*; the per-case results in the run are the detail.

## Notes

- **Variables at trigger time are not secret.** They show in the pipeline's details, which is why TestPlanIt sends the run id and URLs but never a token.
- **Protected branches.** A pipeline trigger token or access token can only start pipelines on branches the token's owner may run pipelines on.
- **Self-hosted GitLab on a private address.** TestPlanIt refuses to call private or internal addresses unless the operator lists the host in `ALLOWED_PRIVATE_HOSTS`; see [Generic webhook setup](generic-webhook.md#private-addresses).

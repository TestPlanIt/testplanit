---
sidebar_label: 'Jenkins'
title: 'Automated Execution with Jenkins'
description: Step-by-step setup for dispatching a test run's automated cases to a Jenkins pipeline through the Generic Webhook Trigger plugin, and reporting the outcome back
---

# Jenkins setup

Jenkins receives dispatches through a **generic webhook** execution target and the **Generic Webhook Trigger** plugin, which turns fields of the JSON payload TestPlanIt sends into build variables. Because Jenkins cannot be polled by TestPlanIt, the pipeline reports its own outcome at the end with `testplanit run finish`.

You will create or touch:

| Where | What |
| --- | --- |
| Jenkins | The Generic Webhook Trigger plugin; a secret-text credential holding a TestPlanIt API token; a pipeline job with the trigger configured |
| TestPlanIt, your project | A generic webhook execution target |
| Your repository | A `Jenkinsfile`, a small script that turns the plan into your test runner's filter, and reporter configuration |

## 1. Install the plugin and store the TestPlanIt token

1. Install **Generic Webhook Trigger** from *Manage Jenkins → Plugins*.
2. In TestPlanIt, open your **User Profile → API Tokens** and create a token (shown once, starts with `tpi_`). Results are attributed to this user.
3. In Jenkins, add a **Secret text** credential with id `testplanit-token` holding that value (*Manage Jenkins → Credentials*).

:::caution
Create the token on the TestPlanIt instance Jenkins will talk to. A token from another instance fails with "Invalid token format" or an authentication error at the first CLI step.
:::

## 2. Configure the trigger on the job

TestPlanIt POSTs a JSON body like this to the target URL:

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

The plugin lifts fields out of it with JSONPath expressions. In a declarative `Jenkinsfile`:

```groovy
pipeline {
  agent any
  triggers {
    GenericTrigger(
      genericVariables: [
        [key: 'TESTPLANIT_RUN_ID',       value: '$.runId'],
        [key: 'TESTPLANIT_EXECUTION_ID', value: '$.executionId'],
        [key: 'TESTPLANIT_PROJECT_ID',   value: '$.projectId'],
        [key: 'TESTPLANIT_URL',          value: '$.appUrl'],
        [key: 'TESTPLANIT_PLAN_URL',     value: '$.planUrl'],
        [key: 'TESTPLANIT_REF',          value: '$.ref'],
        // Static inputs configured on the target arrive under "inputs".
        [key: 'TEST_ENV',                value: '$.inputs.ENV', defaultValue: 'staging']
      ],
      token: 'testplanit',
      causeString: 'TestPlanIt execution $TESTPLANIT_EXECUTION_ID for run $TESTPLANIT_RUN_ID',
      printContributedVariables: true,
      printPostContent: false
    )
  }
  // stages: see step 3
}
```

The same trigger can be configured in the job's UI under *Build Triggers → Generic Webhook Trigger*, with one *Post content parameter* per row above.

:::note
Jenkins registers a trigger declared in a `Jenkinsfile` only after the job has run once. Build the job by hand once after adding the `triggers` block; until then, dispatches return **200** but start nothing.
:::

The **token** authenticates the dispatch on the Jenkins side; choose a long random value. Jenkins does not verify TestPlanIt's `X-TestPlanIt-Signature` header, so the token is the only protection on that URL. Keep the endpoint on a network TestPlanIt can reach and others cannot, or put a proxy in front that [verifies the signature](generic-webhook.md#verifying-the-signature).

## 3. Write the pipeline stages

The stages read the plan with the CLI, run the planned tests, and report the outcome. The example uses Node and Playwright; adapt the commented step to your runner ([recipes](reporting-results.md#turning-the-plan-into-a-runner-filter)).

```groovy
  environment {
    // The CLI reads TESTPLANIT_TOKEN; the reporters read TESTPLANIT_API_TOKEN.
    TESTPLANIT_TOKEN = credentials('testplanit-token')
  }
  stages {
    stage('Plan') {
      steps {
        sh 'test -n "$TESTPLANIT_RUN_ID" || { echo "Not started by TestPlanIt"; exit 1; }'
        sh 'npm ci'
        sh 'npx @testplanit/cli run plan --format lines --selector-field title > plan.txt'
      }
    }
    stage('Test') {
      steps {
        // Adapt: turn plan.txt into your runner's filter and run the tests.
        sh 'TESTPLANIT_API_TOKEN="$TESTPLANIT_TOKEN" ./scripts/run-testplanit-plan.sh plan.txt'
      }
    }
  }
  post {
    success { sh 'npx @testplanit/cli run finish --conclusion success' }
    failure { sh 'npx @testplanit/cli run finish --conclusion failure --message "Jenkins build ${BUILD_NUMBER} failed"' }
    aborted { sh 'npx @testplanit/cli run finish --conclusion cancelled' }
  }
}
```

`run finish` reads `TESTPLANIT_URL`, `TESTPLANIT_TOKEN`, `TESTPLANIT_RUN_ID` and `TESTPLANIT_EXECUTION_ID` from the environment. The optional `--message` is shown on the run page for a failed or cancelled execution. Do not call `run complete` unless the run holds nothing but automated cases.

## 4. Add the execution target

1. Open the project's **Settings → Automated Execution** and click **Add target**.
2. Choose **Generic webhook** and enter the **Webhook URL**:

   ```
   https://jenkins.example.com/generic-webhook-trigger/invoke?token=testplanit
   ```

   The `token` query parameter must match the token in the trigger.
3. Optionally add **Variables**, static values sent under `inputs` with every dispatch (`ENV=staging` in the example above).
4. Save. The dialog shows the signing secret once; Jenkins does not use it, so you can close the dialog.
5. Click **Verify**. For a generic target it checks the URL only and reminds you that only a real dispatch proves the receiver works.

If Jenkins is on a private network address, the TestPlanIt operator must list its host in `ALLOWED_PRIVATE_HOSTS`; otherwise the dispatch is refused with *Could not start* and a message naming the blocked host. See [Private addresses](generic-webhook.md#private-addresses).

## 5. Execute a run

1. Open a test run with automated cases and click **Execute automated cases**; pick the Jenkins target.
2. The execution chip shows **Dispatched** with a link to the Jenkins job page, **Running** as soon as the first results arrive, then **Job succeeded** or **Job failed** when the pipeline's `post` step calls `run finish`.
3. If the pipeline never calls `run finish` (it crashed before the `post` section, or the trigger was not yet registered), the execution stays *Dispatched* or *Running* until the target's timeout, and can be cancelled from the chip at any time.

## Notes

- **Where the build number shows.** Jenkins answers the trigger with a queue item, not a build number, so the run page links to the job page rather than a specific build. The `--message` on `run finish` is a good place to name the build.
- **Several jobs on one trigger.** The plugin starts every job whose token matches. Use a distinct token per TestPlanIt target.
- **Freestyle jobs** work too: the contributed variables are available as build parameters, and the same CLI calls go into shell steps, with `run finish` in a post-build step.

---
sidebar_label: 'Automated Execution'
title: 'Automated Execution (Project Settings)'
description: Configure where a project's automated cases can be dispatched — GitHub Actions workflows, GitLab CI pipelines, or signed webhooks
---

# Automated Execution

The project-level **Settings → Automated Execution** page holds the project's **execution targets**: the CI workflows, pipelines or webhooks a test run's automated cases can be sent to. See [Automated Execution](../../automated-execution.md) for how a dispatched job reads its plan and reports back.

:::note
Only system administrators and project administrators can open this page. Repositories are registered globally by a system administrator under **Administration → Code Repositories**; a target picks one of them.
:::

## How to access

1. Open the project.
2. In the project menu, expand **Settings** and choose **Automated Execution**.

## Adding a target

Click **Add target** and choose a **Provider**:

- **GitHub Actions** — pick a registered GitHub repository, then a workflow file. The workflow must have a `workflow_dispatch` trigger that declares the `TESTPLANIT_*` inputs. Choose the branch runs start on (the repository's default branch unless changed).
- **GitLab CI** — pick a registered GitLab repository and the branch. TestPlanIt sends its parameters as pipeline variables.
- **Generic webhook** — enter the URL TestPlanIt should POST to. A signing secret is generated when the target is saved and shown once; the page shows the payload the receiver gets.

Every provider takes:

- **Name** — how the target appears on the run page.
- **Workflow inputs** / **Pipeline variables** — static values sent with every dispatch in addition to the `TESTPLANIT_*` parameters. They are not secret.
- **Timeout** — minutes after which an unfinished execution is marked timed out (default 120).
- **Credentials** — GitHub and GitLab targets use the repository's stored credential unless a different token is entered for dispatch. Starting a job needs the `workflow` scope on GitHub or the `api` scope (or a pipeline trigger token) on GitLab, which a repository registered for reading files may not have.

## Managing targets

- **Enabled** turns a target on or off without deleting it. Disabled targets do not appear on the run page.
- **Verify** checks that the credential works, the workflow exists and declares the expected inputs, and notes anything that would make a dispatch fail. The result is kept on the card.
- **Edit** changes any field. For a generic target, **Generate a new signing secret** rotates the secret and reveals the new one once.
- **Delete** removes the target. Past executions keep their history.

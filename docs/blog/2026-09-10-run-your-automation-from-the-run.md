---
slug: run-your-automation-from-the-run
title: "Run Your Automation From the Run"
description: "TestPlanIt can now start the CI job that runs a test run's automated cases and collect the results back into the same run — GitHub Actions, GitLab CI, or any system behind a signed webhook — without an agent to install and without knowing which test framework you use."
authors: [testplanit]
tags: [automation, ci, feature]
draft: true
---

<!-- Draft. Before publishing: drop `draft: true`, confirm the release version, and add screenshots of the target dialog and the execution chip. -->

A test run used to be where automated results *ended up*. Starting with TestPlanIt 1.1 it is also where they *start*: a run with automated cases gets an **Execute automated cases** button, and a single automated case gets **Execute automated test**.

<!-- truncate -->

## What happens when you click it

TestPlanIt starts the job on an **execution target** the project configured — a GitHub Actions workflow, a GitLab CI pipeline, or a signed webhook for anything else — and hands it two things: the run id, and a URL where the job can fetch the **plan** of cases to execute. The job runs the matching tests and reports back with the reporter or CLI you already use, pinned to that run. Every result updates its case in the run, so a run that mixes manual and automated cases stays one checklist with one status per case.

There is no agent to install and nothing framework-specific inside TestPlanIt. The plan lists each case with the identifiers a runner filter can match on; a short script in your repository turns them into a `--grep`, `-k` or `--tests` expression. Two examples ship with the docs.

## Why this shape

Every product that launches automation from a test management tool either installs an agent on your machines or sends a list of test ids to CI. Agents are a second product to operate. Test-id lists hit CI limits fast — GitHub caps a dispatch at 25 inputs and 65 KB. TestPlanIt sends a pointer instead, the way Allure TestOps and Azure DevOps do, and lets the job pull as many cases as the run holds.

Read the [Automated Execution guide](/docs/user-guide/automated-execution) to set up a target.

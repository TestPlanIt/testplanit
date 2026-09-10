---
sidebar_label: 'Reporting results back'
title: 'Reporting results back to the run'
description: What the dispatched job does — read the plan, run only the planned cases, get results into the run with a reporter or the CLI, and finish the execution
---

# Reporting results back

Whichever CI started it, the dispatched job does the same four things: read the plan, run the planned cases, report results into the run TestPlanIt named, and (for generic targets) report its outcome. This page covers each with recipes for common runners.

## Environment the job needs

| Variable | Read by | Value |
| --- | --- | --- |
| `TESTPLANIT_URL` | CLI, reporters | The TestPlanIt base URL; sent with the dispatch |
| `TESTPLANIT_RUN_ID` | CLI, reporters | The run to attach results to; sent with the dispatch |
| `TESTPLANIT_EXECUTION_ID` | CLI | The execution; sent with the dispatch. Makes `run plan` return only the requested cases and lets `run finish` know what to finish |
| `TESTPLANIT_PROJECT_ID` | CLI import, reporters | The project; sent with the dispatch |
| `TESTPLANIT_TOKEN` | CLI | The job's API token, from the CI secret store |
| `TESTPLANIT_API_TOKEN` | Playwright and WebdriverIO reporters | The same API token |

On GitHub Actions the dispatch values arrive as workflow inputs and must be mapped into `env:`; on GitLab they arrive as pipeline variables; on Jenkins the webhook trigger lifts them from the payload. Both token variables should point at the same secret.

## 1. Read the plan

```bash
npx @testplanit/cli run plan --format lines --selector-field title > plan.txt
```

`run plan` reads the run and execution ids from the environment. `--format lines` writes one selector per line; `--selector-field` picks which one:

| Field | Example line | Use when |
| --- | --- | --- |
| `selector` (default) | `tests.auth.LoginTest.Login works`, or the title when the case has no class name | Most runners |
| `fullName` | `tests.auth.LoginTest.Login works` | Your runner filters on a qualified name |
| `title` | `Login works` | Your runner filters on the test title |
| `className` | `tests.auth.LoginTest` | Your runner filters on classes |
| `id` | `123` | You build the filter yourself |

Pick the field your runner filters on: `title` for the Playwright, WebdriverIO and Jest shims below, `className` or `fullName` for class-based runners. `--format json` writes the full plan, including every id token for each case, for scripts that want to generate their own filter. Cases come from the run's case list in run order. A case's `className` is the class name recorded on it by an earlier import or reporter result; its name is the case title, so a test whose title (or id token) matches the case keeps matching on every dispatch.

A plan with zero cases means the run has no automated cases (the dialog prevents that) or the execution's subset was emptied; exit the job cleanly in that case.

## 2. Run only the planned cases {#turning-the-plan-into-a-runner-filter}

TestPlanIt never generates runner-specific filters. A short script in your repository reads `plan.txt` and calls the runner. Examples:

**Playwright**, by test title with `--grep`:

```bash
#!/usr/bin/env bash
# scripts/run-testplanit-plan.sh <plan.txt>   (plan written with --selector-field title)
set -euo pipefail
pattern=$(sed 's/[][\\.*^$+?(){}|]/\\&/g' "$1" | paste -sd'|' -)
npx playwright test --grep "$pattern"
```

**WebdriverIO**, by spec name pattern through `--mochaOpts.grep` (Mocha) or `--jasmineOpts.grep`:

```bash
pattern=$(sed 's/[][\\.*^$+?(){}|]/\\&/g' "$1" | paste -sd'|' -)
npx wdio run wdio.conf.js --mochaOpts.grep "$pattern"
```

**pytest**, by function name with `-k`:

```bash
expr=$(sed 's/.*\.\([A-Za-z0-9_]*\)$/\1/' "$1" | paste -sd' or ' -)
python -m pytest -k "$expr" --junitxml=results.xml
```

**Jest / Vitest**, by test name with `-t`:

```bash
pattern=$(sed 's/[][\\.*^$+?(){}|]/\\&/g' "$1" | paste -sd'|' -)
npx jest -t "$pattern" --reporters=default --reporters=jest-junit
```

**JUnit with Maven or Gradle**, by class (plan written with `--selector-field className`):

```bash
classes=$(paste -sd',' "$1")
mvn test -Dtest="$classes"          # Maven Surefire
./gradlew test $(sed 's/^/--tests /' "$1" | paste -sd' ' -)   # Gradle
```

**.NET**, by fully qualified name:

```bash
filter=$(sed 's/^/FullyQualifiedName~/' "$1" | paste -sd'|' -)
dotnet test --filter "$filter" --logger "junit;LogFilePath=results.xml"
```

Escape regular-expression characters when the runner takes a pattern (the Playwright and Jest examples do), and keep test names stable: a renamed test no longer matches its plan line until it reports once under the new name.

## 3. Get results into the run

Two paths, both keyed on `TESTPLANIT_RUN_ID`:

**Reporters (Playwright, WebdriverIO).** Configure the reporter from the environment and it attaches every result to the run named by `TESTPLANIT_RUN_ID`, never creating or completing a run of its own:

```ts
// playwright.config.ts
reporter: [
  ["list"],
  ["@testplanit/playwright-reporter", {
    domain: process.env.TESTPLANIT_URL,
    apiToken: process.env.TESTPLANIT_API_TOKEN,
    projectId: Number(process.env.TESTPLANIT_PROJECT_ID),
    // testRunId is read from TESTPLANIT_RUN_ID
  }],
],
```

See the [Playwright](../../sdk/playwright-configuration.md) and [WebdriverIO](../../sdk/wdio-overview.md) reporter references for the remaining options.

**CLI import (any framework that writes JUnit, TestNG, xUnit, NUnit, MSTest, Mocha or Cucumber reports):**

```bash
npx @testplanit/cli import ./results.xml -p "$TESTPLANIT_PROJECT_ID"
```

`-r` defaults to `TESTPLANIT_RUN_ID`, so the import lands in the executed run. Import after the test step even when tests failed (`if: always()` on GitHub, `after_script` on GitLab, `post { always }` on Jenkins).

### Matching results to cases

A result reaches the right case when the reporter or the import can identify it. In order of reliability:

1. **An id token in the test name**: `[123]`, `C123` or `TC123`. The plan's `selector.idTokens` gives the exact strings. The Playwright reporter reads `[123]` by default and accepts a custom `caseIdPattern`; the import matches all three presets.
2. **A `test_id` property** in the JUnit report.
3. **Class name and name** equal to the case's recorded automation name, which is how a case created from an earlier import keeps matching.

A result that matches no case is skipped by the reporters unless `autoCreateTestCases` is on; the CLI import creates a new automated case for it and adds it to the run, unless the run's composition is locked (see below).

### What happens in the run

- Every reported result is stored as an automated attempt under **Automated Results**, and its status is projected onto the case's row in the run's case list. A later result for the same case, automated or manual, replaces the status; the history keeps every attempt.
- A manual run becomes a [hybrid run](../projects/run-details.md#hybrid-test-runs) at the first automated result. Manual cases are unaffected.
- With the run's [composition locked](../projects/run-details.md#composition-lock), results for cases that are not in the run are kept under Automated Results but the cases are not added to the case list. The CLI import reports them in its summary.
- Attachments, steps and durations arrive as they do for any reporter or import.

## 4. Finish the execution

| Target | How the execution ends |
| --- | --- |
| GitHub Actions, GitLab CI with an access token | TestPlanIt polls the job; nothing to do |
| GitLab CI with a trigger token, Jenkins, generic webhook | The job calls `npx @testplanit/cli run finish --conclusion success` (or `failure`, `cancelled`) as its last step |
| Any | Completing the run also ends its execution as *Job succeeded* |

`run finish` accepts `--message "<text>"`, shown on the run page for a failed or cancelled execution.

Reserve `run complete` for runs that contain nothing but automated cases; it completes the whole run, manual cases included. Runs created by **Execute automated test** on a single case complete themselves.

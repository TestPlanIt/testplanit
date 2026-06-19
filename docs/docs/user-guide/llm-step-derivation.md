---
title: Test Step Derivation
---

# Test Step Derivation from Automated Results

When an automated test result creates or matches a repository test case, TestPlanIt can populate that case's **Steps** (each a `step` action and its `expectedResult`) from the structure of the test that produced the result — so an auto-created case carries readable, reviewable steps instead of just a name and a pass/fail status.

There are two paths, and they complement each other:

| Path | When it applies | Setup required |
|------|-----------------|----------------|
| **Deterministic** | The test encodes its structure (Cucumber Gherkin, Playwright `test.step()`, WDIO Cucumber scenarios) | None — always on |
| **AI-derived (opt-in)** | The test has *no* native step structure (e.g. Mocha/Jasmine) | An LLM provider configured for the project |

## Deterministic step derivation

For tests whose structure is unambiguous, steps are derived **deterministically** — no AI, no configuration, identical results every time. This happens automatically when results are imported, and the same mapping is used by the [WDIO reporter](../sdk/wdio-test-cases.md) so a test produces the **same** steps whether it is imported or reported from a run.

- **Cucumber / Gherkin** — `Given` and `When` → steps, `Then` → the **expected result** of the step before it (the preceding `When`); `And` / `But` / `*` inherit the role of the nearest preceding keyword.
- **Playwright** — each `test.step()` title becomes a step; a nested assertion becomes its expected result.

This runs during the normal [Automated Test Results Import](../import-export.md#automated-test-results-import) — no toggle to enable.

## AI-derived steps for low-structure tests

Mocha, Jasmine, and other "flat" frameworks have **no native step structure** — the deterministic path has nothing to map. For these, TestPlanIt uses an LLM to write readable steps:

Wherever possible, the steps are grounded in the **actual commands** the test executed (navigation, element lookups, clicks, keystrokes, assertions), so they reflect what the test *did* rather than a guess. Those commands reach the model two ways:

- **Live, via the WebdriverIO reporter** — it captures each test's command stream during the run and sends it with the case.
- **On import** — many result files embed a command log of their own. A WebdriverIO junit report, for example, records every command in each test's `system-out`, and the importer passes that to the model verbatim.

When a result carries **no** commands — a bare junit with just names, or a plain results import — the model falls back to inferring the most likely steps from the test's descriptive name, so even an `it("should reset a password via email")` case still lands with sensible steps.

This path is **opt-in and best-effort**, so the derived steps are surfaced for review rather than treated as authoritative.

### How to enable it

Configuring an **LLM provider for the project is the opt-in** — there is no separate "use AI" switch. If a provider is configured, low-structure cases are enriched; if none is configured, the feature is completely inert (no jobs, no calls, no effect). It works from **both** entry points: the [Automated Test Results Import](../import-export.md#automated-test-results-import) and the [WebdriverIO reporter](../sdk/wdio-test-cases.md) (for Mocha/Jasmine runs, with `captureSteps` on — the default).

1. Configure an [LLM integration](./llm-integrations.md) and assign it to your project (**Project Settings → AI Models** — see [Project Assignment](./llm-integrations.md#project-assignment)).
2. Import automated results, or run a WebdriverIO suite with the reporter. That's it.

### What happens

1. When a **low-structure** case (no deterministic steps) is created or matched — by an import or by the WDIO reporter at the end of a run — it is collected.
2. A **single background job** is queued (one per import / per run; never run inline, so large suites stay fast).
3. The job asks the configured LLM to derive `step` / `expectedResult` rows from each test's name and output, then writes them to the cases.
4. The person who ran the import / suite receives an **"AI-Derived Test Steps Ready"** notification linking to the test run, prompting them to **review the steps for accuracy**.

:::note Review the results
AI-derived steps are inferred from a test's name and output — they're a strong starting point, not a guarantee. Open the cases from the notification and adjust anything that doesn't match the real test.
:::

## Never overwrites your steps

By default, steps are only ever derived for a case that has **no steps**. Once a case has steps — whether you wrote them, edited them, or they were derived earlier — that case is the source of truth and is left alone. To deliberately re-sync, both the importer and the WDIO reporter expose an opt-in, **destructive** `overwriteSteps` option (off by default) that replaces a case's steps every run — including via the AI path for low-structure cases. A derivation that yields nothing never clears existing steps.

## Prerequisites

- **Deterministic path:** none — works out of the box on import and from the WDIO reporter.
- **AI-derived path:** at least one active [LLM integration](./llm-integrations.md) configured for the project (or a system-default provider). The project's background workers must be running to process the derivation job.

## Troubleshooting

**A low-structure case has no steps after an import or a WebdriverIO run.**

- Confirm an LLM provider is configured for the project ([AI Models](./llm-integrations.md#project-assignment)) — without one, the AI path is intentionally inert.
- For the WDIO reporter, make sure `captureSteps` is on (the default).
- The job runs in the background; give it a moment and watch for the "AI-Derived Test Steps Ready" notification.
- If the case already had steps (manual or previously derived), it is left untouched by design — use `overwriteSteps` to force a re-derive.

**A structured (Cucumber/Playwright) case has no steps.**

- That path is deterministic and needs no provider. Check that the imported result actually carries step structure (e.g. a plain JUnit `<testcase>` with no steps is treated as low-structure and routed to the AI path instead).

**The derived steps aren't accurate.**

- They're best-effort inferences from the test name/output. Edit them on the case; your edits become the source of truth and won't be overwritten. To tune the AI's behavior, see [Prompt Configurations](./prompt-configurations.md).

## Related

- [LLM Integrations](./llm-integrations.md) — configure and assign AI providers (the opt-in for AI-derived steps)
- [Import & Export](../import-export.md#automated-test-results-import) — importing automated test results
- [WebdriverIO reporter](../sdk/wdio-test-cases.md) — Cucumber step capture from live runs
- [Prompt Configurations](./prompt-configurations.md) — customize how AI prompts behave per project

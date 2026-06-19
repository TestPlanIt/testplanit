---
slug: automated-tests-with-steps
title: "Your Automated Tests Now Come With Steps"
description: "Importing automation results used to give you a name and a green checkmark. Now TestPlanIt derives readable Steps from the automation itself — and for tests that have no structure, your own LLM writes them in the background."
authors: [bdermanouelian]
tags: [announcement, test-management]
---

Import a thousand automated test results into most test management tools and you get a thousand rows that say *passed* or *failed* — against a test name and nothing else. The "test case" is an empty shell. If you want it to actually describe what was tested, someone types the steps in by hand.

TestPlanIt now fills in those steps for you. When an automated result creates or matches a case, the case's **Steps** (each an action and its expected result) are derived from the automation that produced it — so your automated cases read like real, reviewable test cases instead of opaque green/red rows.

<!-- truncate -->

## Steps, derived from the automation itself

Plenty of automated tests already describe their own structure — you just have to read it the right way. TestPlanIt does, **deterministically** (no AI, no guessing, identical every time):

- **Cucumber / Gherkin** — each `Given` and `When` line becomes a step, and a `Then` becomes the expected result of the step before it, so the assertion lands right next to the action it verifies.
- **Playwright** — each `test.step()` title becomes a step, and a nested assertion becomes its expected result.

Because a single shared mapping powers this, a test produces the **same** Steps whether you import its results or report them live from a run with the [WebdriverIO](/docs/sdk/wdio-test-cases) or [Playwright](/blog/playwright-reporter) reporters. Your automated suite stops being a black box and becomes documentation that's always in sync with the code.

## And the tests that have *no* steps? Your AI writes them

Here's where it gets really interesting.

Frameworks like **Mocha and Jasmine** have no native step structure — to a test management system, a test surfaces as just a name and a pass/fail. So in other tools, those cases stay empty forever.

TestPlanIt does something different. It feeds **your own LLM** the actual sequence of commands each test executed — every navigation, element lookup, click, keystroke, and assertion — and turns that command stream into readable, user-facing steps that describe what the test *actually did*, not a guess from its title. Those commands reach it two ways: the [WebdriverIO reporter](/docs/sdk/wdio-test-cases) captures them live during the run, and many **imported** result files already embed them — a WebdriverIO junit report, for example, records every command in its output, and TestPlanIt reads it the same way. Only when a result carries no commands at all does it fall back to inferring the steps from the test's descriptive name.

- **It's your AI, your data.** Derivation uses the LLM integration you've already set up for the project — [bring-your-own](/blog/stop-renting-ai-bring-your-own-llm) OpenAI, Anthropic, Gemini, Azure, or a self-hosted model. Configuring a provider *is* the opt-in; if you haven't, the feature is completely inert.
- **It runs in the background.** Suites and imports run at the scale of thousands of cases, so derivation is never done inline — it's queued as a background job and never slows your CI run or your import down.
- **A human stays in the loop.** When the steps are ready, whoever ran the suite or import gets an **"AI-Derived Test Steps Ready"** notification linking straight to the run, so they can review the steps for accuracy. They're a strong starting point, not gospel — and you can [tune the prompt](/docs/user-guide/prompt-configurations) that generates them.

So a Mocha suite that used to land as a wall of bare names now becomes test cases that actually describe the flow they exercise — derived from the commands they ran, by the model you trust, on infrastructure you control.

## Safe by default — it never overwrites your work

Derivation only ever touches a case that has **no steps**. The moment a case has steps — whether you wrote them, edited them, or they were derived earlier — that case is the source of truth and is left alone. Re-import all you like; your edits are never clobbered.

When you *do* want a clean re-sync, both the importer and the reporters expose an opt-in, deliberately destructive `overwriteSteps` switch (off by default) that replaces a case's steps every run — including via the AI path.

## Turning it on

- **Deterministic steps** (Cucumber, Playwright, WebdriverIO) work out of the box — no setting to flip.
- **AI-derived steps** for low-structure tests just need an [LLM provider assigned to the project](/docs/user-guide/llm-integrations#project-assignment). Both entry points support it: the [Automated Test Results Import](/docs/import-export#automated-test-results-import) and the WebdriverIO reporter (for Mocha/Jasmine runs, with `captureSteps` on).

Full details are in [Test Step Derivation](/docs/user-guide/llm-step-derivation).

## Why it matters

Test management tools have spent years treating manual and automated testing as two separate worlds — rich, documented cases on one side, anonymous pass/fail counters on the other. This collapses that gap. Your automated results become first-class test cases: readable, reviewable, traceable, and useful to the next person who has to understand what coverage you actually have — without anyone retyping a single step.

That's the kind of living documentation teams keep meaning to write and never do. Now it writes itself.

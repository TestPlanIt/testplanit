---
slug: test-scripts-dont-belong-in-your-tms
title: "Why Your Test Scripts Don't Belong in Your Test Case Management Tool"
description: "Codeless automation and AI-generated scripts hosted inside a TMS sound appealing — until UI drift, framework lock-in, and the regenerate trap quietly erode the work you've done."
authors: [bdermanouelian]
tags: [best-practices, thought-leadership]
---

If you've evaluated a test management tool lately, you've seen this pitch: "Generate automated tests inside the tool." "Codeless automation — no scripting required." "AI-powered test creation."

And honestly? The pitch lands. One system, one login, one place to look. For a small team on a greenfield project, it even works for a while.

But it creates problems that only become obvious once you're deep enough in to care.

<!-- truncate -->

## What This Is Actually About

At its core, this is an argument about **separation of concerns** — the same principle that shapes every other layer of modern software. A test management tool and an automation framework are two different concerns, with different audiences, different lifecycles, and different tooling requirements. Collapsing them into one system feels tidy, but so does putting your database, your web server, and your logs on a single box. It works until it doesn't, and by the time it doesn't you've built a lot on top of it.

This isn't an argument against test management tools, or even against tools that integrate with automation. Plenty of tools do the right thing: you run your test scripts in CI, they post results back, the TMS shows you coverage and trends against your test cases. A handful of tools work this way. It's the pattern the industry has mostly converged on for good reasons — and it's exactly the separation of concerns that makes it work.

The pattern worth pushing back on is different: tools that *host* your scripts in their own database, tools that *generate* scripts inside a proprietary editor, and tools whose big AI feature is "we'll write your automation and keep it here." Low-code and no-code automation platforms are the clearest examples, and they're the ones most aggressively marketed to teams that don't already have a framework in place. Those have deeper problems, and most don't show up in a two-week trial.

## Low-Code and No-Code Are the Worst Offenders

Before getting into the specifics, it's worth being blunt about the category. Record-and-playback tools, visual script builders, drag-and-drop flow editors — Katalon Studio, Testim, Mabl, Leapwork, TestComplete, BrowserStack Low-Code, and the long tail of similar products — are the archetype of this anti-pattern. The pitch is always the same: "your QA team doesn't need to write code." The reality, consistently, is that you end up with a growing library of test scripts stored in a format only that vendor understands, maintained through a UI that was designed to look friendly in a demo rather than to scale to hundreds of scripts — sometimes thousands.

The appeal is real: scripts come together quickly, manual QA can contribute directly, and the first month looks fantastic. But the tradeoff is baked in from day one. The tool can't show you what a script does without the UI. Your version control system sees a binary blob or nothing at all. Teammates can't review changes. CI can't lint or type-check anything. And when the vendor's abstractions don't fit — which happens the moment your app does something nontrivial — the tool either adds a custom-scripting escape hatch (congratulations, you're writing code now, just in a worse editor) or quietly caps what your script suite can do.

The same critique applies to low-code features that some test management tools bolt on. Even when the TMS itself is otherwise well-designed, the moment you start storing test scripts in its database you've inherited the whole problem. This is a separate issue from whether a TMS is useful — it's very much useful — but it's a strong argument for keeping the scripts somewhere else.

## The Regenerate Trap

Here's the cycle that burns teams who go all-in on low-code, no-code, or AI-generated automation hosted in the vendor's tool.

You record or generate a test script. It works. You tweak it — add waits where the app is slow, handle a dynamic element, set up test data, tighten an assertion. You've made it yours.

Then the UI drifts. A button moves, a form gets restructured, a page gets a redesign. The script breaks. And because the scripts live in a format that's hard to edit structurally, the path of least resistance is to regenerate. Regenerate, and your tweaks are gone.

Do this enough times and you notice it's not a one-time event. It's a cycle. Every UI change costs you the work you did last time. Productivity in month one looks incredible; productivity in year two looks a lot like treading water.

## A Framework Beats a Generator

Compare this to what a team running a modern automation framework does when the UI drifts.

You have a page object for the page that changed. You update the locator in one place. Every script that touches that page is now fixed. Your tweaks — waits, assertions, data setup — are untouched because they live in the script itself, where structured code separates "how to find things on the page" from "what this script is checking."

This is what Playwright's page object model looks like. It's what Cypress custom commands look like. It's what a well-structured WebDriverIO or Selenium suite looks like. The whole automation industry converged on this pattern because it works: localized changes, persistent tweaks, scripts that survive UI churn. Generators can't give you that. Their output is flat — each script is a standalone recording with locators inlined and waits hardcoded. Refactoring means regenerating. That's fine for a throwaway smoke script. It's not fine for a regression suite you'll maintain for years.

## Framework Lock-In Is the Other Kind of Lock-In

Most of the lock-in conversation focuses on the vendor — you can't leave this specific tool without rewriting your automation. Real problem. But there's a second kind of lock-in: to whatever *framework* and *language* the tool decided to support.

A lot of teams are moving from Selenium to Playwright right now. Good reasons — faster execution, better async handling, network interception, TypeScript ergonomics. If your automation lives in your repo, you can migrate incrementally: new scripts in Playwright, old Selenium scripts keep running, switch at your own pace. Same for language migrations — Java to TypeScript, Python to Go. You own the code, you control the migration.

If your automation lives in a test management tool that only generates Selenium Java, you can't. You can start writing Playwright scripts in a separate repo, but now you've got two parallel systems and the TMS has no idea the Playwright scripts exist. Every new script you generate in the tool digs the Selenium hole a little deeper. The migration path isn't "gradual" — it's "rewrite everything at once, probably never."

This is the kind of decision that doesn't feel like a decision when you make it. You pick a tool in 2023 that only generates Selenium. In 2026, the team wants Playwright. Now you're discovering that three years of recorded automation is tied to a framework you've outgrown.

## When the AI Can't See Your Code

A newer version of this problem shows up in AI-generated automation. Some tools sync generated scripts directly into a vendor's broader automation platform — one vendor owning both the generation and the execution.

The issue isn't AI. AI-assisted test script writing is genuinely useful. The issue is *where* the AI runs and *what* it can see. An AI generating scripts in a vendor's hosted editor doesn't see your existing page objects, custom commands, data helpers, or naming conventions. It produces generic code, not code that fits your project — because it has no visibility into your project. You either accept its patterns and drift from your own, or spend meaningful time adapting every output and wonder what the AI actually saved you. Either way, you can't take the work with you.

Contrast this with AI that runs against your actual repo and reads your actual code. Same technology, different position in the stack, completely different outcome.

## A Note on Gherkin

One case complicates this picture: Gherkin feature files stored in a TMS, with step definitions in the repo. Usually Cucumber-style BDD integrated with Jira.

If you're genuinely practicing BDD — three-amigos sessions, scenarios written before code, Gherkin as a collaboration artifact — storing feature files in the TMS is defensible. Scenarios are documentation that happens to be testable. For teams actually doing BDD, it can work.

The honest issue is that most teams using Gherkin aren't doing BDD. They're writing imperative Gherkin — `Given I click the "Login" button / And I enter "user" in the field` — which is Selenium in Gherkin clothing. Cucumber's own creators call this an anti-pattern. Hosting it in the TMS is the same proprietary-storage problem, with extra ceremony. And even for real BDD, split storage creates a silent coupling: rename a step in the TMS, step def matching in the repo breaks at the next CI run. Two sources of truth, no tooling to enforce sync.

## Test Scripts Belong With the Application Code They Exercise

A quick terminology note before this section, because it matters here: **test cases** are the human-readable descriptions of what to verify — the artifacts a TMS is built for. **Test scripts** are the automation code that executes those checks against a real system. This section is about *test scripts*, not test cases. Test cases can happily live in a TMS. Test scripts should not.

There's a stronger version of "keep your scripts in your repo" that's worth stating directly: **test script code should live in the same repository as the application it's exercising.** Not a sibling repo, not a separate "automation" project owned by QA — the same repo as the application source.

This matters for reasons the TMS-hosting pattern can't touch:

- **It shifts automated testing left without a memo.** When the test scripts are right there in the codebase, developers run them before handing code to QA. They don't have to remember to go check another system. A failing script shows up in the same terminal as the compile error. That nudge is worth more than any process document.
- **It treats test scripts like what they are — code.** Scripts get reviewed in the same pull request as the feature they verify. They get refactored when the code underneath them is refactored. They move through the same CI, the same linters, the same type checker, the same coverage tooling. The whole discipline that has made application code maintainable over the last thirty years applies to test scripts, for free, the moment they live in the same repo.
- **It keeps script and application versions in lockstep.** This is the one most teams underestimate until they're burned by it. You need to know which version of the test scripts ran against which version of the application. If the scripts live in a separate system with its own versioning, you're constantly asking "wait, does this script suite match the build we deployed?" When the scripts live in the repo, a `git checkout` gets you the exact scripts that shipped with that release. No ambiguity, no drift, no archaeology.

None of this is possible when the scripts live in a TMS database. The scripts aren't in the diff. They aren't in the PR. They aren't tagged with the release. They're in a separate universe, with a separate versioning story, maintained by people who may not even see the code change that broke them.

## What You Actually Lose

When scripts live in a vendor's database instead of version control, here's what you quietly don't have:

- **Diffs, blame, and bisect** — no "who changed this assertion six months ago, and why."
- **Code review** — modifications to code that decides whether your software ships go in without another pair of eyes.
- **IDE tooling** — no autocomplete across files, type checking, structural rename, or jump-to-definition.
- **Local debugging** — no breakpoints, no stepping through, no inspecting state.
- **CI-native workflows** — your pipeline runs against a checkout of a repo; scripts in a TMS have to be reached into from outside.
- **Portability** — your cases are exportable; your scripts are a rewrite.

## What to Look For in a Test Management Tool

If you're evaluating tools, here's the lens that cuts through most of the noise: **a test management tool should make your automation visible, not own it.** It should know which test scripts exist, which requirements they cover, and what happened when they ran. It shouldn't be the canonical home of the scripts themselves.

Look for:

- Results ingestion from your CI pipeline — whatever framework, whatever language.
- A way to link cases to automation without hosting it — stable IDs, tags, annotations.
- Portable export — your cases leave as structured data; your scripts were never in the tool in the first place.
- Framework and language agnosticism — today's choice shouldn't block next year's migration.

Avoid:

- Proprietary script editors sold as a feature.
- Codeless automation stored in formats you can't export to real code.
- AI generation that outputs to the vendor's ecosystem instead of your repo.
- Tight coupling between the TMS and one specific framework or language.

## The Bottom Line

Test management is valuable. Automation is valuable. The problem is when one tries to own the other — when a tool ignores separation of concerns and stuffs everything into a single system because a unified demo sells better than a well-designed seam.

Keep the scripts in your repo. Let version control, code review, and your IDE do what they've been good at for decades. Let CI run the test scripts. Let the test management tool do what only it can do: aggregate script results across frameworks, link test cases and scripts back to requirements, track coverage, give you structured visibility a code repo alone can't. That's the seam worth defending.

Tools that own your automation own you. Tools that respect the separation between test management and test code — and make the two talk to each other through stable, boring interfaces — give you leverage.

---
slug: three-questions-every-release-should-answer
title: "Three Questions Your Release Process Should Be Able to Answer"
description: "Is it covered? What do we need to retest? Can we prove it? The release artifacts that answer each one, when to produce them, who they're for, and where to start if you have none of them today."
authors: [bdermanouelian]
tags: [best-practices, thought-leadership]
---

It's the day before a release. Someone asks, "Did we test the new permissions model?" The room goes quiet, someone opens a spreadsheet, and someone else says "I'm pretty sure that got covered last sprint."

Every release raises the same three questions. _Is it covered? What do we need to retest? Can we prove it?_ Most teams answer from memory. Memory is what goes quiet in that meeting, and it's what walks out the door when a senior tester leaves. Here's how to answer from records instead: what to produce, when, and for whom.

<!-- truncate -->

## The Artifacts

Before the details, the inventory. A release process that can answer all three questions produces five things:

| Artifact | When | For whom |
| --- | --- | --- |
| Coverage matrix: requirements mapped to tests, with current results | Continuously; reviewed at release candidate | QA lead, product owner |
| Scoped regression list, with the reason each test is on it | Every pull request | Developers, testers |
| Execution record: every result with build, timestamp, and name | Every run | Whoever asks, months later |
| Open defects and accepted risks | Release candidate | Release manager, stakeholders |
| Sign-off record: frozen numbers, frozen matrix, approvers, time | Sign-off | Auditors, leadership, your future self |

If you produce none of these today, the rest of this post is about where to start. If you produce some, it's about making them trustworthy.

## Is It Covered?

To answer this, you need to know which tests verify each requirement in the release, whether those tests have run, and whether the requirement changed after they did. That's the coverage matrix.

The cost of not having one is quiet. Features ship with a requirement nobody tested, you find out from a customer, and nobody traces it back to the matrix that didn't exist.

A few habits keep it accurate:

- **Link tests to individual requirements, not features.** A test linked to "Checkout" tells you nothing. A test linked to "Cart totals recalculate when a coupon is removed" tells you exactly what's verified.
- **Use the requirements product management already wrote.** Don't maintain a second copy. It drifts within a sprint. If those requirements are one-line tickets, link to them anyway. A one-line ticket with a test linked to it beats a detailed spec linked to nothing.
- **Look at the gaps first.** Requirements with no tests, and requirements whose tests have never run. Those are the ones that will surprise you.
- **Re-verify after a requirement changes.** When the text changes, every linked test has to run again before it counts. Mark them and don't clear the mark until they do.

**Where to start:** take this release's requirements, however rough, and put a test id next to each one. The empty rows are your first finding.

## What Do We Need to Retest?

To answer this, you need to know which tests exercise the code that changed in this build, and why each one is on the list. That's the scoped regression list, and the "why" is what makes a team trust it instead of running everything anyway.

The cost of not having it is the full regression pass on every build. It takes days, it delays feedback until the developer has moved on, and it teaches everyone to treat results as noise.

Start from the diff. It describes exactly what changed, and it exists for every build. Turn changed files into tests using three sources, in order of confidence:

1. **Tests someone has tied to that code.** A tester or developer said "this test covers this module." The most reliable source, and the only one that captures knowledge that isn't in the code.
2. **Tests that ran the last time that code changed.** Your own history, and it gets better with every release.
3. **Tests whose names or steps match the change.** The widest net, and the one that catches what nobody thought to tie to the code.

Write the reason next to every test on the list. "Tied to the totals module, and failed the last time it changed" is something a tester can check and act on. Leave out files that change in every build, like changelogs, or every scoped list becomes the full suite.

Then start the run the moment the pull request opens. Put the automated and manual tests in the same run, send the automated ones to the pipeline right away, and leave the manual ones for a tester. The developer gets results while the change is fresh. The tester opens a run that's already half done. Keep full regression for release candidates, where it belongs.

**Where to start:** tag every test with the module it covers, and ask developers to name the modules a pull request touches. Matching the two by hand is a scoped list. Until it builds itself, write the scope and the reason in the run description.

## Can We Prove It?

To answer this, you need the numbers exactly as they were at sign-off, who approved them, what was known to be broken, and what risk was accepted. That's the execution record, the defect list, and the sign-off record together.

The cost of not having them shows up months later. A live report says 97% at sign-off and 94% today because a flaky suite was re-run. Both numbers are true, and neither is proof, because neither is tied to a moment. Then an escaped bug prompts "why didn't we test that?" and nobody can show that it was a known gap someone accepted.

- **Freeze the sign-off report.** Capture the numbers at approval, record who and when, and never let that copy change. Keep the live version for day-to-day monitoring.
- **Freeze the coverage matrix at each release.** Comparing two releases shows which requirements gained coverage, lost it, or shipped with none.
- **Record what you didn't test and who accepted it.** At release candidate, list open defects with severity, the gaps left open, and the name of the person who said ship anyway. That list protects the team more than any pass rate.
- **Don't assemble evidence after the fact.** Every execution should already carry a build, a timestamp, a result, and a name. Sign-off is freezing what's there.

**Where to start:** at your next sign-off, export the report, the matrix, and the open defect list to a dated folder, and write the approver's name on it. That's a sign-off record. Make it automatic later.

## The Bottom Line

Is it covered? A coverage matrix at the requirement level, re-verified when requirements change. What do we retest? A regression list built from the diff with a reason beside every test, started as a run the moment the change lands. Can we prove it? Frozen numbers, a frozen matrix, a list of what was knowingly left open, and the names on the approval.

Five artifacts, each produced at a known moment for a known audience. Start with whichever one your last release was missing when the room went quiet.

That's the thinking behind [TestPlanIt 1.1](/blog/v1.1-release), and it holds whatever tool you use.

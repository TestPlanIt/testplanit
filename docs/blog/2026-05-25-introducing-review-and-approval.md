---
slug: introducing-review-and-approval
title: "Introducing Review & Approval: Sign-Off, Built Into the Workflow"
description: "TestPlanIt v0.30.0 ships review & approval. Any workflow state — Active, Done, Approved — can require a designated reviewer's sign-off before a test case, run, or session can land there."
authors: [bdermanouelian]
tags: [release, announcement]
image: /img/screenshots/user-guide/review-approvals/reviewer-inbox.png
---

<figure>
  <img src="/img/screenshots/user-guide/review-approvals/reviewer-inbox.png" alt="The reviewer inbox showing four pending review requests with their requesters, target workflow states, and approve / request changes / reject row actions." />
  <figcaption>The reviewer inbox surfaces pending approvals across every project a reviewer is assigned to — directly or via a role they hold.</figcaption>
</figure>

Every QA team has the same rule, and every QA team breaks it. "Don't mark a case Active until the lead has looked at it." "Don't complete the sprint test run until the PM signs off." "Don't approve the session report unless someone double-checked the evidence."

The rule is in the wiki. It's in the new-hire onboarding. It's in someone's Slack DM history from last quarter. And every release cycle, somebody clicks the wrong button and a half-finished case ships as "Active," or a not-quite-done test run gets stamped "Complete" thirty seconds before the audit meeting starts.

It's not a tooling problem you can fix with another Confluence page. It's a tooling problem you fix by putting the gate inside the tool.

TestPlanIt v0.30.0 ships **[Review & Approval](/docs/user-guide/review-approvals)**. Any workflow state can be marked as **requires review**. After that, transitioning into (or across) that state isn't a one-click operation anymore — it's a request that a designated reviewer either approves, sends back, or rejects.

<!-- truncate -->

## Stop Documenting the Rule — Enforce It

The checkpoints you already care about — Active, Done, Approved, whatever your team calls them — can now refuse to be reached without sign-off. Mark a workflow state as **Requires review** and TestPlanIt does the rest. Authors see the gate. Reviewers see the gate. Nobody has to remember it's there.

## Every Decision, Attributed

Approvals are tied to a specific reviewer, on a specific date, for a specific transition. Assignees can be named individuals or roles — "QA Lead," "Compliance Reviewer" — and a new **Can approve** permission lets administrators decide exactly who's eligible per area: Test Cases, Test Runs, Sessions. Approvals are one-shot and consumed by the transition they were granted for. The record an auditor sees is the record that actually happened.

## Each Gate, Its Own Signature

If your workflow has two gated states, a case that crosses both gates needs both signatures — not just the last one. When your compliance posture says "tech lead approves Active, release manager approves Done," that's what shows up on the record. We considered the looser model and rejected it. The auditors who matter would too.

## Nobody Has to Chase Anyone

Reviewers know the moment work lands on their plate. Requesters know the moment a decision lands on theirs. Requests that sit too long get nudged automatically — in-app, by email, and over webhooks into Slack — until they're decided. No spreadsheet of pending reviews. No Friday-afternoon "hey, did you ever look at…" DMs. The workflow chases itself.

## Safe to Turn On

Gating workflow transitions is a meaningful behavior change, so the feature ships **off by default** at every level. A system admin opts the org in. Each project administrator opts that project in — pilot one team without disturbing the rest. Only the states you explicitly mark Requires review trigger anything. And every switch is non-destructive: turn the feature off mid-flight and in-flight requests wait quietly until you turn it back on.

Full reference in the [Review & Approval guide](/docs/user-guide/review-approvals).

## Upgrade to v0.30.0

Pull the latest, install, generate, and build. Docker users can pull the latest image. Full upgrade notes are in the [release notes](/docs/).

## Get Involved

- Star the repo on [GitHub](https://github.com/testplanit/testplanit)
- Follow [@TestPlanItHQ](https://x.com/TestPlanItHQ) for updates
- Join our [Community Discord](https://discord.gg/kpfha4W2JH)
- Report issues and suggest features on GitHub

Thank you for using TestPlanIt!

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

## Gate the States That Matter

You already have workflow states. Cases move from "Draft" to "Under Review" to "Active" to "Archived." Runs go from "Not Started" to "In Progress" to "Done." Sessions follow a similar shape. Some of those states are checkpoints — the rest are intermediate.

Open **Administration → Workflows**, edit any state, and toggle **Requires review**. That's the entire setup. A small warning icon now appears next to that state so authors and reviewers both see the signal.

Now anyone who tries to flip a case to "Active," or a run to "Done," gets a different UI: a note telling them what gate they're crossing, a **Request review** button, and a Save button that stays disabled while the gate is unsatisfied.

## One Request, One Decision

Click **Request review**, pick an assignee, pick the target state, type a short note for the reviewer, submit. The assignee can be a specific user — your team lead — or a **role** like "QA Lead" or "Compliance Reviewer." If you pick a role, anyone holding that role can decide; the first decision wins, and TestPlanIt only shows roles whose holders actually have access to the current project, so requests can't dead-end on an empty assignee list.

The reviewer sees a count badge on the review inbox icon in the top nav. They open the inbox, see the request alongside the requester's note and the proposed transition, and pick one of:

- **Approve** — the request flips to APPROVED. The next time the entity moves to the target state, the approval is consumed.
- **Request changes** — sends the request back with a comment. The case stays where it was.
- **Reject** — the transition is blocked. A new request is needed to retry.

Approvals are one-shot. Once consumed by an actual transition, they can't be reused. You always know that the workflow state your auditor is looking at corresponds to a specific reviewer's specific decision on a specific date.

If a requester closes the loop on their own request before a reviewer gets to it, the request moves to CANCELLED and quietly leaves the reviewer's Pending tab. No false-positive ping, no clutter in the Decided audit trail.

## Strict Transitive: Each Gate, Its Own Approval

If your workflow has two gated states — say, "Active" and "Done" — a case moving from "Draft" directly to "Done" crosses *both* gates. TestPlanIt requires an approved request for **each** of them. An approval for "Done" doesn't grant transit through "Active."

This sounds strict because it is. Each gate is its own checkpoint with its own reviewer decision. If your compliance posture says "a tech lead approves Active and a release manager approves Done," that's what you get — both signatures on the record, not just the last one. The model is deliberate. We considered "approval for any later state satisfies earlier gates" and chose against it; auditors who matter don't accept the looser version.

## Notifications, In-App and Email

Reviewers get an in-app notification — and an email, if email notifications are enabled in their preferences — the moment a request is assigned to them. Requesters get the same shape when their request is decided: approved, changes requested, or rejected each fan out as their own notification type so the recipient sees the outcome without reading every line.

The persistent surface is the same one: the review inbox icon in the top navigation carries a count badge of everything pending for the reviewer — directly assigned or via a role they hold — refreshed on a short polling cadence. Pending tab while they work through requests; Decided tab for the audit trail.

Requesters also see live status on the entity itself: a pending banner while the request is open, an attribution banner after a decision, with the reviewer's name, the decision, and any comment they left. No separate dashboard to learn — the state lives next to the case, run, or session it gates.

No new notification plumbing for admins to learn. The existing global and per-user notification preferences gate review notifications the same way they gate every other notification in the product.

## Two Levers, Per Project and System-Wide — Off By Default

Gating workflow transitions is a meaningful behavior change for every existing project, so we ship the feature **off by default**. Admins enable it explicitly — nothing changes for your existing test cases, runs, or sessions until you choose to turn it on.

System administrators flip the global switch on **Administration → Workflows**. That makes the feature available org-wide; nothing is gated yet because…

…each project carries its own **Review Workflow** toggle in **Project Settings → Advanced**, also off by default. Project administrators opt in per project. A team can pilot the feature on one project while the rest of the org keeps moving without gates. System administrators rolling the feature out at scale can flip every project's toggle from one searchable, sortable list on the same **Administration → Workflows** card — no need to walk through dozens of project Settings pages.

Marking workflow states as **Requires review** is the third lever — even with both switches on, only states you've explicitly gated trigger the request flow.

Flipping either lever off mid-flight is non-destructive: in-flight requests are preserved silently and reappear in their reviewers' inboxes the moment the lever flips back on.

Full reference at [Review & Approval](/docs/user-guide/review-approvals).

## Upgrade to v0.30.0

Pull the latest, install, generate, and build. Docker users can pull the latest image. Full upgrade notes are in the [release notes](/docs/).

## Get Involved

- Star the repo on [GitHub](https://github.com/testplanit/testplanit)
- Follow [@TestPlanItHQ](https://x.com/TestPlanItHQ) for updates
- Join our [Community Discord](https://discord.gg/kpfha4W2JH)
- Report issues and suggest features on GitHub

Thank you for using TestPlanIt!

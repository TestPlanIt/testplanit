---
slug: introducing-review-and-approval
title: "Introducing Review & Approval: Sign-Off, Built Into the Workflow"
description: "TestPlanIt v0.30.0 ships review & approval. Any workflow state — Active, Done, Approved — can require a designated reviewer's sign-off before a test case, run, or session can land there."
authors: [bdermanouelian]
tags: [release, announcement]
image: /img/blog/review-approval-blog.jpg
---

<figure>
  <img src="/img/blog/review-approval-blog.jpg" alt="A reviewer inbox showing three pending review requests with their requesters, target workflow states, and approve / request changes / reject buttons. A warning glyph appears next to the 'Active' state in a workflow dropdown to signal that transition is gated." />
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

## The Bulk-Edit Footgun, Defused

TestPlanIt's bulk-edit modal evaluates the gate **per case** before you can click Save. If the target state is gated and any selected case lacks an approval, the Save button stays disabled with an inline message listing exactly which cases need a review first. Fix those (request review on them, get them approved), then re-open bulk-edit and Save works.

Milestone completion does the same thing one level up: when you complete a milestone and choose to cascade active runs and sessions to a "Done" state, every entity is gate-checked individually. One missing approval rolls back the whole cascade with a message naming the specific run or session and the specific gate that blocked it.

## Strict Transitive: Each Gate, Its Own Approval

If your workflow has two gated states — say, "Active" and "Done" — a case moving from "Draft" directly to "Done" crosses *both* gates. TestPlanIt requires an approved request for **each** of them. An approval for "Done" doesn't grant transit through "Active."

This sounds strict because it is. Each gate is its own checkpoint with its own reviewer decision. If your compliance posture says "a tech lead approves Active and a release manager approves Done," that's what you get — both signatures on the record, not just the last one. The model is deliberate. We considered "approval for any later state satisfies earlier gates" and chose against it; auditors who matter don't accept the looser version.

## Notifications, In-App and Email

Reviewers get an in-app notification — and an email, if email notifications are enabled in their preferences — the moment a request is assigned to them. Requesters get the same shape when their request is decided: approved, changes requested, or rejected each fan out as their own notification type so the recipient sees the outcome without reading every line.

The persistent surface is the same one: the review inbox icon in the top navigation carries a count badge of everything pending for the reviewer — directly assigned or via a role they hold — refreshed on a short polling cadence. Pending tab while they work through requests; Decided tab for the audit trail.

Requesters also see live status on the entity itself: a pending banner while the request is open, an attribution banner after a decision, with the reviewer's name, the decision, and any comment they left. No separate dashboard to learn — the state lives next to the case, run, or session it gates.

No new notification plumbing for admins to learn. The existing global and per-user notification preferences gate review notifications the same way they gate every other notification in the product.

## Two Levers, Per Project and System-Wide

We assume not every project needs gated workflows. Project administrators have a **Review Workflow** toggle in **Project Settings → Advanced** to opt out per project. A team running an unenforced sandbox can keep moving fast while the rest of the org runs gated workflows.

System administrators have a global flag one level up — visible on **Administration → Workflows**. Turning that off pauses every project's gating, hides the **Request review** button and inbox everywhere, and preserves any in-flight requests silently. Flip it back on and they reappear in their reviewers' inboxes.

Toggle either flag off mid-flight and nothing is lost. Toggle either back on and pending requests resume from exactly where they were.

Full reference at [Review & Approval](/docs/user-guide/review-approvals).

## Upgrade to v0.30.0

Pull the latest, install, generate, and build. Docker users can pull the latest image. Full upgrade notes are in the [release notes](/docs/).

## Get Involved

- Star the repo on [GitHub](https://github.com/testplanit/testplanit)
- Follow [@TestPlanItHQ](https://x.com/TestPlanItHQ) for updates
- Join our [Community Discord](https://discord.gg/kpfha4W2JH)
- Report issues and suggest features on GitHub

Thank you for using TestPlanIt!

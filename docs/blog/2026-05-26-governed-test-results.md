---
slug: governed-test-results
title: "Results You Can Defend: Required Fields, Edit Windows, and Justified Flips"
description: "Result governance you can turn on where it counts: required result fields, a configurable edit window for corrections, and an optional explanation when a completed outcome is flipped — every change recorded with before-and-after detail."
authors: [bdermanouelian]
tags: [release, announcement]
---

A test result is a claim: "this passed," "this run is done." When a release manager — or an auditor — asks who said so, when, and whether anyone changed it afterward, the answer needs to live in the tool.

This release gives that claim a backbone: required result fields that must be filled in, a configurable window for editing a recorded result, and an optional explanation when a completed outcome is flipped — with every edit captured in full, before-and-after detail.

<!-- truncate -->

## Required Fields, Enforced When You Save

If a template has a result field marked **Required**, results can't be saved without it — checked on the server, so it holds for the Add Result form, the API, and connected agents alike.

The quick **Pass & Next** and per-iteration buttons can't capture custom fields, so for a case with a required field they open the full **Add Result** dialog (pre-set to your chosen status) for you to fill it in and save. See [Required Result Fields](/docs/user-guide/templates-fields#required-result-fields).

## An Edit Window You Control

The system-wide edit window for results now has a dedicated control on the **Statuses** page — no restriction, disable in-place editing everywhere, or allow editing up to a maximum number of minutes. And each project can **tighten** it in its Advanced settings (a shorter window, or none at all), never loosening it past the system ceiling.

Once the window closes, a correction is recorded as a new attempt rather than overwriting the original, so both stay on the record. System administrators can always edit, and every edit lands in the audit log with before-and-after values. See the [Result Editing Policy](/docs/user-guide/statuses#result-editing-policy) and [Advanced settings](/docs/user-guide/projects#advanced-settings).

## Flips That Explain Themselves

Turn on **Require justification on result flip** and changing one completed outcome to a different one — Passed to Failed — prompts for **Result Details** before it saves. It fires only on a genuine flip; a first result, or any move involving a non-completed status like Untested or In Progress, is never blocked. The note is required, but the flip is never prevented. Automated imports (CLI and CI) aren't affected.

## Everything On the Record

The audit log records every result edit with the exact fields that changed and their old and new values — sensitive values masked — whether the edit came from a tester inside the window or an admin afterward. More in the [Audit Logs guide](/docs/user-guide/audit-logs).

## What Your Testers Will Notice

Most of this stays invisible until an administrator turns it on, but flag these to your team:

- **Pass & Next may open the Add Result dialog** — when the case has a required result field. That's expected, not a bug.
- **The notes box is now labeled "Result Details"** everywhere. Same box, one name.
- **A submission can ask for more** — Result Details on a flip, or a new attempt once the edit window has closed.

## Safe to Turn On

Everything here is opt-in. Flip justification is off until a project enables it, the edit window defaults to "projects decide," and required-field enforcement does nothing unless a field is actually marked required. Roll it out to one project, then widen.

## Upgrade

Pull the latest, install, generate, and build. Docker users can pull the latest image. Full upgrade notes are in the [release notes](/docs/).

## Get Involved

- Star the repo on [GitHub](https://github.com/testplanit/testplanit)
- Follow [@TestPlanItHQ](https://x.com/TestPlanItHQ) for updates
- Join our [Community Discord](https://discord.gg/kpfha4W2JH)
- Report issues and suggest features on GitHub

Thank you for using TestPlanIt!

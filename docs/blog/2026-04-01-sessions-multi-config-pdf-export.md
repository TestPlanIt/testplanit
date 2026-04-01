---
slug: sessions-multi-config-pdf-export
title: "Multi-Configuration Sessions, Session Duplication, and PDF Export"
description: "TestPlanIt v0.20.0 brings multi-configuration support and duplication to Sessions (matching Test Runs), plus PDF export for both Sessions and Test Runs."
authors: [bdermanouelian]
tags: [release, announcement]
---

TestPlanIt v0.20.0 brings three features that make session-based and exploratory testing faster to set up and easier to share.

<!-- truncate -->

## Multi-Configuration Sessions

Test Runs have supported multiple configurations since day one — select Chrome, Firefox, and Safari when creating a run, and TestPlanIt creates one run per environment, all linked together. Sessions now work the same way.

When creating a session, the **Configurations** field is now a multi-select. Pick two or more configurations and TestPlanIt creates one session per configuration, sharing the same name, template, milestone, tags, and issues. A configuration group ID links them so you can see they belong together — look for the link icon next to the session name in the list.

On the session detail page, a **configuration selector** appears above the results area (just like on test run details). Select a different configuration to navigate to that sibling session instantly.

[Learn more about multi-configuration sessions](/docs/user-guide/projects/sessions-add#multi-configuration-support)

## Session Duplication

Need to re-run an exploratory session for a new sprint or milestone? Click **Duplicate** from the session's context menu. The Add Session dialog opens pre-populated with all the original session's metadata — name, template, configuration, milestone, state, assigned user, description, mission, tags, issues, and custom field values. Modify what you need and create.

Results are never copied. The duplicate starts fresh.

You can also select multiple configurations during duplication to create one session per environment in a single step.

[Learn more about session duplication](/docs/user-guide/projects/sessions-add#session-duplication)

## PDF Export for Sessions and Test Runs

Both Sessions and Test Runs now have an **Export PDF** button on their detail pages. One click generates a portable PDF that includes:

**Session PDFs:**
- All metadata (template, configuration, milestone, state, assigned user, estimate, elapsed time)
- Description and mission
- Tags, linked issues (with keys and titles), and custom field values
- Every session result with status, notes, elapsed time, custom fields, linked issues, and embedded image attachments

**Test Run PDFs:**
- All metadata (configuration, milestone, state, forecasts)
- Description and documentation
- Tags, linked issues, and custom field values
- Every test case (ordered by run order) with execution status, assignee, results, step-by-step details, comments, custom fields, and embedded attachments

The export button appears in the header alongside Edit, Complete, and Duplicate — shown as compact icon buttons that expand to reveal their label on hover. Export is available on both active and completed items, including JUnit/automated test runs.

[Learn more about session export](/docs/user-guide/projects/sessions-details) | [Test run export](/docs/user-guide/projects/run-details)

## Other Improvements

- **MultiAsyncCombobox fixes**: "Select All" now shows the accurate total count across all pages (not just the current page). Selected items display with readable names and ellipsis truncation instead of clipped icons.
- **Session list**: A new Configuration column shows each session's configuration, matching the Test Run list layout.
- **Prompt config editor**: Fixed a bug where LLM integration selections weren't persisting after save when editing prompt configurations.
- **Copy/move collision detection**: Improved name collision detection for the copy-move preflight check.

Try it out and [let us know what you think](https://github.com/testplanit/testplanit/discussions).

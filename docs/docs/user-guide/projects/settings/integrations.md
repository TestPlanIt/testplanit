---
sidebar_label: 'Issue Integrations'
title: 'Issue Integrations (Project Settings)'
description: Choose which issue tracker is active for a project and configure its linked external projects
---

# Issue Integrations

The project-level **Settings → Issue Integrations** page chooses **which** issue tracker is active for this project, links it to external projects, and sets per-project defaults. The integrations themselves (credentials, base URL, authorization) are created globally by a system administrator under [Administration → Issue Integrations](../../integrations.md); here you select and configure one for your project.

:::note
Only system administrators and project administrators can open this page.
:::

## How to access

1. Open the project and expand **Settings** in the project menu.
2. Select **Issue Integrations**.

## What's inherited vs set here

| Configured globally (Admin) | Configured here (per project) |
| --- | --- |
| The integration definition: provider, name, credentials/OAuth, base URL, status | Which integration is **active** for this project (at most one) |
| | The **linked external projects** and which one is the **default** |
| | The **default issue type** (Jira) for each linked project |

Only integrations a system administrator has created and activated appear here. Supported providers are Jira, GitHub, GitLab, Gitea, Azure DevOps, Redmine, MantisBT, and Simple URL. If none exist, the page shows a **No issue integration assigned** empty state and an admin must configure one first.

## Assigning an integration

The **Available Issue Integrations** card shows a card per integration. The active one is highlighted with an **Active** badge.

- **Assign** — activate an integration for this project. If one is already active, you'll confirm the switch first.
- **Remove** — deactivate the active integration.

:::warning
**Switching to a different provider, removing the integration, or removing its last linked project removes the project's inbound webhook.** An inbound webhook is locked to one provider's payload format, so it can't survive a provider change. The confirmation dialog adds a warning bullet whenever an inbound webhook exists. Switching between two integrations of the *same* provider does **not** affect webhooks. See [Webhooks](../../webhooks.md).
:::

## Configuring the active integration

Once an integration is active, a settings card appears with a **Linked External Projects** section:

- **Add Projects** — link one or more external projects (for example Jira projects or GitHub repositories) so their issues can be referenced in TestPlanIt.
- **Set as Default** — mark one linked project as the default, pre-selected when creating new issues from TestPlanIt.
- **Remove Project** — stop syncing issues from a linked project. Previously synced issues are not deleted.
- **Import Issues** — import a linked project's issues into TestPlanIt: a recent, capped sample, or every issue of the project's configured requirement types with no window and no cap (see [Importing issues in bulk](#importing-issues-in-bulk)).
- **Default Issue Type** *(Jira only)* — choose the issue type used by default for each linked project.
- **Save Settings** — persist the integration's per-project configuration.
- **Authorize** — for OAuth providers, complete authorization if the connection needs it.

Simple URL integrations are link-only: they show an informational note and have no linked-projects or save controls.

## Importing issues in bulk

Linking and inbound webhooks bring issues into TestPlanIt one at a time. When you want a **body** of a tracker's issues available in your project — to browse, report on, or link quickly, or to bring in every issue of the project's classified requirement types — use **Import Issues** on a linked external project instead of linking each one by hand.

Each linked external project row has a single **Import Issues** button (the download icon). It opens a dialog where you scope what to pull:

- **Issue types** — for trackers that expose issue types, the configured requirement types this run will cover, shown for confirmation. Opening this dialog from the **Requirement Sync** section (see [Requirement Sync](#requirement-sync)) scopes it to the project's configured requirement types.
- **Updated within** — import issues updated in the last 30, 90, 180, or 365 days (default 90), or choose **All history** for no date limit at all.
- **Maximum to import** — a cap on how many issues this run creates (default 200, maximum 1000), which applies to a dated run. Choosing **All history** imports every matching issue with no cap, and disables this field.

A recent, capped sample (today's default) behaves as it always has: click **Preview** to see roughly how many issues match your filter (and whether the cap will trim the result), then **Import** to run it in the background.

Choosing **All history** switches to an uncapped run instead: it targets the project's configured requirement types (see [Requirement Sync](#requirement-sync)), has no date window and no cap, and pages to completion. If the project hasn't classified any requirement types yet, it says so instead of importing anything. Otherwise, before it writes anything, it states roughly how many matching issues the tracker holds and asks you to confirm — this is also the import that starts automatically when saving a **Requirement Sync** change newly classifies a type, so you don't have to remember to run it afterward.

The linked project's status badge shows **Syncing** while any import runs and **Synced** when it finishes — the same badge the [re-sync](../../integrations.md#re-syncing-linked-issues) uses. An uncapped run additionally shows its progress on the linked external project's own row, with a **Stop** action: *"Stopping takes effect after the current page finishes importing. Issues already imported will stay."* Only one import can run per linked project at a time.

Imported issues are created **in this project** and behave like any other linked issue:

- They are **de-duplicated** against issues already in TestPlanIt, so re-running an import never creates duplicates.
- They are kept up to date by the existing status sync and inbound webhooks.
- They are removed only by **manual** delete — there is no automatic pruning. Hide ones you don't need with the filters on the [Issues list](../issues.md).

:::note
Which filtering happens at the tracker depends on the provider. Jira, GitHub, and Azure DevOps apply the recency window in the tracker query; other providers fetch pages and apply the window afterward, so a windowed import there may scan more issues before it reaches the cap. **Simple URL** integrations have no tracker API and do not offer import.
:::

:::info
Only system administrators and project administrators can import issues — the same audience that can manage the project's integrations.
:::

## Milestone Sync

For milestone-capable providers (currently Jira), a **Milestone Sync** card appears below **Linked External Projects** once the active integration supports it:

- **Enable milestone sync** — turns sync on. Once enabled, the project's [Milestones](../milestones.md) page gains an **Import from Jira** button that previews Fix Versions and Sprints across all of this integration's linked Jira projects.
- **Kinds to sync** — choose which of the tracker's time-based artifacts to sync as Milestones: **Releases** (Jira Fix Versions) and/or **Sprints**.
- **Automatically add new ones** (auto-track) — when on, newly created unreleased versions and active/future sprints are imported automatically as they appear, without anyone opening the Import dialog. Only artifacts created **after** auto-track is enabled are imported — anything that already existed at that moment is left alone (use the Import dialog to pick those explicitly). When auto-track is on, a checkbox list of the project's connected tracker projects appears — all are scanned by default, and unchecking one stops new milestones from being created from it (explicit imports and already-synced milestones are unaffected; changing the selection re-baselines so re-included projects don't backfill). Auto-tracked imports are attributed to the admin who enabled sync (or auto-track), not to whoever's page load happens to trigger the pass.

Enabling milestone sync also provisions the **Release** and **Sprint** [milestone types](../../milestone-types.md) for the project.

A manual **Sync now** always fetches the latest state from the tracker immediately. Page loads passively refresh already-linked milestones at most once every 5 minutes. When [inbound webhooks](../../webhooks.md#milestone-sync-events-versionsprint) are configured and the tracker sends version/sprint events, refreshes happen within seconds of the upstream change.

See [Milestones](../milestones.md) and [Milestone Details](../milestone-details.md#source-badge) for what a synced milestone looks like, and [Webhooks → Milestone sync events](../../webhooks.md#milestone-sync-events-versionsprint) for the event-driven path.

:::info
Enabling or changing milestone sync settings, running **Sync now**, and **Import from Jira** all require **project admin** status — the project creator, a user with the **Project Admin** role on the project, or a user with `PROJECTADMIN`/`ADMIN` system access. See the [Permissions Guide](../../permissions-guide.md).
:::

## Requirement Sync

For requirement-capable providers (Jira, Azure DevOps, GitLab, Redmine, MantisBT, GitHub, and Gitea), a **Requirement Sync** section appears on the active integration's settings. It chooses which tracker issue types count as requirements in this project — existing issues are reclassified to match whenever you change the selection:

- **Enable requirement classification** — turns classification on; the picker below stays disabled until it is.
- **Issue types** — a multi-select of the issue types across all of this integration's linked external projects (for example Epic, Story, or a custom Requirement type).
- **Labels** (GitHub and Gitea) — neither tracker has issue types, so the picker selects repository labels instead (for Gitea, organization labels on an org-owned repository are included): an issue counts as a requirement while it carries **at least one** selected label, and stops being one when it carries none of them.

Before you save, an **Impact of this change** preview shows how many existing issues will become requirements or stop being requirements, plus a callout for detached or locally edited rows that would lose their requirement status. For GitHub and Gitea the preview describes the effect of the label change rather than counting rows. Nothing is applied until **Save**; saving also reclassifies existing issues to match. Removing a type is reversible — re-adding it restores the classification, and nothing is deleted.

To bring in every existing issue of the configured types — not just the ones classified as they arrive — use the linked project's own **Import Issues** action, described in [Importing issues in bulk](#importing-issues-in-bulk); opening it from here starts it already scoped to these types with no limit. Saving a change that newly classifies a type offers this same import unprompted. While an uncapped run is in progress, its status and a **Stop** action appear on the linked external project's row under **Linked External Projects**.

Classified requirements appear on the project's [Requirements](../requirements.md) page once the feature is enabled for the project under [Advanced settings](advanced.md) — see [Enabling Requirements](../requirements.md#enabling-requirements) for the full two-step setup.

:::info
Changing requirement type settings requires **project admin** status — the project creator, a user with the **Project Admin** role on the project, or a user with `PROJECTADMIN`/`ADMIN` system access. See the [Permissions Guide](../../permissions-guide.md).
:::

## Related pages

- [Issue Integrations (Administration)](../../integrations.md) — create and authorize integrations globally.
- [Webhooks](../../webhooks.md) — receive issue updates and push events for this project, including [milestone sync events](../../webhooks.md#milestone-sync-events-versionsprint) (version/sprint) for projects with synced Milestones.
- [Advanced settings](advanced.md) — optionally require a linked issue when recording a failure.
- [Milestones](../milestones.md) and [Milestone Details](../milestone-details.md) — where synced milestones appear once milestone sync is enabled here.
- [Requirements](../requirements.md) — where classified requirements appear once the feature is enabled for the project.

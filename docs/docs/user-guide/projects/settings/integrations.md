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
- **Import Issues** — bulk-import a scoped set of a linked project's issues into TestPlanIt (see [Importing issues in bulk](#importing-issues-in-bulk)).
- **Default Issue Type** *(Jira only)* — choose the issue type used by default for each linked project.
- **Save Settings** — persist the integration's per-project configuration.
- **Authorize** — for OAuth providers, complete authorization if the connection needs it.

Simple URL integrations are link-only: they show an informational note and have no linked-projects or save controls.

## Importing issues in bulk

Linking and inbound webhooks bring issues into TestPlanIt one at a time. When you want a **body** of a tracker's issues available in your project — to browse, report on, or link quickly — use **Import Issues** on a linked external project instead of linking each one by hand.

Each linked external project row has an **Import Issues** button (the download icon). It opens a dialog where you scope what to pull:

- **Updated within** — only import issues updated in the last 30, 90, 180, or 365 days (default 90). This keeps the import to recently-active issues rather than a tracker's entire history.
- **Maximum to import** — a hard cap on how many issues this run creates (default 200, maximum 1000). When more issues match than the cap allows, only the most recently updated ones up to the cap are imported.

Click **Preview** first to see roughly how many issues match your filter (and whether the cap will trim the result), then **Import** to run it in the background. The linked project's status badge shows **Syncing** while the import runs and **Synced** when it finishes — the same badge the [re-sync](../../integrations.md#re-syncing-linked-issues) uses.

Imported issues are created **in this project** and behave like any other linked issue:

- They are **de-duplicated** against issues already in TestPlanIt, so re-running an import never creates duplicates.
- They are kept up to date by the existing status sync and inbound webhooks.
- They are removed only by **manual** delete — there is no automatic pruning. Hide ones you don't need with the filters on the [Issues list](../issues.md).

:::note
Which filtering happens at the tracker depends on the provider. Jira, GitHub, and Azure DevOps apply the recency window in the tracker query; other providers fetch pages and apply the window afterward, so an import there may scan more issues before it reaches the cap. **Simple URL** integrations have no tracker API and do not offer import.
:::

:::info
Only system administrators and project administrators can import issues — the same audience that can manage the project's integrations.
:::

## Related pages

- [Issue Integrations (Administration)](../../integrations.md) — create and authorize integrations globally.
- [Webhooks](../../webhooks.md) — receive issue updates and push events for this project.
- [Advanced settings](advanced.md) — optionally require a linked issue when recording a failure.

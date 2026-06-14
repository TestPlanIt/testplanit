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
- **Default Issue Type** *(Jira only)* — choose the issue type used by default for each linked project.
- **Save Settings** — persist the integration's per-project configuration.
- **Authorize** — for OAuth providers, complete authorization if the connection needs it.

Simple URL integrations are link-only: they show an informational note and have no linked-projects or save controls.

## Related pages

- [Issue Integrations (Administration)](../../integrations.md) — create and authorize integrations globally.
- [Webhooks](../../webhooks.md) — receive issue updates and push events for this project.
- [Advanced settings](advanced.md) — optionally require a linked issue when recording a failure.

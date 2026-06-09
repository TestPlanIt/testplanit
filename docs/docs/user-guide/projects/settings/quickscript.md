---
sidebar_label: 'QuickScript'
title: 'QuickScript (Project Settings)'
description: Enable QuickScript for a project and configure the code repository, file context, and export templates used by AI generation
---

# QuickScript

The project-level **Settings → QuickScript** page enables QuickScript for a project and configures the **AI context** behind it — which code repository, branch, and files feed into AI-assisted automation-script generation — plus which export templates are available.

:::note
Only system administrators and project administrators can open this page. Repositories and export templates are created globally by a system administrator; this page selects and configures them for the project.
:::

## How to access

1. Open the project and expand **Settings** in the project menu.
2. Select **QuickScript**.

## Enable QuickScript

The **Enable QuickScript** toggle controls whether team members can convert test cases into automation scripts in this project.

## Export Templates

Assign which export templates are available for this project and pick a **default template**. Only assigned templates appear in the export dialog. Choose **None (use global default)** to fall back to the system default template.

Export templates are defined under [Administration → QuickScript Templates](../../quickscript-templates.md).

## Code Repository

Bind the project to a registered code repository so AI-generated scripts follow your real code:

- **Code Repository** — select a repository a system administrator registered under [Administration → Code Repositories](../../code-repositories.md). If none exist, an empty state links administrators to set one up.
- **Branch** — leave blank to use the repository's default branch.
- **Path Patterns** — one or more rows combining a base **path** with a glob **pattern** (for example path `tests/e2e/pages` + pattern `**/*.ts`). Use **Add Path** to add rows.
- **Preview Files** — resolve the branch and patterns and list the matching files, their count, and total size.

:::warning
AI export uses at most **500 KB** of repository file context. When matched files exceed that budget, files are ranked by relevance at export time and lower-ranked files are skipped. The preview warns when you're over the limit.
:::

## Cache Settings

Repository file listings are cached (in Valkey) for fast access during AI generation:

- **Enable file caching** — on by default. When off, files are fetched live from the provider on every export (no copy is stored in TestPlanIt).
- **Cache Duration (days)** — 1–30, default 7.
- **Cache Status** — shows the last fetch result; **Refresh Cache** re-fetches the file listing and contents now.

Click **Save Configuration** to persist the binding. Changing the repository, branch, or path patterns invalidates the cache; changing only the duration or the cache toggle does not.

### Disconnecting

**Disconnect Repository** removes the binding. This clears the cached files, the branch and path configuration, and stops including code context in AI-generated exports.

## Related pages

- [Code Repositories (Administration)](../../code-repositories.md) — register the repositories selected here.
- [QuickScript Templates](../../quickscript-templates.md) — define export templates.
- [QuickScript from the repository](../quickscript.md) — generating scripts from test cases.

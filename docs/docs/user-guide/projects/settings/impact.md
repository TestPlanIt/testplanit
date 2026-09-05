---
sidebar_label: 'Impact Analysis'
title: 'Impact Analysis (Project Settings)'
description: Enable test impact analysis for a project and connect the repository of the application under test — branch, path patterns, cache, and repository markers
---

# Impact Analysis

The project-level **Settings → Impact Analysis** page enables [test impact analysis](../../impact.md) for a project and connects the **application repository** behind it — the repository of the application under test, whose commits are compared and whose files test cases are pinned to.

:::note
Only system administrators and project administrators can open this page. Repositories are registered globally by a system administrator; this page selects and configures one for the project.
:::

This is a separate connection from the one on the [QuickScript](quickscript.md) page: QuickScript points at test automation code, Impact Analysis points at the application under test. A project can use the same repository for both, or different ones.

## How to access

1. Open the project and expand **Settings** in the project menu.
2. Select **Impact Analysis**.

## Enable Impact Analysis

The **Enable Impact Analysis** toggle controls whether team members see **Analyze impact** when composing a test run and the **Code Pins** panel on test case pages. The toggle applies immediately; the rest of the page is saved with **Save Configuration**.

## Application Repository

- **Code Repository** — select an active repository a system administrator registered under [Administration → Code Repositories](../../code-repositories.md). If none exist, an empty state links administrators to set one up.
- **Branch** — a searchable list of the repository's branches, with **Repository default branch** as the first option. When the branches cannot be listed, a notice shows the provider's error and the field becomes a text box: type the branch name, or leave it blank to use the repository's default branch.

Commits are picked from this branch in the Impact dialog, and Code Pins are anchored at its tip.

## Path Patterns

One or more rows combining a base **Path** with a glob **Pattern** decide which application files Impact works with — the files offered in the Code Pin file picker, scanned for repository markers, and cached. For example, path `src` with pattern `**/*` includes everything under `src`. Use **Add Path** to add rows.

**Preview Files** resolves the branch and patterns and lists the matching files with their count, showing progress while the repository is scanned and retrying when the provider rate-limits the request. A **Results may be incomplete (provider limit)** badge appears when the provider capped the listing.

## Cache Settings

Repository file listings and contents are cached (in Valkey) so the Code Pin file picker and repository marker scans stay fast:

- **Enable file caching** — on by default. When off, repository markers are **not scanned**, and the Code Pin file picker lists files live from the provider each time it opens.
- **Cache for N days** — how long the cache is kept before it is refreshed (1–30 days, default 7).
- **Cache Status** — **Never fetched**, **Refreshing...**, or the **Last Fetched** time with **Files Cached**, **Contents Cached**, and **Total Size**. If only some contents were cached — for example after a provider rate limit — a warning asks you to refresh again to complete.
- **Refresh Cache** — re-fetches the file list and contents now, and re-scans repository markers when it finishes. The refresh runs in the background, and the page updates when it completes.

Click **Save Configuration** to persist the connection. Changing the repository, branch, or path patterns invalidates the cache; changing only the duration or the cache toggle does not.

## Repository Markers

Markers declared in the repository — `@testplanit case:123` comment annotations and entries in `.testplanit/testmap.yml` — become Code Pins on every cache refresh. See [Repository markers](../../impact.md#repository-markers) for the syntax. The card shows:

- **Last scan** — when markers were last scanned, or **Not scanned yet**. When a scan was skipped, the card says why: file caching is disabled, or file contents were only partially cached.
- A summary — how many annotations and map entries were found, and how many pins the scan created, updated, and removed.
- **Problems** — the count, with each problem listed: test case ids that do not exist or belong to another project, tags with no cases in the project, YAML errors, and invalid map entries. A scan that failed outright shows its error.

## Disconnecting

**Disconnect Repository** removes the connection after a confirmation that lists what is removed:

- every Code Pin for this repository (the dialog shows the count) and the project's analysis history for it;
- all cached repository files;
- the path pattern and branch configuration.

The registered repository itself is not affected, and the project's QuickScript connection is left alone.

## Related pages

- [Test Impact Analysis](../../impact.md) — running an analysis, reason badges, Code Pins, and repository markers.
- [Code Repositories (Administration)](../../code-repositories.md) — register the repositories selected here.
- [QuickScript (Project Settings)](quickscript.md) — the project's other repository connection, for test automation code.

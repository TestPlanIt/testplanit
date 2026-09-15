---
sidebar_label: 'Impact Analysis'
title: 'Impact Analysis (Project Settings)'
description: Enable test impact analysis for a project and connect the repositories of the application under test — branch, path patterns, cache, and repository markers for each
---

# Impact Analysis

The project-level **Settings → Impact Analysis** page enables [test impact analysis](../../impact.md) for a project and connects the **application repositories** behind it — the repositories of the application under test, whose commits are compared and whose files test cases are pinned to.

:::note
Only system administrators and project administrators can open this page. Repositories are registered globally by a system administrator; this page selects and configures them for the project.
:::

The **Connected Repositories** card counts the project's Code Pins in its title, and each connection lists how many of them it holds. A project can connect **more than one** repository. When the application is spread across several services in separate repositories but tested under one project, connect each repository: every connection keeps its own branch, path patterns, cache, and Code Pins, and each analysis compares two commits of one of them.

These are separate connections from the one on the [QuickScript](quickscript.md) page: QuickScript points at test automation code, Impact Analysis points at the application under test. A project can use the same repository for both, or different ones.

## How to access

1. Open the project and expand **Settings** in the project menu.
2. Select **Impact Analysis**.

## Enable Impact Analysis

The **Enable Impact Analysis** toggle controls whether team members see **Analyze impact** when composing a test run and the **Code Pins** panel on test case pages. The toggle applies immediately; each repository connection is saved with **Save Configuration**.

## Connected Repositories

The page lists every connection as a card: the **Repository** (with its provider and branch, or **Repository default branch**), its **Cache** state — **Never fetched**, **Refreshing...**, the file count and time of the last fetch, **Error**, or **Caching off** — and its **Linked tickets** state — the last scan's pin count and time, a running scan, or **Not scanned yet**. The cards keep updating while a refresh or scan runs. Each card offers three actions:

- **View connection** opens the connection read-only. Every setting is shown, and the operational buttons — **Refresh Cache**, **Rescan Recent Commits**, **Scan Full History**, **Cancel Scan** — still work from here. **Edit** in the dialog's footer switches it to edit mode.
- **Edit connection** opens the same dialog with the settings editable; **Save Configuration** writes the changes and closes it.
- **Disconnect Repository** asks for confirmation and removes the connection (see [Disconnecting](#disconnecting)).

**Connect Repository** opens the dialog for a new connection. A repository can be connected to a project once for Impact, so it only offers repositories that are not connected yet; when every registered repository is already connected, the button is disabled. With nothing connected, the card list is empty and the button is the way in.

The sections below describe the dialog.

## Application Repository

- **Code Repository** — select an active repository a system administrator registered under [Administration → Code Repositories](../../code-repositories.md). If none exist, an empty state links administrators to set one up. Repositories already connected to this project are not offered again.
- **Branch** — a searchable list of the repository's branches, with **Repository default branch** as the first option. The list holds the first 500 branches; when the repository has more, a note under the field says so and typing searches the whole repository through the provider. When the branches cannot be listed, a notice shows the provider's error and the field becomes a text box: type the branch name, or leave it blank to use the repository's default branch.

Commits are picked from this branch in the Impact dialog, and Code Pins are anchored at its tip.

## Path Patterns

One or more rows combining a base **Path** with a glob **Pattern** decide which application files Impact works with — the files offered in the Code Pin file picker, scanned for repository markers, and cached. For example, path `src` with pattern `**/*` includes everything under `src`. Leave the path blank, or enter `.`, to start at the repository root; path `.` with pattern `**/*` includes every file in the repository. Use **Add Path** to add rows.

**Preview Files** resolves the branch and patterns and lists the matching files with their count, showing progress while the repository is scanned and retrying when the provider rate-limits the request. A **Results may be incomplete (provider limit)** badge appears when the provider capped the listing.

## Cache Settings

Repository file listings and contents are cached (in Valkey) so the Code Pin file picker and repository marker scans stay fast:

- **Enable file caching** — on by default. When off, repository markers and linked tickets are **not scanned**, and the Code Pin file picker lists files live from the provider each time it opens.
- **Cache for N days** — how long the cache is kept before it is refreshed (1–30 days, default 7).
- **Cache Status** — **Never fetched**, **Refreshing...**, or the **Last Fetched** time with **Files Cached**, **Contents Cached**, and **Total Size**. If only some contents were cached — for example after a provider rate limit — a warning asks you to refresh again to complete.
- **Refresh Cache** — re-fetches the file list and contents now, and re-scans repository markers and linked tickets when it finishes. The refresh runs in the background, and the page updates when it completes.

Click **Save Configuration** (or **Connect Repository** for a new connection) to persist it; the dialog closes and the card shows the result. Changing the repository, branch, or path patterns invalidates the cache; changing only the duration or the cache toggle does not.

Saving a connection whose files have never been fetched — a new connection, or one whose repository, branch, or path patterns just changed — starts the first cache refresh on its own, with file caching on. That refresh also scans repository markers and linked tickets, so the feature has Code Pins and a file list to work with without a separate **Refresh Cache** click. The page reports the refresh's progress and outcome as it would for a manual one.

## Linked Tickets

Commits on the configured branch that name a ticket (`PROJ-123`, `#42`, `AB#42`) become Code Pins with the **Ticket** source on every test case linked to that ticket — symbol pins on the functions or classes the commit changed where its diff shows them, whole-file pins otherwise — so later changes to that code find the cases again. See [Linked tickets](../../impact.md#linked-tickets) for how keys are read and which files are pinned. The card holds:

- **Derive Code Pins from commit messages** — on by default. The scan runs on every cache refresh, after repository markers. Turning it off stops the refresh-time scan; analyses still read ticket keys from the commits they compare, and the manual scans below still run. Saved with **Save Configuration**.
- Every scan also **imports the tickets the commits name** that TestPlanIt does not hold yet: each is fetched from the project's issue tracker and created as an issue, the same way the case importer resolves ticket keys. An imported ticket arrives with no test case links, so it selects nothing until a case is linked to it; the point is that it is there to link. A project with no active issue tracker, or with several, imports nothing.
- **Rescan Recent Commits** — runs the same scan the cache refresh runs (recent commits only) without re-fetching the file cache.
- **Scan Full History** — walks every commit on the branch, from its tip to the first commit, and backfills ticket pins and imports for existing tickets. Use it once after connecting a repository, and again after linking a batch of older tickets to cases. It can take a while on a large repository; the card shows how many commits have been read and how many matching commits have been inspected while it runs, and the page keeps following the scan if you leave and come back. Commits already read are kept in a per-branch commit cache (in Valkey, for 30 days from the last scan), so a later scan reads only the commits newer than the last one and a full scan that stopped at the commit cap continues from where it stopped on the next run; the summary says how many commits the cache answered for. A walk that stops at the cap says so. The cap is a deployment setting (`IMPACT_ISSUE_SCAN_FULL_MAX_COMMITS`, 20,000 by default) and bounds what one run reads; each further run reads up to that many older commits until the branch start is reached. The commit cache holds at most 100,000 commits per branch, so a longer branch is never walked past that point. If the branch is rewritten (a force-push), the next scan notices that the cached commits are no longer reachable from the tip and starts over.
- **Cancel Scan** — shown while a scan runs. A scan still waiting in the queue is dropped at once; a running one stops at its next step (the next page of commits, the next round of tracker lookups, or the next commit inspected). Commits already read stay in the commit cache and tickets already imported stay, but pins are not updated by a cancelled scan.
- **Last scan** — when commits were last scanned, or **Not scanned yet**, with a **Full history** badge when the last scan was a full one; a cancelled scan says so.
- A summary in two lines. The first counts commits: how many were read, how many named any ticket, and how many distinct tickets they named. The second counts pins: how many commits named a ticket that is **linked to a test case** (only those create pins), and how many pins were created, updated, and removed. When commits name tickets but none is linked, a note says so: link cases to the imported tickets, then rescan.
- Imports — how many tickets were imported, how many the tracker refused or could not find (each listed with the tracker's reason, up to 25), and how many were not looked up yet because one scan makes a limited number of tracker lookups. Tickets already imported are skipped on the next scan, so running the scan again continues with the rest. A ticket another project already pulled in from the same tracker is already in TestPlanIt and is not fetched again; link it from this project's cases as usual. For Jira, only keys whose prefix is one of the tracker's projects are looked up, so words that merely look like ticket keys (`PHASE-33`, `ID-24`) cost nothing; when the project list cannot be read, the prefixes of tickets already imported stand in. A key the tracker now knows under a different name (the ticket was moved or renamed) is counted separately, since the ticket is already here under its current key. What remains is a key the tracker does not have or will not show to the integration's account.
- Caps — a note when only the newest commits were read (the recent-window cap; **Scan Full History** reads older ones), and a separate note when not every commit naming a linked ticket had its files read in one pass; those are picked up on the next scan. A commit that touched too many files to pin is counted as skipped. A scan that failed outright shows its error.

The refresh-time scan needs file caching to be on, because it runs as part of the cache refresh. The manual scans read the repository directly and do not need the cache.

Which pins a scan removes depends on what it walked: a pin whose commit the scan reached but that no longer yields it (the ticket was unlinked, the case archived) is removed; a pin anchored at an older commit than the scan reached is kept, so a full-history backfill survives the recent-window scans that follow it. Only a full scan that reached the start of the branch removes pins whose commit is no longer on it.

## Repository Markers

Markers declared in the repository — `@testplanit case:123` comment annotations and entries in `.testplanit/testmap.yml` — become Code Pins on every cache refresh. See [Repository markers](../../impact.md#repository-markers) for the syntax. The card shows:

- **Last scan** — when markers were last scanned, or **Not scanned yet**. When a scan was skipped, the card says why: file caching is disabled, or file contents were only partially cached.
- A summary — how many annotations and map entries were found, and how many pins the scan created, updated, and removed.
- **Problems** — the count, with each problem listed: test case ids that do not exist or belong to another project, tags with no cases in the project, YAML errors, and invalid map entries. A scan that failed outright shows its error.

## Disconnecting

**Disconnect Repository** on the connection's card removes that connection after a confirmation that lists what is removed:

- every Code Pin for this repository (the dialog shows the count) and the project's analysis history for it;
- all cached repository files;
- the path pattern and branch configuration.

The registered repository itself is not affected, and the project's other Impact connections and its QuickScript connection are left alone.

## Related pages

- [Test Impact Analysis](../../impact.md) — running an analysis, reason badges, Code Pins, and repository markers.
- [Code Repositories (Administration)](../../code-repositories.md) — register the repositories connected here.
- [QuickScript (Project Settings)](quickscript.md) — the project's other repository connection, for test automation code.

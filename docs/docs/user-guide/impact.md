---
sidebar_label: 'Impact'
title: 'Test Impact Analysis'
description: Compare two commits of the application under test and select the Affected Tests, working from the git diff alone with no instrumentation
---

# Test Impact Analysis

**Impact** reads the repository of the application under test, compares two commits, and lists the **Affected Tests** — the test cases in your repository that the changes between those commits touch. It works from the git diff alone: TestPlanIt needs read access to the repository and nothing else. There is no coverage agent, build step, or instrumentation of the application.

Every affected test shows why it was selected. The signals, in the order they are applied:

- **Code Pins** — links from a test case to a file, line range, symbol, or glob pattern, added on the test case page or declared in the repository itself.
- **Path matching** — the changed paths and symbols compared with test case names, content, tags, and folders.
- **Run history** — earlier runs composed from an analysis of overlapping changes.
- **AI** — an LLM ranks the remaining candidates against a summary of the diff, when the project has an active LLM integration.

## Prerequisites

- A code repository registered by a system administrator under [Administration → Code Repositories](code-repositories.md).
- The project's [Impact settings](projects/settings/impact.md) page with **Enable Impact** turned on and an **Application Repository** connected.
- Optionally, an active [LLM integration](llm-integrations.md) for the project. Without one, the analysis runs on Code Pins, path matching, and run history only.

## Running an analysis

**View impact** appears next to **Magic Select** in step 2 of [Add Test Run](projects/add-test-run-modal.md) and, for an existing run, in the cases section header of [Edit mode](projects/run-details.md#left-panel-content). The button is hidden while Impact is disabled for the project, and disabled — with a tooltip pointing to project settings — while Impact is enabled but no application repository is connected.

Clicking it opens the **Impact** dialog, which walks through four steps.

### 1. Commits

Choose the branch, then the two commits to compare:

- **Base commit** and **Head commit** — searchable pickers over the branch's commits. Type part of a commit sha, or filter the loaded commits by message or author.
- **Or paste a ref** — enter any branch, tag, or sha under either picker. A ref the repository does not know is reported as **Ref not found**.
- **Latest on _branch_** — a shortcut that fills in the tip of the selected branch as the head commit.
- **Start from a previous analysis** — lists recent analyses for the project (sha, date, and affected-test count). Choosing one sets the base to that analysis's head commit, so the new comparison starts where the last one ended.

Base and head must differ. If the base is ahead of the head, the two are swapped so the changes read forward, and a notice says so. Click **Compare** to load the changes.

### 2. Changes

A summary line shows how many files changed and the total lines added and removed. Each file is listed with:

- a status chip — **Added**, **Modified**, **Removed**, or **Renamed** (renamed files show the old and new path);
- the file's added and removed line counts;
- how many Code Pins touch the file, when any do.

**Show changes** expands one file at a time into a unified diff with old and new line numbers and syntax highlighting. Very large patches are collapsed behind **Show full patch**; binary files and files the provider returned without a patch are marked as such.

If the provider returned only part of the diff, a notice above the list says so: some changed files are not shown or have no patch, and the analysis works from what was returned.

Click **Analyze** to start the analysis, or **Back** to change the commits.

### 3. Analyze

The analysis runs in the background and reports its phases as it goes: resolving the repository configuration, fetching the diff, matching Code Pins, searching test cases by changed paths, scoring run history, waiting for AI (with batch progress when the candidates are split across several requests), and combining the results. **Cancel analysis** stops it and returns to the changes.

If the same two commits were analyzed within the last 24 hours, the completed analysis is shown again — a notice says so — instead of running a new one.

### 4. Affected Tests

The header counts the result ("12 affected tests"), and the list is sorted by score, highest first. Each row shows:

- a checkbox — every row is selected to start with; **Select all** and **Select none** change the whole list;
- the test case name, linked to the case;
- the **Score** (0–100) with a tier badge:
  - **Pinned** — a Code Pin on the case intersects the change. Pins always rank first.
  - **Affected** — the other signals put the case at or above the affected threshold.
  - **Related** — a case linked to a strongly affected case, or one whose signals are weaker.
- **Why** — one reason badge per signal that selected the case: **Pin**, **Path**, **History**, **AI**, or **Related**. Hover a badge for its detail; **Show reasons** expands the row with the full list, including the AI's rationale.

Cases that are already in the run — or already selected while creating one — are left out, and a note says how many were skipped. When AI ran, a short **Summary** of the change and the number of tokens used appear with the list.

Click **Add N cases** to add the checked cases to the current selection. They merge with whatever was already selected, so nothing you picked by hand is lost. **Analyze again** runs a fresh analysis; **Back to changes** returns to the file list.

When nothing matches, the step says **No affected tests found** and suggests pinning cases to the changed files so the next analysis finds them.

## What the reasons mean

- **Pin** — a Code Pin on the case intersects the change. The detail names the pinned location: `path:12–40` for a line range, the file path for a whole-file pin, the symbol name, or the glob pattern that matched.
- **Path** — the case's name, content, tags, or folder echo the changed paths and symbols. The detail shows the matched term and the field it was found in (for example, Matched "checkout" in case name).
- **History** — the case ran, or failed, in an earlier run that was composed from an analysis with overlapping changes. A failure after similar changes scores higher than a plain run, and so does a case that was added by hand to such a run.
- **AI** — the LLM judged the case relevant to the diff. The detail is the model's rationale for that case.
- **Related** — the case is linked to a strongly affected case through a test case link. The detail names the case it is linked to.

A case can carry several badges; its score is the strongest of its signals, and all of its reasons stay visible.

## Stale pins and uncovered files

**Stale pins.** A Code Pin whose lines or symbol cannot be found at the base commit still selects its case, but only at file level, and the row carries a **Stale** warning badge. A notice below the list counts the stale pins and points you to the test case page to re-anchor them (see [Stale pins](#stale-pins) below).

**Uncovered files.** A callout below the list names the changed files that no test case covers — no pin, path match, history, or AI selection reached them. **Pin a case…** next to a file opens the add-pin dialog with a test case picker, pre-filled with that file. Saving the pin marks the file **Pinned** and selects that case in the list, so the gap is closed in the same pass.

## Notices you may see

| Notice | Meaning |
| --- | --- |
| The provider returned a partial diff. | The repository provider capped the comparison. Files past the cap are not listed, or are listed without a patch, and the analysis covers only what was returned. |
| Only part of the diff fit the AI context; N files were summarized by path only. | The diff was larger than the AI's context budget. The AI saw full changes for the first files and only paths for the rest; the other signals are unaffected. |
| No active LLM integration: AI ranking was skipped. | The project has no active LLM integration. Results come from Code Pins, path matching, and run history only. |
| Search index unavailable: path matching used the database. | Elasticsearch was not reachable, so path matching fell back to test case names in the database. Matches on case content may be missed. |
| N AI batches were cut off by the model. | The model's reply was truncated. Cases in the cut-off part may be missing from the AI signal. |
| Some AI batches failed; results may be incomplete. | One or more AI requests failed after retries; the results of the other batches are kept. |
| Some pinned files were matched by path only (fetch limit reached). | Too many pinned files needed their base-commit content to locate lines or symbols; those past the limit were matched at file level. |
| No test case matched. | No signal selected any case. |
| Reusing a recent analysis of the same commits. | The same base and head were analyzed within the last 24 hours, so that result is shown instead of running again. |

## Code Pins

A **Code Pin** links a test case to the code it covers. Any change inside a pinned block pulls the case into an analysis with the **Pin** reason, ahead of everything else. Pins are managed from the **Code Pins** panel on the [test case page](projects/repository-case-details.mdx#code-pins); the same panel is read-only when a case is opened from within a test run.

### Kinds of pin

| Kind | Pins the case to |
| --- | --- |
| **Whole file** | A single file. Any change to the file matches. |
| **Lines** | A range of lines in a file. A change that overlaps the range matches. The lines are located again on every analysis, so the pin follows the code as it moves. |
| **Symbol** | A function, class, or other declaration, located by name in the file. A change inside the declaration's block matches. |
| **Glob pattern** | Every file matching a pattern such as `src/payments/**`. Useful for a module or a directory. |

### Adding a pin

1. On the test case page, click **Add pin** in the Code Pins panel.
2. Choose the kind under **Pin to**.
3. For file, line, and symbol pins, pick the **File** from the cached file list (type to filter). The picker shows how many files are cached and when. If no list is cached yet, ask a project admin to refresh the repository cache; with file caching turned off, files are listed live from the provider instead.
4. For **Lines**, the file opens in a viewer with numbered lines: click a line number to start the range and shift-click another to extend it, or type the **Start line** and **End line**. Files too large to display take line numbers only.
5. For **Symbol**, type the declaration's name; it is located by name in the file.
6. For **Glob pattern**, type the pattern. A live count shows how many cached files match.
7. Optionally add a **Note** explaining why the case covers this code, then click **Add pin**.

A pin is anchored at the current tip of the configured branch, and the panel shows the anchoring commit. A pin that already exists for the case is refused as a duplicate. The dialog also reports a file that does not exist at the branch tip, a line range outside the file, a symbol it cannot find, and a pinned block that is too large.

### The panel

Each pin lists its **Location** (path and `L12–L40`, symbol, glob, or **Whole file**), **Kind**, **Source**, note, and anchoring commit. The **Source** badge shows where the pin came from:

- **Manual** — added from the test case page.
- **AI** — suggested by an analysis rather than entered by hand.
- **Annotation** — a comment marker in the repository (see [Repository markers](#repository-markers)).
- **Map file** — an entry in the repository's `.testplanit/testmap.yml`.

Repository-managed pins (**Annotation** and **Map file**) are edited in the repository, not in TestPlanIt: the panel shows them read-only, and they are updated or removed on the next cache refresh when the marker changes or disappears. **Remove** (with confirmation) is available for pins added in TestPlanIt.

### Stale pins

Pins are checked against the branch tip whenever the panel loads. A pin whose file has been deleted, whose lines can no longer be found, or whose symbol no longer exists in the file shows a **Stale** badge; the tooltip names the reason. Two actions are offered:

- **Re-anchor** — locates the block again at the current branch tip and records the new position. Use it after code has moved.
- **Dismiss** — hides the badge for this pin until it is re-anchored.

A stale pin still matches at file level in analyses, so its case is not lost; re-anchoring restores line-level precision.

## Repository markers

Instead of adding pins one by one in TestPlanIt, a repository can declare them in its own files. Markers are scanned on every repository cache refresh — the automatic one, or **Refresh Cache** on the Impact settings page — and the resulting pins carry the **Annotation** or **Map file** source. Scanning requires file caching to be enabled on the [Impact settings](projects/settings/impact.md#repository-markers) page; that page's **Repository Markers** card shows the last scan, its counts, and any problems.

### Comment annotations

Place `@testplanit case:<id>` in a comment directly above the function, class, or block it covers. The id is the test case's numeric id in TestPlanIt; list several with commas.

```ts
// @testplanit case:123,124
export function calculateTotal(items: LineItem[]) {
  // ...
}
```

Any comment style works — `//`, `#`, `/* */`, `<!-- -->`, `--`, or a docstring — because the scanner looks for the marker text on the line. The pin covers the marker line through the end of the block that follows: a brace-delimited body, or an indented block for languages without braces. A marker with no code beneath it pins the whole file.

### Map file

Create `.testplanit/testmap.yml` (or `.yaml`) at the repository root with a `pins` list. Each entry names a `glob` and the `cases` (test case ids) and/or `tags` (test case tag names) it covers, with an optional `note`:

```yaml
pins:
  - glob: src/payments/**
    cases: [12, 34]
    note: Checkout and refund flows
  - glob: src/auth/*.ts
    tags: [auth]
```

Each entry becomes one glob pin per case. Tags are resolved when the file is scanned, to the cases carrying that tag in the project at that moment.

The scan reports these problems on the settings page: a test case id that does not exist, an id that belongs to another project, a tag with no cases in the project, a YAML syntax error, and an entry without a glob or without any cases or tags. Valid entries are still applied when others have problems.

## Tips

- Pin the specific block rather than the whole file when you can. A line range or symbol pin only fires when its own code changes, which keeps the Affected Tests list precise.
- Use glob pins for modules: one `src/payments/**` pin on a checkout case catches every file in the module without listing them.
- Keep an LLM integration active so the AI signal covers unpinned code. Pins and path matching find what is declared or named; the AI reads the diff and catches the rest.
- Check the uncovered-files callout after each analysis. Pinning from it is the quickest way to grow coverage.

## Related pages

- [Impact (Project Settings)](projects/settings/impact.md) — enable Impact and connect the application repository.
- [Code Repositories](code-repositories.md) — register the repositories a project can connect.
- [Test Case Details](projects/repository-case-details.mdx#code-pins) — the Code Pins panel.
- [Add Test Run](projects/add-test-run-modal.md) and [Test Run Details](projects/run-details.md) — where **View impact** appears.
- [Magic Select](llm-magic-select.md) — AI test case selection from the run's own description.
- [Background Processes](/docs/background-processes) — the worker that runs analyses.

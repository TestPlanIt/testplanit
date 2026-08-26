---
sidebar_label: 'Requirements'
title: 'Requirements'
description: Build a per-project requirements tree, sync requirements from your issue tracker, and link test cases to them for coverage
---

# Requirements

The Requirements page gives a project a tree of what the system should do. Requirements can be authored directly in TestPlanIt, ingested from your issue tracker (currently classified from synced issues), or a mix of both. Test cases link to requirements from either side, and each requirement rolls up the execution state of every case covering it — see [Requirement Coverage & Traceability](./requirements-traceability.md) for how coverage, suspect flags, and the traceability reports work.

## Enabling Requirements

Requirements is off by default. Two independent settings control it — one classifies which tracker issues count as requirements, the other turns the feature on for the project. Neither implies the other:

1. **Classify requirement types** (for tracker-synced requirements). On **Project Settings → Issue Integrations**, the **Requirement Types** section lets you choose which tracker issue types count as requirements. Turn on **Enable requirement classification**, pick the issue types (for example Epic, Story, or a custom Requirement type), and save. Before you save, the section previews the impact — how many existing issues will become requirements, or stop being requirements — and notes that re-adding a type restores the classification; nothing is deleted. The section appears for Jira, Azure DevOps, GitLab, Redmine, and MantisBT integrations.
2. **Enable requirements for the project.** On **Project Settings → Advanced**, turn on **Enable requirements**.

Classification alone shows nothing: until the project toggle is on there is no Requirements area at all, and a direct link to the page shows **Requirements Aren't Enabled**. The project toggle alone shows an empty tree: you can author requirements natively, but nothing arrives from the tracker until requirement types are classified.

:::info Permissions Required
Both settings pages are restricted to system administrators and project administrators. See the [Permissions Guide](../permissions-guide.md).
:::

:::note For administrators upgrading an existing deployment
Requirements are part of the Elasticsearch issue index. After upgrading a deployment to a version with requirements, run a reindex from **Administration → [Search Engine](../search-engine.md)** so requirement data on existing issues is indexed and searchable.
:::

Once enabled, a **Requirements** entry appears in the project menu.

## The Requirements Page

Navigate to **Projects → [Your Project] → Requirements**. The page is a resizable two-panel layout:

* **Left panel:** the requirements list — a tree table of every requirement in the project.
* **Right panel:** the detail panel for the selected requirement (until you select one, it prompts you to do so).

Drag the divider to resize the split, or use the chevron button on the divider to collapse and restore the list. The page header carries two actions:

* **Export PDF** — downloads the project's requirement traceability matrix as a PDF (see [PDF export](./requirements-traceability.md#pdf-export)).
* **Add Requirement** — opens the Create Requirement dialog (project administrators only).

### The requirements list

Each row shows the requirement's name — for a synced requirement, the tracker key followed by its summary (for example `PROJ-42: Login lockout policy`). Rows with children carry a chevron to expand and collapse the subtree; everything starts collapsed. Clicking a row opens it in the detail panel.

The available columns:

* **Name** — the requirement, with its issue-type icon, indentation showing its depth in the tree, and a drag grip for reorganizing.
* **Status** — the requirement's status as a badge (see [Status display](#status-display)).
* **Priority** — the requirement's priority.
* **Coverage** — the rollup of the covering cases' latest results, or a dashed **Uncovered** badge (see [Coverage](./requirements-traceability.md#coverage)).
* **Covering Test Cases** — how many cases cover the requirement, including cases linked anywhere beneath it. Clicking the count opens the list; a separate **+N** count covers cases from other projects.
* **Linked Test Cases** — how many cases are linked directly to this requirement, with the same click-to-list and **+N** behavior.
* **Source** — the provenance badge: **Manual**, **Synced**, or **Detached** (see [Provenance](#provenance-manual-synced-and-detached)).
* **Created At** — hidden by default; show it via the **Columns** control.
* **Actions** — the row menu.

Above the table:

* A **Search requirements...** box narrows the tree to requirements whose name matches. Matches keep their ancestors visible (and, while only the text filter is active, their descendants too), so you always see where a match sits in the tree.
* Three filter dropdowns — **All coverage** (Uncovered, Has untested cases, or a specific result status), **All statuses**, and **All sources** (**Manual**, **Synced**, **Detached**). Active filters intersect with each other and with the search text.
* The **Columns** control chooses which columns are visible; your choice is remembered.

Column headers sort the list; the default order is by name.

### Row actions

Each row's actions menu offers:

* **Add Child Requirement** — opens the Create Requirement dialog with this row preset as the parent.
* **Rename** — renames the requirement in place. Disabled on a synced requirement: *"This requirement is synced from the connected tracker. Detach it to rename."*
* **Delete** — opens the delete confirmation (see [Deleting requirements](#deleting-requirements)).

:::info Permissions Required
Creating, renaming, moving, detaching, and deleting requirements require project administrator status — the project creator, a user with the **Project Admin** role on the project, or `PROJECTADMIN`/`ADMIN` system access. Linking and unlinking test cases (and dismissing suspect flags) instead follows the same permission as editing test cases: `Add/Edit` for the `TestCaseRepository` application area. See the [Permissions Guide](../permissions-guide.md).
:::

## Creating Requirements

Click **Add Requirement** in the page header (or the empty tree's own **Add Requirement** button) to create a top-level requirement, or use a row's **Add Child Requirement** action to create one beneath it. The **Create Requirement** dialog shows:

* **Parent** — the parent requirement, or *"No parent (top level)"*. This is set by where you opened the dialog and is not editable here; you can move the requirement later by drag and drop.
* **Name** — required. Press Enter or click **Create Requirement** to save.
* **References** — optionally attach issues that shaped this requirement while creating it (see [References](./requirements-traceability.md#references)).

Requirements created this way are fully editable and carry the **Manual** source badge.

## Organizing the Tree

Requirements form a hierarchy, and manual and detached requirements can be reorganized by drag and drop: drag a row by its grip and drop it onto another requirement to nest it there, or onto the *"Drop here to move to the top level"* strip at the bottom of the list to make it a root. Invalid moves (for example, dropping a requirement into its own subtree) are rejected with a message and nothing changes.

Synced requirements mirror the tracker's own parent/child structure — its epics, stories, and sub-tasks — and cannot be moved while synced. Their drag grip is disabled with the hint *"Synced requirements mirror the tracker's hierarchy. Detach to move it."*

Drag and drop is unavailable while the search box has text in it; clear the search first.

## Provenance: Manual, Synced, and Detached

Every requirement carries a source badge — in the list's **Source** column and in the detail panel header:

| Badge | Meaning |
| --- | --- |
| **Manual** | Created directly in TestPlanIt. Fully editable. |
| **Synced** | Synced from the connected tracker. The tracker owns its title, description, status, priority, and parent — those fields show the tracker's values and can't be edited here. |
| **Detached** | Previously synced, released to local ownership. Fully editable, like a manual requirement, but keeps its tracker badge as a reference to where it came from. |

A synced or detached requirement's badge links out: hover it and click the link icon (or use **Open in Issue Tracker** from the badge's menu) to open the original issue in the tracker.

On a **Synced** requirement, the tracker-owned fields show a hint when you try to edit them: *"This field is managed by the connected tracker and can't be edited here."* Everything TestPlanIt adds on top stays editable regardless — the **Documentation** editor, attachments, linked test cases, and references all work the same on a synced requirement as on a manual one.

### Status display

A **Synced** requirement shows the tracker's status everywhere — in the list, the status filter, and the detail panel. A **Detached** (or **Manual**) requirement shows its local TestPlanIt status instead, since that's the field you can actually edit.

### How synced requirements arrive

Any tracker issue that reaches TestPlanIt — through issue sync, an inbound webhook, a bulk import, or being linked to a test artifact — is classified against the project's configured requirement types. Matching issues appear in the requirements tree; changing the classification later reclassifies existing issues to match. Subsequent syncs keep a synced requirement's tracker-owned fields and its position in the hierarchy up to date.

### Detaching a requirement

A project administrator can release a synced requirement to local ownership: click the **Synced** badge and choose **Detach**. The confirmation explains the consequences: *"Detaching makes this requirement fully editable in TestPlanIt and breaks its link to the connected tracker. This can't be undone — re-attaching to the tracker isn't supported yet."* Detaching is one-way.

## The Detail Panel

Selecting a requirement opens its details beside the list. The header shows the requirement's name, its source badge, and an **Edit** button; the body shows:

* **Title** — shown only when the requirement has a summary distinct from its name (typical for synced requirements).
* **Status** and **Priority** — rendered as badges in display mode, editable fields in edit mode (locked on synced requirements).
* **Documentation** — a rich-text editor for the requirement's supporting documentation. Editable on every requirement, including synced ones.

Click **Edit** to switch the panel into edit mode, then **Save** to apply your changes or **Cancel** to discard them. A **Delete** button also appears in edit mode.

### Attachments

The **Attachments** section works like test case attachments:

* In display mode, attachments are view-only — click one to open it larger in the attachment viewer and step through the rest.
* In edit mode, you can add and remove attachments. Changes are staged with the rest of your edits: **Cancel** discards them, **Save** applies them.

Attachments work the same on synced requirements.

## Linking Test Cases

Test cases and requirements link to each other symmetrically, and the same link is visible from both sides:

* **From the requirement:** the **Linked Test Cases** panel in the detail panel lists every case linked directly to this requirement. Click **Add Link** to open the **Link Test Cases** dialog and search for a case — the search spans every project you can access, with each result's project shown. The **Remove** action unlinks a case after confirmation.
* **From the test case:** the **Linked Requirements** panel on the [Test Case Details](./repository-case-details.mdx) page lists the requirements the case is linked to, each with its source badge. **Add Link** opens the **Link Requirements** dialog, scoped to the case's own project.

Linked cases drive the requirement's coverage rollup, and each link can carry a **Suspect** flag when the requirement changes after the case's last run — see [Requirement Coverage & Traceability](./requirements-traceability.md).

## Deleting Requirements

Delete a requirement from its row's **Delete** action, or from the **Delete** button in the detail panel's edit mode. Deleting cascades through the subtree, and the confirmation states exactly what that means — for a requirement with children: *"This requirement has N descendants that will also be deleted. This action can be undone."*

Deletion is a soft delete: a system administrator can restore deleted requirements (they are issue records) from the [Trash](../trash.md).

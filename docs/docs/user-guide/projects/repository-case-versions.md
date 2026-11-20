---
title: Test Case Versions
sidebar_position: 3 # Position after Test Case Details
---

# Test Case Versions Page

This page allows you to view historical versions of a specific test case, showing exactly how it looked at different points in time. Every time a test case is saved after editing, a new version is created.

You access this page using the **Version Selector** dropdown located in the header of the [Test Case Details](./repository-case-details.mdx) page.

## Layout and Navigation

The layout is identical to the Test Case Details page (resizable two-panel view), but it is **read-only**.

- **Header**: Includes navigation controls:
  - **Version Selector**: Dropdown to jump directly to any available version. Each version lists its creation date/time.
  - **Previous/Next Buttons**: Arrows to navigate sequentially through versions.
  - **Back to Latest**: A link (usually on the version number) to return to the main Test Case Details page (which always shows the latest version).
- **Content Panels**: Display all fields (dynamic fields in the left panel, standard fields like Estimate, Automated, Tags, Attachments in the right panel) exactly as they were saved for the selected version.

## Viewing Differences

When viewing any version _except the very first one (Version 1)_, the page highlights the differences between the currently viewed version and the one immediately preceding it:

- **Fields**: Changed values are typically shown with:
  - The previous value struck through or highlighted in red (with a minus icon).
  - The new value (for this version) highlighted in green (with a plus icon).
- **Steps**: Modifications, additions, or deletions to steps or expected results are highlighted similarly.
- **Tags**: Differences are explicitly shown, listing tags that were **Added**, **Removed**, or remained the **Common** between the two versions.
- **Attachments**: Differences in attached files might be indicated.

This allows you to easily track the evolution of a test case and understand what specific changes were made between edits.

## Going Back to an Earlier Version

The versions page does not change the test case. To bring an earlier version back, edit the test case and use the **Load values from version** menu, which fills the edit form with that version's content for you to save as a new version. See [Loading an Earlier Version](./repository-case-details.mdx#loading-an-earlier-version).

## Metadata

The right panel also displays metadata specific to the version being viewed:

- **Version _N_**: **Created At** is the date and time the version being viewed was saved.
- **Version _N_ (Latest)**: For context, the same details for the most recent version, with a link to it.

**Created By** shows the user who created the test case, not the person who saved that version. To see who made a change, use the project's [Audit Log](./audit-log.md).

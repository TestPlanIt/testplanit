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

## Metadata

The right panel also displays metadata specific to the version being viewed:

- **Version Created**: The exact date and time this version was saved, and the user who saved it.
- **Latest Version Updated**: For context, the date, time, and user for the most recent save of the test case are also shown.

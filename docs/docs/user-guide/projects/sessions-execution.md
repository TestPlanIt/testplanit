---
title: Session Execution & Results
sidebar_position: 5 # After Session Versions
---

# Session Execution & Results

While a test session is active (not completed), you can record findings and statuses directly within the [Session Details](./sessions-details.md) page.

This process happens in the **Session Results** section located in the lower part of the left panel when viewing an active session.

## Recording Results

The main tool for recording findings is the **Add Result Form**. The exact fields available depend on the [Session Template](../templates-fields.md) used, but typically include:

1. **Status Selection**: Buttons or a dropdown to assign a status (e.g., Untested, Pass, Fail, Blocked, Skipped) to the finding or observation.
2. **Details/Notes**: A text area or rich-text editor to describe the finding, observation, issue encountered, or question raised.
3. **Attachments (Optional)**: An upload area to attach relevant files like screenshots or log files directly to this specific result entry.
4. **Submit**: A button to save the result entry (status, notes, attachments) to the session.

## Viewing Results

Below the Add Result Form is the **Results List**:

- **Chronological Order**: Results are displayed in the order they were added, usually with the newest at the top or bottom.
- **Content**: Each entry typically shows:
  - **Status**: The assigned status (e.g., Pass, Fail) often indicated by an icon or colored badge.
  - **Content Preview**: The beginning of the text/notes entered for the result.
  - **Creator**: The user who added the result.
  - **Timestamp**: When the result was added (e.g., "5 minutes ago").
  - **Attachments**: Indicators if files are attached to that specific result.
- **Filtering/Sorting**: Options may be available to filter the list by status or sort by time.

## Session Summary

Above the Add Result Form, a **Summary** provides a quick count of the different statuses recorded so far in the session (e.g., 5 Passed, 2 Failed, 1 Blocked).

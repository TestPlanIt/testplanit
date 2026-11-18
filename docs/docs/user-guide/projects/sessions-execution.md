---
title: Session Execution & Results
sidebar_position: 5 # After Session Versions
---

# Session Execution & Results

While a test session is active (not completed), you can record findings and statuses directly within the [Session Details](./sessions-details.md) page.

This process happens in the **Session Results** section located in the lower part of the left panel when viewing an active session.

## Recording Results

The main tool for recording findings is the **Add Result Form**. It contains:

1. **Details**: A rich-text editor to describe the finding, observation, issue encountered, or question raised.
2. **Status** (Required): A dropdown of the [statuses](../statuses.md) enabled for sessions.
3. **Elapsed**: The time spent on this result.
4. **Attachments (Optional)**: An upload area to attach relevant files like screenshots or log files directly to this specific result entry.
5. **Issues (Optional)**: Link issues to this result.
6. **Result fields**: Any result fields defined by the [Session Template](../templates-fields.md).
7. **Save**: Saves the result entry to the session.

## Viewing Results

Below the Add Result Form is the **Results List**:

- **Order**: Results are listed newest first.
- **Content**: Each entry shows:
  - **Status**: The assigned status, shown in its color.
  - **Content Preview**: The beginning of the text/notes entered for the result.
  - **Creator**: The user who added the result.
  - **Timestamp**: When the result was added (e.g., "5 minutes ago").
  - **Attachments**: Indicators if files are attached to that specific result.

## Session Summary

Above the Add Result Form, a **Summary** shows the results recorded so far as a segmented bar, colored by status and sized by elapsed time, with the total elapsed time against the session's estimate. A toggle arranges the bar by status or by date.

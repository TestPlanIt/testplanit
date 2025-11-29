---
sidebar_position: 2 # Adjust position as needed
title: Application Configuration
---

# Application Configuration

To access this page, enter the Administration area and select **Application Configuration** from the bottom of the left-hand navigation menu.

The Application Configuration section allows administrators to manage key-value pairs that control various application settings and behaviors. These settings might affect integrations, feature flags, or other system-wide parameters.

## Viewing Configurations

Upon navigating to the "App Config" page within the Administration area, you will see a table displaying the existing configuration settings. The table typically includes columns for:

- **Key:** The unique identifier for the configuration setting.
- **Value:** The current value assigned to the key.
- **Actions:** Button to edit the configuration item.

## Available Keys

Currently, the following configuration keys are available:

- **`Edit Results Duration`**

  - **Description:** This sets the amount of time (in seconds) that users are allowed to edit their test results after submitting them. Once this time period expires, the result becomes locked and cannot be modified.
  - **Value:** An integer representing the duration in seconds.
    - **Enter a positive value (e.g., `3600` for 1 hour, `86400` for 1 day) to enforce a time limit.**
    - **Enter `0` to prevent editing results immediately after submission.**
    - **Leave blank (or set to null/undefined via database if necessary) to allow editing results indefinitely.**

- **`Project Docs Default`**
  - **Description:** This defines the default content (in Tiptap JSON format) that is displayed in the Project Documentation section when no specific documentation has been created for that project yet.
  - **Value:** A JSON object representing the Tiptap document structure.

## Adding a New Configuration

1. Click the "Add Configuration" or "New Setting" button (the exact label may vary).
2. A form or dialog box will appear, prompting you to enter:
    - **Key:** A unique name for the new setting. This should be descriptive and follow any naming conventions (e.g., `integrations.email.provider`).
    - **Value:** The value you want to assign to this key.
3. Click "Save" or "Add" to create the new configuration item.

## Editing an Existing Configuration

1. Locate the configuration item you wish to modify in the table.
2. Click the "Edit" icon or button in the corresponding row.
3. A form or dialog box will appear, pre-filled with the current key and value.
4. Modify the **Value** field as needed. _Note: Typically, the Key is not editable after creation to maintain consistency._
5. Click "Save" or "Update" to apply the changes.

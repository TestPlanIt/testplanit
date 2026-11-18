---
sidebar_position: 2 # Adjust position as needed
title: Application Configuration
---

# Application Configuration

To access this page, enter the Administration area and select **Application Configuration** under **System** in the left-hand navigation menu.

The Application Configuration section allows administrators to manage key-value pairs that control various application settings and behaviors. These settings might affect integrations, feature flags, or other system-wide parameters.

## Viewing Configurations

Upon navigating to the **Application Configuration** page within the Administration area, you will see a table displaying the existing configuration settings. The table typically includes columns for:

- **Key:** The unique identifier for the configuration setting.
- **Value:** The current value assigned to the key.
- **Actions:** Buttons to edit or delete the configuration item.

## Available Keys

Most keys are written by their own administration pages and rarely need editing here. Keys you will commonly see:

- **`edit_results_duration`**

  - **Description:** The system-wide limit, in seconds, on how long after a result is recorded it can still be edited in place. Set it from the **Result editing policy** card on the [Statuses](./statuses.md) page.
  - **Value:** An integer representing the duration in seconds.
    - **A positive value (e.g., `3600` for 1 hour, `86400` for 1 day) is the maximum window. Projects can shorten it, or disable editing, in their Advanced settings.**
    - **`0` disables editing results everywhere; projects cannot override it.**
    - **When the key does not exist, there is no system-wide limit and each project decides in its Advanced settings.**
  - System administrators can always edit results.

- **`project_docs_default`**
  - **Description:** This defines the default content (in Tiptap JSON format) that is displayed in the Project Documentation section when no specific documentation has been created for that project yet.
  - **Value:** A JSON object representing the Tiptap document structure.

Other keys are maintained from the page that owns the setting:

| Key | Managed from |
| --- | --- |
| `notificationSettings` | Administration → Notifications |
| `elasticsearch_replicas` | Administration → Search Engine |
| `review_feature_enabled`, `review_reminder_threshold_days`, `revert_decision_duration` | Administration → Workflows |
| `abandoned_run_idle_minutes` | Administration → Statuses |
| `record_key_enabled`, `record_key_type_tokens` | Administration → Record Keys |
| `user_trash_restore_window_days` | Administration → Trash |
| `scim.defaultMappedAccess` | Administration → SCIM Provisioning |

## Adding a New Configuration

1. Click the **Add Application Configuration** button.
2. A dialog box will appear, prompting you to enter:
    - **Key:** A unique name for the new setting. This should be descriptive and follow any naming conventions (e.g., `integrations.email.provider`).
    - **Value:** The value you want to assign to this key. It must be valid JSON.
3. Click **Submit** to create the new configuration item.

## Editing an Existing Configuration

1. Locate the configuration item you wish to modify in the table.
2. Click the **Edit** icon in the corresponding row.
3. A dialog box will appear, showing the key and pre-filled with the current value.
4. Modify the **Value** field as needed. It must be valid JSON. The Key cannot be changed.
5. Click **Submit** to apply the changes.

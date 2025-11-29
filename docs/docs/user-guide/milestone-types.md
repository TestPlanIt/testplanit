---
sidebar_position: 5
---

# Milestone Types

Milestone Types are used to categorize Milestones within your Projects. They help organize your workflow and allow for easier filtering and identification of different milestone categories. Each Milestone Type can be assigned a unique icon for quick visual recognition.

## Accessing Milestone Types

You can manage Milestone Types from the Administration section:

1. Navigate to the **Administration** area using the main navigation menu.
2. Select **Milestone Types** from the Administration sub-menu.

## Viewing Milestone Types

The Milestone Types page displays a table listing all configured milestone types with the following columns:

- **Name**: The name of the Milestone Type, displayed alongside its chosen icon.
- **Projects**: Shows which Projects the Milestone Type is associated with. If a Milestone Type is marked as 'Default', it is implicitly available to all Projects. Otherwise, this column lists the specific Projects it's assigned to.
- **Default**: Indicates whether this Milestone Type is the default type. There can only be one default Milestone Type. Milestones associated with a deleted type will be reassigned to the default type.
- **Actions**: Provides options to **Edit** or **Delete** the Milestone Type.

## Adding a Milestone Type

1. Click the **Add Milestone Type** button located at the top right of the table.
2. A modal window will appear with the following fields:
    - **Icon**: Select an icon to represent the Milestone Type.
    - **Name**: Enter a descriptive name for the Milestone Type (e.g., "Design Review", "Client Approval", "Internal QA"). This field is required.
    - **Default Milestone Type**: Toggle this switch on if you want this type to be the default. If another type is currently the default, enabling this will automatically disable the default status for the other type.
3. Click **Save** to create the new Milestone Type.

## Editing a Milestone Type

1. Locate the Milestone Type you wish to modify in the table.
2. Click the **Edit** (pencil) icon in the **Actions** column for that row.
3. A modal window will appear, allowing you to change:
    - **Icon**: Select a different icon.
    - **Name**: Modify the name of the Milestone Type.
    - **Default Milestone Type**: Change the default status. Remember, only one type can be the default.
    - **Projects**: Assign or unassign the Milestone Type to specific projects. Note: If the Milestone Type is set as 'Default', it cannot be assigned to specific projects as it's automatically available to all. Unsetting the 'Default' toggle will enable project selection.
4. Click **Save** to apply the changes.

## Deleting a Milestone Type

:::warning Important
Deleting a Milestone Type is irreversible. Any Milestones currently assigned to the deleted type will be automatically reassigned to the **Default** Milestone Type. You cannot delete the **Default** Milestone Type.
:::

1. Locate the Milestone Type you wish to remove in the table.
2. Click the **Delete** (trash can) icon in the **Actions** column for that row.
3. A confirmation modal will appear. Confirm the deletion by clicking the appropriate button.

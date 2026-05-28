---
sidebar_position: 6
title: Configurations
---

# Configurations Administration

Configurations represent specific combinations of environmental or setup variables (Variants) grouped by Categories. They are often used to define test environments (e.g., Browser: Chrome, OS: Windows 11) or other matrix-based scenarios where tests need to be executed against multiple combinations.

This section explains how to manage Categories, their associated Variants, and the resulting Configurations.

To access this page, enter the Administration area and select **Configurations** from the left-hand navigation menu. The page displays two main tables: Categories and Configurations.

:::info Configurations are project-scoped
Each Configuration is associated with one or more Projects, and it only appears in the Test Run, Session, and Search pickers for the Projects it is assigned to. New Configurations start with no Project assignments and opt in to the Projects that should use them. Existing Configurations from before this change are assigned to every existing Project on upgrade so behaviour stays the same; new Projects start with no Configurations and pick the ones they need.
:::

## Categories & Variants

Categories group related Variants together (e.g., Category "Operating System" might have Variants "Windows 11", "macOS Sonoma", "Ubuntu 22.04").

### Viewing Categories and Variants

The Categories table lists all defined categories with columns for:

- **Name**: The name of the Category. Clicking the expand icon (▶️/▼) next to the name reveals the Variants within that Category.
- **Variants**: A count of active Variants within the Category. Hovering over the badge shows a popover list of Variant names, indicating whether each is enabled (✔️) or disabled (🚫).
- **Actions**: Buttons to **Edit** the Category name or **Delete** the Category.

### Adding a New Category

1. Click the **Add Category** button located above the Categories table.
2. An input field will appear below the table. Enter the name for the new Category.
3. Click **Submit** or press Enter.

### Editing a Category Name

1. Click the **Edit** icon in the Actions column for the desired Category.
2. Modify the name in the modal dialog.
3. Click **Submit**.

### Deleting a Category

:::warning Important
Deleting a Category is irreversible and will also **permanently delete all Variants within it AND all Configurations that use any of those Variants**. Proceed with extreme caution.
:::

1. Click the **Delete** icon in the Actions column for the desired Category.
2. A confirmation dialog will appear, emphasizing the consequences.
3. Confirm the deletion.

### Managing Variants within a Category

To manage Variants, first expand the Category row by clicking the expand icon (▶️) next to its name. This reveals a list of Variants and controls within the expanded area.

- **Viewing Variants**: Each variant is listed with:
  - A **Switch** to toggle its enabled/disabled status.
  - The **Variant Name**.
  - An **Edit** icon button.
  - A **Delete** icon button.
- **Adding a Variant:**
  1. Click the **Add Variant** (plus icon) button located within the expanded Category area.
  2. An input field will appear. Enter the name for the new Variant (e.g., "Chrome", "Firefox").
  3. Click the **Save** button or press Enter. Click **Cancel** or press Escape to discard.
- **Editing a Variant Name:**
  1. Click the **Edit** icon button next to the desired Variant name.
  2. A modal dialog will appear. Modify the name.
  3. Click **Save**.
- **Enabling/Disabling a Variant:**
  1. Use the **Switch** next to the Variant name to toggle its status.
  2. **Important:** Disabling a Variant prevents it from being used in new Configurations and **will automatically disable all existing Configurations that use this Variant**. A confirmation dialog will appear before disabling.
- **Deleting a Variant:**
  :::warning Important
  Deleting a Variant is irreversible and will also **permanently delete all Configurations that use this Variant**. Consider disabling the Variant instead if you might need it later or want to preserve related Configurations.
  :::
  1. Click the **Delete** icon button next to the desired Variant name.
  2. A confirmation dialog will appear.
  3. Confirm the deletion.

## Configurations

Configurations are specific combinations of enabled Variants, one from each relevant Category. They define the distinct environments or scenarios for testing.

### Viewing Configurations

The Configurations table lists all defined configurations with columns for:

- **Select**: A row checkbox used for [bulk actions](#bulk-actions). The header checkbox toggles the current page; **Shift+click** on the header toggles every Configuration that matches the current filter across all pages, and **Shift+click** on a row checkbox range-selects every row between the last clicked row and the current one.
- **Name**: The name of the Configuration, typically auto-generated as a comma-separated list of its Variants (e.g., "Chrome, Windows 11, English"). A switch allows enabling/disabling the Configuration. A Configuration is automatically disabled if any of its constituent Variants are disabled.
- **Variants**: A count of Variants included in this Configuration. Click the column header to sort by the variant count; hovering the badge shows a popover list of the variants.
- **Projects**: A count of Projects this Configuration is assigned to. Click the column header to sort by the project count; hovering the badge shows the project names and icons.
- **Actions**: Buttons to **Edit** the Configuration or **Delete** the Configuration.

Above the table:

- The **Filter configurations…** field narrows the list by name.
- The **All projects** selector restricts the table to Configurations assigned to a specific Project. Choose **All projects** to show every Configuration regardless of assignment.

### Bulk Actions

Selecting one or more rows reveals an **Edit N configurations** button next to the project filter. Clicking it opens a single dialog where you can apply any combination of the following to every selected Configuration:

- **Replace Projects**: Tick the **Projects** checkbox and pick the Projects the selected Configurations should be assigned to. Submitting *replaces* their existing assignments with the chosen set. Leave the checkbox unchecked to leave Project assignments untouched.
- **Set enabled state**: Tick the **Set enabled state** checkbox and use the switch to enable or disable every selected Configuration on submit. Leave the checkbox unchecked to leave the enabled state untouched.
- **Delete**: The destructive **Delete N configurations** button (with confirmation) marks every selected Configuration as deleted at once.

Clicking **Apply to N configurations** runs the selected changes; **Cancel** discards them.

### Adding New Configurations (Wizard)

Creating configurations involves picking Variants, choosing which combinations to create, and assigning the resulting Configurations to Projects. The wizard has four steps with a step indicator at the top; previous steps stay clickable so you can jump back without losing data.

1. Click the **Add Configurations** button above the Configurations table.
2. **Step 1 — Variants**
    - The dialog lists every Category and its enabled Variants in three columns sorted alphabetically. Expand/collapse a Category using the chevron next to its name.
    - Tick the Variants you want to include. Use **Select All** / **Deselect All** in the Category header to toggle a whole Category at once.
    - **Shift+click** a Variant checkbox to range-select every Variant between the last clicked one and this one within the same Category.
    - Click **Next** when at least one Variant is selected.
3. **Step 2 — Combinations**
    - The wizard generates every possible unique combination of the Variants you picked (one Variant per Category involved).
    - Combinations that already match a saved Configuration are kept in the list, but rendered with a disabled checkbox and an *(already exists)* hint so you can see what is already configured without leaving the wizard.
    - New combinations default to checked; uncheck any you don't want to create.
    - If every derived combination already exists, the wizard tells you so.
    - Click **Next**.
4. **Step 3 — Assign Projects**
    - Pick the Projects the new Configurations should be available in. Projects are listed in three columns with their icons, sorted alphabetically.
    - **Select All** / **Deselect All** toggles every Project; **Shift+click** a Project checkbox to range-select.
    - This step is optional — leaving it empty creates the Configurations unassigned and you can attach them to Projects later from this admin page or from the Project itself.
    - Click **Next**.
5. **Step 4 — Review Configurations**
    - The dialog lists every Configuration that will be created (with the standard configuration icon) and the Projects they'll be assigned to.
    - Click **Create N Configurations** to commit, or **Previous** to step back and edit.

### Editing a Configuration

1. Click the **Edit** icon in the Actions column for the desired Configuration.
2. The dialog lets you update the **Name** (display name only — the underlying Variant combination doesn't change) and the **Projects** the Configuration is assigned to. Removing a Project here removes the Configuration from that Project's pickers; adding one makes it available again.
3. Click **Submit**.

### Enabling/Disabling a Configuration

- Use the **Switch** next to the Configuration name in the table to enable or disable it.
- A Configuration cannot be enabled if any of its Variants are disabled.

### Deleting a Configuration

1. Click the **Delete** icon in the Actions column for the desired Configuration.
2. Confirm the deletion in the dialog box. This marks the specific configuration as deleted.

## Multi-Configuration Test Runs

Configurations can be used to create test runs that execute the same test cases across multiple environments simultaneously. This is particularly useful for:

- **Cross-browser testing**: Run tests on Chrome, Firefox, Safari, and Edge
- **Cross-platform testing**: Run tests on Windows, macOS, and Linux
- **Device matrix testing**: Run tests on different device/OS combinations

### Creating Multi-Configuration Test Runs

When creating a new test run, you can select multiple Configurations instead of just one:

1. Open the Add Test Run modal
2. In the Configuration field, select multiple configurations using the multi-select combobox
3. Complete the rest of the form (name, milestone, test cases, etc.)
4. Click Save

TestPlanIt will create a separate test run for each selected configuration, all containing the same test cases. These runs are linked together in a "Configuration Group."

### Viewing Multi-Configuration Data

When viewing a test run that's part of a Configuration Group, you can:

- View individual configuration results separately
- Select multiple configurations to see aggregated data
- Compare test results across different configurations
- Identify tests that pass in some configurations but fail in others

See [Multi-Configuration Support](./projects/run-details.md#multi-configuration-support) in the Test Run Details documentation for more information.

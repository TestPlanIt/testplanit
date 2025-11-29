---
sidebar_position: 6
title: Configurations
---

# Configurations Administration

Configurations represent specific combinations of environmental or setup variables (Variants) grouped by Categories. They are often used to define test environments (e.g., Browser: Chrome, OS: Windows 11) or other matrix-based scenarios where tests need to be executed against multiple combinations.

This section explains how to manage Categories, their associated Variants, and the resulting Configurations.

To access this page, enter the Administration area and select **Configurations** from the left-hand navigation menu. The page displays two main tables: Categories and Configurations.

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

1. Click the **Edit** (pencil) icon in the Actions column for the desired Category.
2. Modify the name in the modal dialog.
3. Click **Submit**.

### Deleting a Category

:::warning Important
Deleting a Category is irreversible and will also **permanently delete all Variants within it AND all Configurations that use any of those Variants**. Proceed with extreme caution.
:::

1. Click the **Delete** (trash can) icon in the Actions column for the desired Category.
2. A confirmation dialog will appear, emphasizing the consequences.
3. Confirm the deletion.

### Managing Variants within a Category

To manage Variants, first expand the Category row by clicking the expand icon (▶️) next to its name. This reveals a list of Variants and controls within the expanded area.

- **Viewing Variants**: Each variant is listed with:
  - A **Switch** to toggle its enabled/disabled status.
  - The **Variant Name**.
  - An **Edit** (pencil) icon button.
  - A **Delete** (trash can) icon button.
- **Adding a Variant:**
  1. Click the **Add Variant** (plus icon) button located within the expanded Category area.
  2. An input field will appear. Enter the name for the new Variant (e.g., "Chrome", "Firefox").
  3. Click the **Save** button or press Enter. Click **Cancel** or press Escape to discard.
- **Editing a Variant Name:**
  1. Click the **Edit** (pencil) icon button next to the desired Variant name.
  2. A modal dialog will appear. Modify the name.
  3. Click **Save**.
- **Enabling/Disabling a Variant:**
  1. Use the **Switch** next to the Variant name to toggle its status.
  2. **Important:** Disabling a Variant prevents it from being used in new Configurations and **will automatically disable all existing Configurations that use this Variant**. A confirmation dialog will appear before disabling.
- **Deleting a Variant:**
  :::warning Important
  Deleting a Variant is irreversible and will also **permanently delete all Configurations that use this Variant**. Consider disabling the Variant instead if you might need it later or want to preserve related Configurations.
  :::
  1. Click the **Delete** (trash can) icon button next to the desired Variant name.
  2. A confirmation dialog will appear.
  3. Confirm the deletion.

## Configurations

Configurations are specific combinations of enabled Variants, one from each relevant Category. They define the distinct environments or scenarios for testing.

### Viewing Configurations

The Configurations table lists all generated configurations with columns for:

- **Name**: The name of the Configuration, typically auto-generated as a comma-separated list of its Variants (e.g., "Chrome, Windows 11, English"). A switch allows enabling/disabling the Configuration. A Configuration is automatically disabled if any of its constituent Variants are disabled.
- **Variants**: A count of Variants included in this Configuration. Hovering shows a popover list.
- **Actions**: Buttons to **Edit** the Configuration name or **Delete** the Configuration.

### Adding New Configurations (Wizard)

Creating configurations involves selecting Variants and generating valid combinations using a multi-step wizard.

1. Click the **Add Configuration** button above the Configurations table.
2. **Step 1: Select Variants**
    - A dialog appears listing all Categories and their enabled Variants.
    - Expand/collapse Categories using the chevron icons (▶️/▼).
    - Check the boxes next to the Variants you want to include in potential combinations.
    - Use the "Select All" / "Deselect All" buttons per Category for convenience.
    - Click **Next**.
3. **Step 2: Select Combinations**
    - The wizard generates all possible unique combinations based on your selected Variants (one Variant per Category involved).
    - Existing configurations are automatically filtered out.
    - Check the boxes next to the combinations you want to create. By default, all new, valid combinations are selected.
    - If no new combinations can be generated (e.g., all possible ones already exist), a message will indicate this.
    - Click **Submit**.
4. **Step 3: Confirmation**
    - A final dialog lists the combinations you are about to create.
    - Review the list.
    - Click **Submit** to create the Configurations or **Previous** to go back.

### Editing a Configuration Name

1. Click the **Edit** (pencil) icon in the Actions column for the desired Configuration.
2. Modify the name in the modal dialog. (Note: This only changes the display name; the underlying Variant combination remains the same).
3. Click **Submit**.

### Enabling/Disabling a Configuration

- Use the **Switch** next to the Configuration name in the table to enable or disable it.
- A Configuration cannot be enabled if any of its Variants are disabled.

### Deleting a Configuration

1. Click the **Delete** (trash can) icon in the Actions column for the desired Configuration.
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

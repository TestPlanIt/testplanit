---
sidebar_position: 4 # Adjust position as needed
title: Templates & Fields
---

# Templates & Fields

This section explains how to manage Templates, Case Fields, and Result Fields within TestPlanIt. These elements allow you to customize the data captured for your test cases and test results across different projects.

- **Templates:** Define collections of Case Fields and Result Fields. Templates can be assigned to specific projects, or a single default template can apply to all projects.
- **Case Fields:** Custom fields that appear on the Test Case form (e.g., "Priority", "Component", "Preconditions").
- **Result Fields:** Custom fields that appear when recording a Test Result (e.g., "Actual Outcome", "Environment", "Build Number").

To access this page, enter the Administration area and select **Templates & Fields** from the left-hand navigation menu. The page displays three main tables: Templates, Case Fields, and Result Fields.

## Templates

Templates group together specific Case Fields and Result Fields to define the structure for test cases and results within assigned projects.

### Viewing Templates

The Templates table lists all defined templates with columns for:

- **Name:** The name of the template.
- **Case Fields:** A count or list of included Case Fields.
- **Result Fields:** A count or list of included Result Fields.
- **Projects:** A count or list of projects this template is assigned to (or "Default" if it's the default template).
- **Enabled:** A switch indicating if the template is active.
- **Default:** A switch indicating if this is the default template for all projects that don't have a specific template assigned.
- **Actions:** Buttons to edit or delete the template. (Note: The default template cannot be deleted).

### Adding a New Template

1. Click the "Add Template" button.
2. Enter a unique **Name** for the template.
3. Use the **Enabled** switch to activate the template.
4. Use the **Default** switch if this should be the default template. (Setting a new default will unset the previous one and apply this template to all projects).
5. **Select Case Fields:** Choose available Case Fields from the dropdown and add them to the selected list. You can reorder the selected fields using drag-and-drop.
6. **Select Result Fields:** Similarly, choose and order the Result Fields for this template.
7. **Assign Projects:** Use the multi-select dropdown to assign this template to specific projects. If this template is marked as **Default**, it will automatically apply to all projects, and this selection might be disabled or ignored.
8. Click "Submit".

### Editing an Existing Template

1. Click the **Edit** button (pencil icon) for the desired template.
2. Modify the **Name**, **Enabled** status, **Default** status, assigned **Case Fields**, **Result Fields**, and **Project assignments** as needed.
3. Click "Submit".

### Deleting a Template

1. Click the **Delete** button (trash icon) for the desired template. (Note: Default templates cannot be deleted).
2. Confirm the deletion in the dialog box. This marks the template as deleted and removes its associations.

## Case Fields

Case Fields define the custom data points you want to capture for each Test Case.

### Viewing Case Fields

The Case Fields table lists all defined fields with columns for:

- **Display Name:** The user-friendly label shown on forms.
- **System Name:** The internal identifier (unique, no spaces/special characters).
- **Field Type:** The type of data the field holds (e.g., Text String, Dropdown, Checkbox).
- **Templates:** A count or list of templates using this field.
- **Enabled:** A switch indicating if the field is active and available for use.
- **Required:** A switch indicating if the field must be filled out.
- **Restricted:** A switch indicating if the field is restricted (meaning may vary, e.g., admin-only edits).
- **Actions:** Buttons to edit or delete the field.

### Adding a New Case Field

1. Click the "Add Case Field" button.
2. Fill in the details:

    - **Display Name:** User-friendly label (required).
    - **System Name:** Internal ID, auto-generated from Display Name but can be edited (required, unique, specific format).
    - **Hint:** (Optional) Help text displayed to the user.
    - **Enabled / Required / Restricted:** Toggle switches for these settings:
      - **Enabled:** If checked, the field is active and will appear on forms where its template is used. If unchecked, the field is hidden but retains its configuration.
      - **Required:** If checked, users must provide a value for this field when filling out the corresponding form (Test Case or Test Result).
      - **Restricted:** If checked, only users with specific administrative permissions can set this field's value.
    - **Field Type:** Select the data type from the dropdown (required). Available types include:

      - Checkbox
      - Date
      - Dropdown
      - Integer
      - Link
      - Multi-Select
      - Number
      - Steps (Include individual Steps / Expected Results for Case Fields only)
      - Text Long (Multi-line text)
      - Text String (Single-line text)

      This choice determines which additional options appear below.

3. **Configure Type-Specific Options:** Based on the selected Field Type, configure options like:
    - **Checkbox:** Default Value (checked/unchecked).
    - **Dropdown / Multi-Select:** Add options (Name, Icon, Color), drag to reorder, set a default option (for Dropdown), enable/disable individual options.
    - **Number / Integer:** Minimum Value, Maximum Value.
    - **Text String / Text Long / Link:** Default Value. For Text Long, also Initial Height.
4. Click "Submit".

### Editing an Existing Case Field

1. Click the **Edit** button (pencil icon) for the desired field.
2. Modify the **Display Name**, **Hint**, **Enabled/Required/Restricted** status, and **Type-Specific Options** as needed. (Note: System Name and Field Type cannot be changed after creation).
3. Click "Submit".

### Deleting a Case Field

1. Click the **Delete** button (trash icon) for the desired field.
2. Confirm the deletion. This marks the field as deleted and removes it from any templates.

## Result Fields

Result Fields define the custom data points you want to capture when recording the outcome of a Test Case run. They use the same available Field Types and configuration options as Case Fields except Steps are only available as a Case Field. The management process (Viewing, Adding, Editing, Deleting) is identical, using the "Add Result Field", "Edit", and "Delete" buttons within the Result Fields table.

---
sidebar_position: 11
title: TestRail Import
---

# TestRail Import

Import the test cases of a TestRail suite from its XML export. The sections of the suite become folders, and you map TestRail's fields to the fields of a TestPlanIt template in the same wizard used for CSV and Markdown import.

## What Is Imported

| TestRail | TestPlanIt |
|---|---|
| Sections and subsections | Folders. A section's description becomes the documentation of the folder when the import creates that folder. |
| Title | Name |
| Type, Priority, TestRail template name | Columns you can map to a dropdown or text field |
| Estimate | Estimate |
| References | Linked issues, when you map the column to **Issues** |
| Preconditions | A column you can map to a text field |
| Steps and Expected Result (text layout) | One step with its expected result |
| Separated steps | One step each. A step's Additional Info is added below the step text. |
| Custom fields | One column each, named as in the file |
| Tables in text | Tables |
| Variables in steps (`%name%`) | Parameters of the test case, shown as `@name` in the step. The values are in TestRail's datasets, not in the file, so add them to the test case's dataset after the import. See [Parameterized Test Cases](./user-guide/projects/parameterized-test-cases.md). |
| Case ID (for example `C123`) | A column you can map to a text field |

## What the Export Does Not Contain

TestRail's XML export holds test cases and sections only. These are not in the file and are not imported:

- Attachments and images. An image placed in a text field is replaced with `[image not imported]`.
- Test runs, results, milestones and users.
- Case history, authors and dates.
- Template and field definitions.

## Before You Import

1. Create a template in TestPlanIt with the fields you want to keep, and assign it to the project. The import does not create templates, fields or dropdown options.
2. For dropdown fields, add the options that the TestRail values use, with the same names.
3. In TestRail, open the suite's **Test Cases** page, choose the export icon, and export as **XML**.

## Importing

1. Navigate to **Repository** in your project and click **Import**.
2. Select the file. The wizard shows how many test cases and sections the suite holds.
3. Choose where the folders are created: at the top level of the repository, or under a folder you pick. Choosing a single folder puts every test case in that folder and drops the section tree.
4. Optionally put the sections in a new folder and name it, to keep several suites apart in one project.
5. Select the template.
6. Map the TestRail columns to template fields, then review the preview and import.

### Suites That Use Several TestRail Templates

Each import maps the test cases to one TestPlanIt template. When the suite uses more than one TestRail template, the first page offers a **TestRail template** filter. To give each TestRail template its own TestPlanIt template, run the import once per TestRail template, choosing a different template each time. Folders that already exist are reused.

## Limitations

- One file is one suite. Import each suite's file separately.
- Custom fields of a kind the import does not know are imported as plain text, and the first page lists them.
- An estimate the import cannot read is left empty, and the preview says how many.
- [Saved column mappings](./import-export.md#saved-column-mappings) are available for CSV files only.

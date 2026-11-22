---
sidebar_position: 13
title: TestLink Import
---

# TestLink Import

Import test cases from a TestLink XML export of a test project, a test suite, or the test cases of one suite. The test suites become folders, and you map TestLink's fields to the fields of a TestPlanIt template in the same wizard used for CSV and Markdown import.

## What Is Imported

| TestLink | TestPlanIt |
|---|---|
| Test suites and their child suites | Folders. A suite's details become the documentation of the folder when the import creates that folder. |
| Test case name | Name |
| Summary, Preconditions | Columns you can map to a text field |
| Steps with their expected results | One step each, in step-number order |
| Keywords | Tags, when you map the column to **Tags** |
| Files attached to a test case | Attachments of the test case, when you map the **Attachments** column to **Attachments**. The export must include them. |
| Importance | A column holding `Low`, `Medium` or `High` |
| Execution type | A column named **Automated** holding `Yes` or `No` |
| Status | A column holding `Draft`, `Ready for review`, `Review in progress`, `Rework`, `Obsolete`, `Future` or `Final`. Mapped to **Workflow State**, a value that matches a workflow state of the project sets that state. |
| Estimated execution duration | Estimate. TestLink's minutes are converted. |
| Custom fields | One column each, named as in the file. A value with several choices fills a Multi-select field. |
| Requirements | A column listing the document IDs of the linked requirements |
| Platforms | A column listing the platform names |
| Test case ID (for example `SHOP-12`) | A column you can map to a text field |

When the export contains an inactive test case, an **Active** column holding `Yes` or `No` is added.

## What Is Not Imported

- Files attached to a test suite. Folders have no attachments.
- Relations between test cases.
- Earlier versions of a test case. The export holds the latest version only.
- Test plans, builds, executions and users. They are not in the file.
- Custom field definitions. They are not in the file.

## Before You Import

1. Create a template in TestPlanIt with the fields you want to keep, and assign it to the project. The import does not create templates, fields or dropdown options.
2. For dropdown and multi-select fields, add the options that the TestLink values use, with the same names.
3. In TestLink, open the test specification, select the test project or a test suite, and export it as XML. Select **Export with keywords**, **Export Custom fields** and **Export attachments** to include them in the file.

## Importing

1. Navigate to **Repository** in your project and click **Import Test Cases**.
2. Select the file. The wizard shows how many test cases and test suites the export holds, how many attached files it holds, and how many relations it leaves out.
3. Choose where the folders are created: at the top level of the repository, or under a folder you pick. Choosing a single folder puts every test case in that folder and drops the suite tree.
4. Select the template.
5. Map the TestLink columns to template fields, then review the preview and import.

## Limitations

- Attached files are uploaded before the test cases are created. When a file cannot be uploaded, nothing is imported.

- An estimated execution duration that is not a number is left empty, and the preview says how many.
- [Saved column mappings](./import-export.md#saved-column-mappings) are available for CSV files only.

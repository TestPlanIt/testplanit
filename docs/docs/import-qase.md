---
sidebar_position: 12
title: Qase Import
---

# Qase Import

Import whole Qase projects into TestPlanIt: the repository, milestones, test runs with their results, and defects. TestPlanIt reads the data through the Qase API, so there is no export file to prepare.

Only system administrators can run the import. It needs a running background worker. Attachments and images are copied only when file storage is set up.

## What Is Imported

| Qase | TestPlanIt |
|---|---|
| Project | A new project, or an existing project you choose |
| Suites | Folders. A suite's description and preconditions become the documentation of the folder. Test cases without a suite go into a top-level folder named after the Qase project. |
| Test cases | Test cases, each with its first version |
| Test case status (Actual, Draft, Deprecated) | Workflow states you choose |
| Priority, severity, type, behavior, layer, flaky, description, preconditions, postconditions | Fields of one template, created or matched on the mapping screen |
| Custom fields | Template fields, created or matched on the mapping screen |
| Automation status | The **Automated** flag. A test case marked "To be automated" is not automated and gets the tag "To be automated". |
| Steps | Steps. Nested steps are flattened in order, and a step's input data is added below its action as "Input data:". |
| Gherkin scenarios | One step holding the scenario text |
| Shared steps | Shared step groups |
| Parameters and shared parameters | Parameters of the test case, with their rows |
| Tags | Tags |
| Milestones | Milestones, with the milestone type you choose. A milestone of the same name in the project is reused. |
| Configuration groups and their values | Configuration categories and variants |
| Environments | Variants of a configuration category named "Environment" |
| Test runs | Test runs, with their milestone, configuration, tags, description and time spent. A run finished in Qase is imported as completed. |
| Results | Results with their status, comment, stack trace, time spent and step results |
| Defects | Issues named `<project code>-D<number>`, linked to the milestone, test runs and results the defect belongs to |
| Tracker issues linked to test cases and test runs (Jira, GitHub and others) | Issues of an issue integration, linked to the same test cases and test runs |
| Attachments and images in text | Files in TestPlanIt's storage |
| Users | Existing users you choose, or new users |

## What Is Not Imported

- Test plans
- Test case history, comments and reviews
- Requirements

## Before You Import

1. In Qase, create an API token under your profile's **API tokens**. The token must be able to read every project you want to import.
2. Make sure the background workers are running. See [Background Processes](./background-processes.md).
3. Set up file storage if you want attachments and images copied.

TestPlanIt stores the token encrypted and deletes it when the import finishes or is canceled.

## Importing

Open **Administration → Data Imports** and choose **Qase**. The import has four steps.

### 1. Connect to Qase

Enter the API token and click **Connect**. Leave the API host as it is unless you use Qase Enterprise on your own domain. Then select the projects to import.

### 2. Fetch Data

Click **Fetch data**. TestPlanIt copies the selected projects from Qase and shows how many records of each kind it has read. Nothing is added to your projects yet. You can cancel a fetch, which removes the copied data.

### 3. Configure Mapping

Choose where each part of the Qase data goes. TestPlanIt fills in a suggestion for every choice by matching names.

| Section | Your choice |
|---|---|
| Projects | Create a new project or use an existing one. A new project gets every workflow state, status and milestone type, and the default template. |
| Test case statuses | The workflow state for each Qase status |
| Template | Create a new template or use an existing one. All imported test cases use one template. |
| Fields | For each Qase field: create a new field, use an existing field of the same type, or do not import it |
| Result statuses | For each Qase result status: use an existing status or create one |
| Test runs | The workflow state for runs still open in Qase and for runs finished in Qase |
| Milestones | The milestone type imported milestones get |
| Issue trackers | For Qase defects and for each linked tracker: use an existing issue integration or create one |
| Users | For each Qase user: use an existing user or create one. Without a choice, the user's work is credited to you. |

The states, statuses and integrations you choose are added to the projects if they are not available there yet. A value whose option does not exist on an existing field is left empty, and the screen says which options have no match.

A new user gets a random password and signs in by resetting it or through single sign-on.

A new issue integration has no connection details. An administrator sets it up afterwards under **Administration → Integrations**. See [Integrations](./user-guide/integrations.md).

### 4. Monitor Import

Click **Start import**. The import runs in the background, and you can leave the page and come back. The page shows how many folders, shared steps, test cases, milestones, test runs, results, issues and files have been imported.

When the import ends, the page lists what could not be brought over, for example an attachment that could not be downloaded or a value without a matching option.

## Canceling, Retrying and Importing Again

- **Cancel import** stops the import after the record it is working on. What was already imported stays in TestPlanIt. The copied data and the API token are removed.
- **Try again** on a failed import continues where it stopped. Records that were already imported are not imported twice.
- **Previous imports** reopens an earlier import of your account.
- **Delete import** removes the data copied from Qase for that import. Anything already imported into TestPlanIt stays.

Starting a new import of a project that was already imported creates its test cases, test runs and results again. To bring a project over a second time, import it into a new project.

## Limitations

- A file larger than 32 MB is not copied.
- Files are downloaded over https only.
- All test cases of one import use one template.
- A test case with a very large number of parameter combinations is imported with its parameters and without rows.

## Auditing

A finished import is recorded in the [audit log](./user-guide/audit-logs.md) as a bulk-create event.

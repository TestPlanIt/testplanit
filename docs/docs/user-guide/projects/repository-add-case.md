---
title: Add Test Case
sidebar_position: 1 # First item under Repository
---

# Add Test Case

This explains the process for adding a new test case to the project repository using the **Add Case** dialog.

New test cases can be added in several ways:

1. **Manual Creation**: Navigate to the desired folder in the [Repository](./repository.md) and click the 'Add Case' (`+`) button
2. **AI Generation**: Use the AI-powered generation wizard to create test cases from issues or requirements (requires [LLM Integration](../llm-integrations.md))
3. **CSV Import**: Bulk import test cases from CSV files using the Import Cases wizard

## Dialog Layout

The Add Case dialog uses a resizable two-panel layout:

1. **Left Panel (Main Fields)**: Contains the core test case definition fields based on the selected template.
2. **Right Panel (Metadata)**: Contains standard fields like Estimate, Automated status, Tags, and Attachments.

## Header Controls

- **Title**: "Add Test Case".
- **Template Selector**: A dropdown menu to select the [Template](../templates-fields.md) for this test case. Changing the template dynamically updates the fields available in the left panel.
- **Parent Folder**: Displays the name of the folder the case will be added to.

## Left Panel Fields

- **Name** (Required): The name or title of the test case. This is usually a text area allowing for longer descriptions.
- **State** (Required): A dropdown to set the initial workflow [State](../workflows.md) for the test case (e.g., Draft, Ready for Review).
- **Dynamic Template Fields**: All the custom fields defined in the selected [Template](../templates-fields.md) are displayed here. This could include:
  - Text fields (single or multi-line)
  - Dropdowns
  - Multi-select lists
  - Checkboxes
  - Date pickers
  - Number/Integer fields
  - Link fields
  - **Steps**: A dedicated field for defining the test steps, including Action and Expected Result for each step.

## Right Panel Fields

- **Estimate**: An optional field to estimate the time required to execute the test case (e.g., "30m", "1h 15m").
- **Automated**: A toggle switch to indicate if the test case is intended for automated execution.
- **Tags**: Allows selecting and assigning existing [Tags](../tags.md) to the test case.
- **Attachments**: An area to upload files (e.g., design mockups, requirement documents) relevant to the test case definition.

## Actions

- **Cancel**: Closes the dialog without creating the test case.
- **Create**: Validates the input fields and creates the new test case in the selected folder. It also creates the initial version (Version 1) of the test case.

## AI-Powered Test Generation

When [LLM integrations](../llm-integrations.md) are configured, you'll see an additional **Generate Test Cases** button (with sparkles icon) in the folder view. This opens the AI generation wizard which allows you to:

### Generation Sources
- **From Issues**: Generate test cases from linked Jira, GitHub, or Azure DevOps issues
- **From Documents**: Generate test cases from requirements documents or specifications

### Generation Process
1. **Select Source**: Choose an issue or provide requirements document details
2. **Select Template**: Choose the template and specific fields to populate
3. **Configure Settings**: Set quantity, provide additional instructions, enable auto-tagging
4. **Review & Import**: Review generated test cases and select which ones to import

### Key Features
- **Smart Field Population**: AI automatically fills template fields with contextually relevant content
- **Context Awareness**: Considers existing test cases to avoid duplication
- **Flexible Quantity**: Generate from single test cases to comprehensive test suites
- **Auto-tagging**: Automatically generates and assigns relevant tags
- **Test Steps Generation**: Creates detailed action/expected result pairs

For detailed information about AI test generation, see the [LLM Integrations](../llm-integrations.md) documentation.

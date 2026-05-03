---
sidebar_position: 10
title: Markdown Import
---

# Markdown Import

Import test cases directly from Markdown files (`.md`). This is ideal for teams that maintain test documentation in Markdown and want to migrate to or sync with TestPlanIt.

## Overview

The Markdown import feature:

- **Auto-detects** your Markdown structure (headings, tables, or plain lists)
- **Extracts** test case names, steps, expected results, tags, and additional fields
- **Uses AI** when your project has an LLM integration configured, for more accurate parsing of non-standard formats
- **Falls back** to a built-in deterministic parser when no LLM is available
- **Feeds into** the same field-mapping wizard as CSV import — you review and adjust mappings before importing

## Supported Markdown Formats

The parser recognizes three document structures. You can use whichever fits your existing documentation.

### Format 1: Heading-Based (Recommended)

Each top-level heading (`#` or `##`) defines a separate test case. Sub-headings define sections within each case.

```markdown
# Login Test

Verify that a registered user can log in with valid credentials.

## Preconditions

- User account exists
- User is not currently logged in

## Steps

1. Navigate to the login page
2. Enter a valid username
3. Enter the correct password
4. Click the "Sign In" button

## Expected Results

1. Login page loads with username and password fields
2. Username field accepts input
3. Password field masks input
4. User is redirected to the dashboard

## Tags

smoke, authentication, login
```

**How it maps:**

| Markdown Element | Detected Column | Maps To |
| ------------------ | ---------------- | --------- |
| `#` heading text | `name` | **Name** (system field, required) |
| `## Steps` list items | `steps` | **Steps** (system field) |
| `## Expected Results` list items | `steps` | **Steps** expected result, paired by position |
| `## Tags` comma-separated or list items | `tags` | **Tags** (system field) |
| Text between case heading and first sub-heading | `description` | Template custom field (e.g., "Description") |
| `## Preconditions` / `## Prerequisites` content | `preconditions` | Template custom field (e.g., "Preconditions") |
| Any other `##` heading (e.g., `## Priority`) | Heading text (e.g., `Priority`) | Template custom field |

:::info System Fields vs Template Custom Fields
TestPlanIt test cases have a small set of **system fields** that are always available: **Name** (required), **Steps**, **Tags**, **Automated**, **Estimate**, **Forecast**, and **Folder**. All other fields — including Description, Preconditions, Priority, Severity, etc. — are **template custom fields** that you define in your project's template. During the field mapping step, you'll map detected Markdown columns to whichever system or custom fields you need.
:::

#### Multiple Test Cases

Include multiple `#` headings in one file to import several cases at once:

```markdown
# Login Test

## Steps

1. Navigate to login page -> Page loads
2. Enter credentials -> Fields accept input
3. Click Sign In -> User is redirected to dashboard

## Tags

smoke, login

# Password Reset Test

## Steps

1. Click "Forgot Password" -> Reset form appears
2. Enter registered email -> Confirmation message shown
3. Open reset link from email -> New password form loads
4. Enter new password -> Password updated successfully

## Tags

security, password

# Account Lockout Test

## Preconditions

User account exists and is active

## Steps

1. Enter wrong password 5 times -> Account is locked
2. Attempt login with correct password -> Access denied message shown
3. Wait 30 minutes -> Account unlocks automatically

## Tags

security, lockout
```

:::tip
If your file uses `##` as the top-level heading (no `#` headings), the parser adjusts automatically — `##` becomes the case delimiter and `###` becomes the section delimiter.
:::

### Format 2: Table-Based

Define test cases in a Markdown table. Each row becomes a test case.

```markdown
| Name | Steps | Expected Result | Tags |
| ------ | ------- | ----------------- | ------ |
| Login Test | Navigate to login page and enter credentials | User is redirected to dashboard | smoke, login |
| Logout Test | Click the logout button | User is redirected to login page | smoke, logout |
| Password Reset | Click forgot password and enter email | Reset email is sent | security |
```

**Recognized column headers:**

| Column Header | Detected As |
| --------------- | ------------- |
| `Name`, `Title`, `Test Case`, `Test Name` | `name` — maps to **Name** (system field, required) |
| `Steps`, `Procedure`, `Actions`, `Test Steps` | `steps` — maps to **Steps** (system field) |
| `Expected Result`, `Expected Results`, `Expected`, `Result` | Expected result on steps |
| `Tags`, `Labels`, `Categories` | `tags` — maps to **Tags** (system field) |
| `Description`, `Summary`, `Details` | `description` — maps to a template custom field |
| `Preconditions`, `Prerequisites`, `Setup` | `preconditions` — maps to a template custom field |
| Any other column header | Custom column — maps to a template custom field |

:::info
The table must include at least one recognizable header (such as `Name`, `Steps`, or `Description`) to be detected as a test case table. Tables with completely unrecognized headers are skipped.
:::

### Format 3: Single Test Case

If your file describes just one test case (no multiple top-level headings, no table), the entire content is treated as a single case.

**A plain numbered list becomes steps:**

```markdown
1. Open the application
2. Navigate to Settings
3. Change the theme to Dark Mode
4. Verify the theme changes across all pages
```

**Section headings without a case title:**

```markdown
## Steps

1. Navigate to the checkout page
2. Add a payment method
3. Confirm the order

## Expected Results

1. Checkout page displays cart summary
2. Payment form accepts card details
3. Order confirmation page is shown
```

**Plain text becomes a description column (mappable to a template custom field):**

```markdown
This test verifies that the search feature returns relevant results
when the user enters partial product names. It should handle typos
gracefully and display suggestions.
```

## Step Formats

Steps can include expected results using two different approaches.

### Inline Expected Results

Use `->` or `|` separators within each step:

```markdown
## Steps

1. Navigate to login page -> Login form is displayed
2. Enter valid credentials -> Fields accept input
3. Click "Sign In" -> User is redirected to dashboard
```

Or with the pipe separator:

```markdown
## Steps

1. Navigate to login page | Login form is displayed
2. Enter valid credentials | Fields accept input
3. Click "Sign In" | User is redirected to dashboard
```

Both formats produce the same result: the text before the separator is the **action**, and the text after is the **expected result**.

:::info
The `|` separator only splits on a single pipe character. Double pipes (`||`) are treated as part of the step text (e.g., `Check if value is true || false` is not split).
:::

### Separate Sections

Use a `## Steps` section paired with a `## Expected Results` section. Results are matched to steps by position (first result goes with first step, etc.):

```markdown
## Steps

1. Navigate to login page
2. Enter valid credentials
3. Click the Sign In button

## Expected Results

1. Login form is displayed with username and password fields
2. Fields accept input without errors
3. User is redirected to the dashboard
```

If there are more steps than expected results, the extra steps will have no expected result. Both numbered and bulleted lists work.

### Steps Without Expected Results

Expected results are optional. Steps without them are imported with only the action:

```markdown
## Steps

1. Open the application
2. Navigate to the settings page
3. Click the "Export" button
```

## AI-Assisted Parsing

When your project has an **LLM integration** configured and active, the Markdown import uses AI to parse the document before falling back to the built-in parser. This provides better results for:

- Non-standard or mixed formatting
- Documents that combine prose with test case data
- Complex nested structures
- Ambiguous section boundaries

### How It Works

1. The Markdown content is sent to your project's configured LLM
2. The AI extracts structured test case data (name, steps, expected results, tags, etc.)
3. Results are returned in the same format as the built-in parser
4. You review and adjust field mappings in the wizard as usual

### When the Fallback Is Used

The built-in deterministic parser is used when:

- No LLM integration is configured for the project
- The LLM integration is inactive
- The AI request fails (network error, rate limit, etc.)

When the AI parser fails, a notification is shown and the fallback parser runs automatically — no action needed from you.

:::tip
Even without an LLM, the built-in parser handles the standard formats documented on this page reliably. The AI is most helpful for non-standard or heavily customized Markdown structures.
:::

## Import Process

### Step 1: Start Import

1. Navigate to **Repository** in your project
2. Click the **Import** button in the toolbar
3. In the import wizard, select **Markdown** as the file type

### Step 2: Upload File

1. Click "Choose File" and select your `.md`, `.markdown`, or `.txt` file
2. The file is parsed automatically (using AI if available, otherwise the built-in parser)
3. A loading indicator is shown while parsing completes

### Step 3: Map Fields

The wizard displays the detected columns from your Markdown alongside the available TestPlanIt fields:

- **System fields** like Name, Steps, and Tags are auto-matched when detected
- **Template custom fields** from your selected template (e.g., "Description", "Preconditions", "Priority") are available as mapping targets — detected columns like `description` or `preconditions` auto-match to template fields with similar names
- You can change, add, or ignore any mapping
- A preview shows sample data for each mapping

### Step 4: Configure Options

- **Template**: Select which template to apply to imported cases
- **Folder**: Choose the destination folder
- **Tag handling**: Merge with existing tags or replace

### Step 5: Import

1. Review the import summary (number of cases, mapped fields)
2. Click **Import** to begin
3. Monitor progress with real-time updates
4. Review results when complete

## Field Mapping Reference

During import, the parser detects columns from your Markdown and you map them to TestPlanIt fields. Only **Name** is required.

### System Fields

These fields exist on every test case regardless of template:

| Detected Column | System Field | Notes |
| ----------------- | -------------- | ------- |
| `name` (from headings, table `Name`/`Title` column) | **Name** | Required. Falls back to "Test Case 1", "Test Case 2", etc. |
| `steps` (from `## Steps`, inline lists, table `Steps` column) | **Steps** | Supports numbered and bulleted lists. Expected results paired by position or inline separators. |
| `tags` (from `## Tags`, table `Tags`/`Labels` column) | **Tags** | Comma-separated values or list items |

Other system fields available for mapping (not typically detected from Markdown): **Automated**, **Estimate**, **Forecast**, **Folder**.

### Template Custom Fields

All other detected columns — `description`, `preconditions`, `Priority`, `Notes`, or any other section heading / table column — are shown as source columns in the mapping wizard. You map them to custom fields defined in your project's template.

Common examples:

| Detected Column | Typical Template Field |
| ----------------- | ---------------------- |
| `description` (text between heading and first sub-heading) | A "Description" or "Summary" text field |
| `preconditions` (from `## Preconditions` / `## Prerequisites`) | A "Preconditions" text field |
| `Priority` (from `## Priority` or table column) | A "Priority" dropdown or text field |
| Any other heading or table column | Whichever custom field you choose |

:::tip
Name your Markdown sections to match your template's custom field names. The wizard auto-matches columns to fields with similar names, so `## Preconditions` will auto-map to a template field called "Preconditions" if one exists.
:::

## Templates for Common Formats

Below are ready-to-use Markdown templates you can adopt for your test documentation.

### Basic Test Case Template

```markdown
# [Test Case Name]

[Brief description of what this test validates]

## Preconditions

- [Prerequisite 1]
- [Prerequisite 2]

## Steps

1. [Action] -> [Expected Result]
2. [Action] -> [Expected Result]
3. [Action] -> [Expected Result]

## Tags

[tag1], [tag2], [tag3]
```

### Detailed Test Case with Separate Sections

```markdown
# [Test Case Name]

[Description paragraph explaining the purpose and scope of this test case.]

## Preconditions

- [Setup requirement 1]
- [Setup requirement 2]

## Steps

1. [First action to perform]
2. [Second action to perform]
3. [Third action to perform]

## Expected Results

1. [Expected outcome for step 1]
2. [Expected outcome for step 2]
3. [Expected outcome for step 3]

## Tags

[tag1], [tag2]

## Priority

[High/Medium/Low]

## Notes

[Any additional notes or context]
```

### Multi-Case File Template

```markdown
# Test Case One

Description of the first test case.

## Steps

1. Step one action -> Expected outcome
2. Step two action -> Expected outcome

## Tags

tag1, tag2

# Test Case Two

Description of the second test case.

## Preconditions

- Required setup

## Steps

1. Step one action -> Expected outcome
2. Step two action -> Expected outcome

## Tags

tag3, tag4
```

### Table Format Template

```markdown
| Name | Description | Steps | Expected Result | Tags | Priority |
| ------ | ------------- | ------- | ----------------- | ------ | ---------- |
| [Test Name] | [Description] | [Step text] | [Expected result] | [tag1, tag2] | [High] |
| [Test Name] | [Description] | [Step text] | [Expected result] | [tag1, tag2] | [Medium] |
```

## Tips and Best Practices

:::tip Consistent Formatting
Use the same heading structure across all test cases in a file. Mixing `#` and `##` as case delimiters in the same document can produce unexpected results.
:::

:::tip Custom Fields
Apart from the system fields (Name, Steps, Tags), every detected column — including `description`, `preconditions`, and any custom section heading — is available for mapping to your template's custom fields. The wizard auto-matches by name, so `## Priority` maps to a "Priority" template field automatically.
:::

:::tip Step Separators
Choose one separator style (`->` or `|`) and use it consistently within a file. The parser handles both, but mixing them in the same document may reduce clarity.
:::

:::warning Large Files
Very large Markdown files may take longer to parse, especially with AI-assisted parsing. If your file contains more than 50 test cases, consider splitting it into multiple files.
:::

## Comparison: CSV vs Markdown Import

| Feature | CSV Import | Markdown Import |
| --------- | ----------- | ---------------- |
| Multi-step formatting | Pipe-separated in a single cell | Native numbered/bulleted lists |
| Expected results | Pipe separator in step cell | `->`, `\|` inline, or separate section |
| Rich text in fields | Auto-detected (Markdown, HTML, JSON) | Native Markdown |
| Multiple cases per file | One row per case | One heading per case, or one table row per case |
| Template field mapping | Any CSV column header | Any section heading or table column |
| AI-assisted parsing | No | Yes (when LLM configured) |
| Delimiter configuration | Yes (comma, semicolon, pipe, etc.) | Not applicable |
| Best for | Spreadsheet exports, bulk data | Documentation-first teams, wiki migrations |

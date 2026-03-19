---
sidebar_position: 11
title: QuickScript
---

# QuickScript

QuickScript converts your manual test cases into automation scripts. Select test cases from the Repository and export them as ready-to-use code for frameworks like Playwright, Cypress, Selenium, Jest, pytest, and more — using a template, or with AI assistance when an LLM integration is configured.

## Accessing QuickScript

### From the Repository (Bulk)

1. Navigate to your project's **Repository**.
2. Select one or more test cases using the checkboxes in the table.
3. Click the **QuickScript** button in the toolbar.

The button appears when you have at least one test case selected.

### From a Single Row

Each test case row in the Repository table has a **QuickScript** icon (scroll icon) in the Actions column. Click it to open QuickScript for that individual case without needing to select it first.

### From a Test Case

1. Open a test case from the Repository.
2. Click the **QuickScript** button next to the Edit button.

This opens QuickScript for that single test case.

## Using the QuickScript Dialog

The dialog has two settings:

### Template Selection

Choose a template from the dropdown. Templates are grouped by category (e.g., Browser E2E, Unit Testing, API Testing). You can search by name, category, or framework.

The templates shown depend on whether a project administrator has assigned specific templates to the project:

- **Templates assigned** — Only the assigned templates appear in the dropdown.
- **No templates assigned** — All enabled templates are shown (default behavior).

A default template is pre-selected automatically using this priority:

1. **Project default** — If a project-specific default has been set in **Settings > QuickScript**.
2. **Global default** — If a system-wide default template exists and is available in the current list.
3. **First available** — The first template in the list.

To configure which templates are available for your project, see [Per-Project Template Assignment](../quickscript-templates.md#per-project-template-assignment).

### Output Mode

- **Single file** — All selected test cases are rendered into one file. The file uses the template's configured extension (e.g., `.spec.ts`, `.py`, `.feature`).
- **Individual files (.zip)** — Each test case gets its own file, bundled together in a ZIP archive. Files are named after the test case (e.g., `user-login-with-valid-credentials.spec.ts`).

## AI-Powered Generation

If your project has an active LLM integration, a **Generate with AI** toggle appears in the dialog.

When enabled, QuickScript uses AI to generate each script by analyzing your test case steps and the template's framework context. If a code repository is also connected, the AI additionally draws on your actual repository code — helpers, page objects, fixtures, and utilities — producing code that follows your project's real patterns rather than generic stubs.

### With a Code Repository

When a code repository is configured and cached, AI generation works at its best. Caches are automatically refreshed by a daily background job when they expire, so code context is always available without manual intervention.

1. QuickScript assembles context from your code repository (files most relevant to the test case).
2. The AI receives your test steps, the repository context, and the template's header/footer as a starting point.
3. It generates a complete, runnable test file — including imports and any setup it infers from the repository.
4. The result streams into a preview pane before you download.

### Without a Code Repository

AI generation also works without a connected code repository. In this mode:

1. The AI receives your test steps, the template's framework and language, and the header/footer as guidance.
2. It generates code using standard framework patterns and best practices.
3. A hint below the AI toggle indicates that no code repository is configured.

The generated code is still significantly more tailored than static template output, but won't reference project-specific helpers or page objects since it has no repository context to draw from.

### Preview Pane

After generation, a preview pane shows:

- Each generated file with syntax-highlighted code
- A badge indicating whether each file was **AI Generated** or **Template Generated** (fallback)
- The number of repository context files used (when a code repository is configured)
- A truncation warning if the AI hit its token limit

You can copy individual files to the clipboard or download the full set.

### Partial Failures

If AI generation fails for a case, QuickScript automatically falls back to the template for that case. The preview badge shows **Template Generated** for those files. The download is always available regardless of how many cases fell back.

### Token Limit Warning

If a generated file shows a truncation warning, the AI reached its output token limit before completing the file. To resolve this, reduce the number of cases selected or ask your administrator to increase the **Max Output Tokens** setting in Prompt Config for the Export Code Generation feature.

## Template-Only Mode

With AI disabled (or when no LLM integration is available), QuickScript uses the template directly:

- The **Header** renders once at the top of the file.
- The **Template Body** renders once per test case with Mustache substitution.
- The **Footer** renders once at the bottom.

Click **Export** to download the file immediately — no preview step.

## How Templates Work

Each QuickScript template has three sections:

- **Header** — Rendered once at the top of the file (e.g., import statements, package declarations).
- **Template Body** — Rendered once per test case using [Mustache](https://mustache.github.io/) syntax. This is where test case data like the name, steps, and custom fields are inserted.
- **Footer** — Rendered once at the bottom of the file (e.g., closing brackets, cleanup code).

### Single File Output

When exporting multiple cases as a single file, the header appears once, each case is rendered from the template body, and the footer appears once:

```typescript
import { test, expect } from "@playwright/test";

test.describe("User Login", () => {
  test("Navigate to the login page", async ({ page }) => { ... });
  test("Enter valid credentials", async ({ page }) => { ... });
});

test.describe("User Signup", () => {
  test("Click the signup link", async ({ page }) => { ... });
  test("Fill in the registration form", async ({ page }) => { ... });
});
```

Without the header/footer feature, the `import` statement would repeat before every test case.

### Individual Files (ZIP)

Each file in the ZIP is self-contained — it includes the header, the single test case, and the footer.

TestPlanIt ships with built-in templates for popular testing frameworks and formats. Administrators can edit these, create new ones, or disable any that aren't needed. See [QuickScript Templates](../quickscript-templates.md) for template management details.

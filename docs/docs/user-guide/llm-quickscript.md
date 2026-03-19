---
title: QuickScript AI Generation
---

# AI-Powered QuickScript

QuickScript can use AI to generate automation scripts from your manual test cases. Instead of filling in a Mustache template mechanically, the AI analyzes your test steps and — when a code repository is connected — your actual project code, producing scripts that follow your real patterns, imports, and helpers.

## Overview

AI-powered QuickScript generation provides:

- **Context-aware code** — Scripts reference your actual page objects, fixtures, and utilities when a code repository is connected
- **Framework knowledge** — The AI understands testing frameworks like Playwright, Cypress, pytest, and others
- **Streaming preview** — Generated code streams into a preview pane so you can review before downloading
- **Graceful fallback** — If AI generation fails for any test case, QuickScript automatically falls back to template-based output

## Prerequisites

- An active [LLM integration](./llm-integrations.md) configured for your project (or a system-default provider)
- At least one [QuickScript template](./quickscript-templates.md) configured
- A code repository connection (optional, but significantly improves output quality)

## Setting Up Code Repository Context

Connecting a code repository gives the AI access to your actual source files, enabling it to generate scripts that use your real imports, helpers, and patterns.

### 1. Add a Code Repository

Navigate to **Administration > Code Repositories** and add a connection to your repository (GitHub, GitLab, Bitbucket, or Azure DevOps). You'll need to provide credentials with read access to the repository.

### 2. Configure QuickScript Settings

In your project, go to **Settings > QuickScript** to configure:

- **Export Templates** — Assign which QuickScript templates are available for this project and set a project-specific default. See [Per-Project Template Assignment](./quickscript-templates.md#per-project-template-assignment) for details.
- **Repository** — Select which code repository to connect
- **Path Patterns** — Define glob patterns to select the files the AI should reference. Add patterns that point to your test infrastructure:
  - `tests/e2e` with `**/*.ts` — Include all TypeScript files in your E2E test directory
  - `src/pages` with `**/page.tsx` — Include page components for reference
  - `tests/fixtures` with `**/*` — Include test fixtures and helpers

  Use the **Preview Files** button to verify which files match your patterns before saving.

- **Caching** — Enable file caching to avoid fetching files from the repository on every export:
  - **Cache TTL** — How long cached files remain valid (1–30 days)
  - **Automatic Refresh** — Expired caches are automatically refreshed by a daily background job (4 AM), so you never lose code context due to cache expiration
  - **Refresh Cache** — Manually refresh at any time when your repository code changes (e.g., after merging a PR that adds new helpers or page objects)
  - The cache status shows file count, total size, and last fetch time

### How File Relevance Works

When generating a script, the AI doesn't receive your entire repository. Instead, the system:

1. Extracts meaningful terms from the test case name and steps
2. Scores each cached file by relevance to those terms
3. Analyzes import graphs to find related files (e.g., if a test file imports a helper, the helper is ranked higher)
4. Fills the token budget with the most relevant files first

This keeps AI requests focused and efficient, even for large repositories.

## Customizing the AI Prompt

The AI prompt for QuickScript can be customized in **Administration > [Prompt Configurations](./prompt-configurations.md)** under the **Export Code Generation** feature.

### Available Prompt Variables

| Variable | Description |
|----------|-------------|
| `{{FRAMEWORK}}` | Target test framework from the selected template (e.g., Playwright, pytest) |
| `{{LANGUAGE}}` | Target programming language (e.g., TypeScript, Python) |
| `{{CASE_NAME}}` | Name of the test case being generated |
| `{{STEPS_TEXT}}` | Formatted test steps with expected results |
| `{{CODE_CONTEXT}}` | Repository file contents assembled for this test case |

### Prompt Tips

- The default prompt instructs the AI to generate a complete, runnable test file with all imports
- Lower the **temperature** (e.g., 0.2–0.3) for more deterministic, consistent output
- Increase **max output tokens** if your generated scripts are being truncated
- Add framework-specific guidance to the system prompt if the AI isn't following your project's conventions

## Troubleshooting

### Generate with AI Toggle Not Visible

The toggle only appears when an LLM integration is active for the project. Configure one in **Administration > [AI Models](./llm-integrations.md)**.

### Generated Code Uses Generic Patterns

If the AI produces generic framework code instead of referencing your project's helpers:

- Ensure a code repository is connected and cached in **Settings > QuickScript**
- Verify your path patterns include the relevant files (use Preview Files to check)
- Refresh the cache if your repository has changed recently
- If the cache has expired, it will be automatically refreshed by the next daily background run (4 AM) — or click **Refresh Cache** to refresh immediately

### Truncated Output

If a generated file shows a truncation warning, the AI hit its output token limit before completing the script. Solutions:

- Increase **Max Output Tokens** in [Prompt Configurations](./prompt-configurations.md) for the Export Code Generation feature
- Export fewer test cases at once
- Simplify test cases with many steps

### Fallback to Template Output

When the preview shows **Template Generated** instead of **AI Generated** for a file:

- The LLM provider may have returned an error — check your provider's API status
- The test case may have exceeded the input token limit — try with simpler cases
- Retry the export; transient errors often resolve on the next attempt

The download is always available regardless of how many cases fell back to template generation.

---
sidebar_label: 'AI Models'
title: 'AI Models (Project Settings)'
description: Choose a project's default AI model, prompt configuration, and per-feature LLM overrides
---

# AI Models

The project-level **Settings → AI Models** page chooses how AI features behave for this project: the **default AI model**, the **prompt configuration**, and **per-feature overrides**. The models and prompt sets themselves are created globally by a system administrator under [Administration → AI Models](../../llm-integrations.md); here you select from them for your project.

:::note
Only system administrators and project administrators can open this page.
:::

## How to access

1. Open the project and expand **Settings** in the project menu.
2. Select **AI Models**.

## Project Default

The **Project Default** card lists each AI model a system administrator has configured, showing its provider, model name, monthly budget (if set), and a **System Default** badge where applicable.

- **Set as Default** — make a model the project's default. If one is already set, you'll confirm the change.
- **Clear Default** — remove the project's default model.

If no models are available, contact your system administrator to configure them.

## Prompt Configuration

The **Prompt Configuration** dropdown selects which prompt set this project uses. Choose **Use System Default** to inherit the system default, or pick a specific configuration.

## Per-Feature LLM Overrides

The overrides table lets you route individual AI features to a specific model — or turn a feature off — for this project. Each row offers:

- **No override** — use the resolved default (the normal behavior).
- **No LLM (disabled)** — turn the feature off for this project.
- A specific model — force this feature to use it.

The **Effective LLM** and **Source** columns show what each feature will actually use and why.

Features you can override include Markdown test-case parsing, test-case generation, smart test-case selection, the editor writing assistant, the connection test, export code generation, AI tag suggestions, duplicate detection, generate-from-URL (requirements and application testing), and the automation-candidates report.

### How the model is resolved

For any AI feature, TestPlanIt picks the model in this order:

1. **Per-feature override** on this page (highest priority).
2. **Prompt configuration** assignment for that prompt.
3. **Project default** model.
4. If none apply, the feature has no model and is unavailable.

:::info
Clearing the project default does **not** disable features that have a per-feature override or a prompt-configuration assignment — it only removes the fallback model.
:::

## Related pages

- [AI Models (Administration)](../../llm-integrations.md) — configure providers, models, and budgets globally.
- [Prompt Configurations](../../prompt-configurations.md) — manage the prompt sets selected here.

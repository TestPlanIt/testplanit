---
title: Auto Tag
---

# AI-Powered Auto Tagging

The Auto Tag feature uses AI to automatically suggest relevant tags for your test cases, test runs, and exploratory sessions based on their content. You can review, edit, and selectively apply the suggestions before they are saved.

## Overview

Auto Tag helps you:

- **Organize at scale**: Tag hundreds of items in minutes instead of manually tagging each one
- **Maintain consistency**: AI suggests existing tags when appropriate, reducing duplicate or inconsistent tags
- **Discover gaps**: Find untagged items and quickly bring them into your tagging taxonomy
- **Control tag creation**: Allow new tags when needed, or restrict suggestions to existing project tags only

## Prerequisites

- At least one active [LLM integration](./llm-integrations.md) configured for your project (or a system-default provider)
- Items in your project to analyze (test cases, test runs, or sessions)

## Using Auto Tag

Auto Tag can be launched from two places:

### From the Project Tags Page

Click the **Auto-Tag** button in the toolbar to open the Auto Tag wizard.

#### Step 1: Configure

Choose what to analyze:

- **Entity Types**: Select which types of items to tag — test cases, test runs, and/or sessions. At least one type must be selected.
- **Untagged Only**: Toggle this option to limit analysis to items that currently have no tags. This is useful for catching items that were missed during manual tagging.
- **Allow creating new tags**: Keep this enabled to let AI suggest brand-new tags when no good match exists. Disable it to restrict suggestions to existing project tags only.

Click **Start Analysis** to begin.

### From the Project Repository

Select one or more test cases using the checkboxes, then click the **Auto-Tag** button in the bulk action bar. This skips the configuration step and immediately begins analyzing the selected test cases.

### Step 2: Analyzing

The AI processes your items in batches. A progress bar shows the current status for each entity type, including the number of items analyzed out of the total.

- Analysis runs as a background job — you can close the dialog and it will continue processing
- If you reopen the dialog, it will reconnect to the running job and show current progress
- Click **Cancel** to stop the analysis at any time (results from completed batches are preserved)

### Step 3: Review & Apply

Once analysis is complete, the review screen shows all suggested tags organized by entity:

#### Entity List

The left sidebar displays all analyzed items grouped by type. Each item shows:

- The item name
- Number of suggested tags
- A search box to filter items by name

Click an item to see its detailed suggestions on the right.

#### Tag Suggestions

For each item, the AI suggests tags displayed as chips:

- **Existing tags** are shown in a distinct style, indicating the tag already exists in your project
- **New tags** are shown differently, indicating they would be created when applied
- Click a tag chip to toggle it on or off (all suggestions are accepted by default)
- Double-click a tag chip to edit its name before applying

#### Entity Detail

Click the detail icon on any item to view its full content (name, description, test steps, custom fields, and documentation) to help you evaluate the suggestions.

#### Applying Tags

When you're satisfied with the selections:

1. Review the summary showing how many tags will be applied
2. Click **Apply** to save the selected tags to their respective items
3. Existing tags are connected to the items
4. New tags are created only when **Allow creating new tags** is enabled

:::tip Selective Application
You don't have to apply all suggestions at once. Toggle off any tags you don't want, and only the selected ones will be applied. You can also remove entire items from the selection.
:::

## How It Works

### Content Analysis

For each item, the AI receives:

- **Name** and **description**
- **Test steps** and expected results (for test cases)
- **Custom field values** from your templates
- **Existing tags** (to avoid suggesting duplicates)

### Intelligent Tag Matching

When the AI suggests a tag name, the system checks for matches against your existing project tags using:

1. **Exact match** (case-insensitive) — "Smoke" matches "smoke"
2. **Substring match** — looks for existing tags that contain or are contained in the suggestion
3. **Fuzzy match** — uses edit distance to catch typos and close variations (e.g., "authentcation" matches "authentication")

This prevents duplicate tags from being created when an existing tag would be appropriate.

### Batch Processing

Items are processed in batches to stay within the AI model's token limits:

- Each batch is sized automatically based on the configured model's token budget
- Large items (lengthy descriptions or many steps) may be truncated to fit within the budget
- Failed batches are isolated — an error in one batch doesn't affect others

### Background Processing

Auto Tag jobs run as background tasks using a job queue:

- Up to 3 jobs can run concurrently
- Jobs support cancellation mid-processing
- Progress is reported after each batch completes
- Results persist even if you navigate away from the page

## Configuration

### AI Prompt Settings

Auto Tag uses the **AI Tag Suggestions** prompt configuration, which can be customized in the [Prompt Configurations](./prompt-configurations.md) admin page:

- **System prompt**: Customize the instructions given to the AI for tag analysis
- **Temperature**: Adjust creativity (lower = more conservative suggestions, higher = more creative)
- **Max output tokens**: Controls how many items can be processed per batch (higher = more items per request)
- **Model selection**: Choose which AI model to use for tag analysis

### LLM Provider

Auto Tag works with any configured LLM provider. The provider is resolved in this order:

1. Project-level LLM configuration (if set)
2. System-default LLM provider
3. Built-in fallback prompts

## Best Practices

### Start with Untagged Items

Use the **Untagged Only** toggle on your first pass to focus on items that have no tags at all. This gives you the biggest organizational improvement with the least review effort.

### Review Before Applying

While the AI suggestions are generally relevant, always review them before applying:

- Remove tags that are too generic (e.g., "test", "testing")
- Edit tag names to match your team's conventions
- Check that existing tags were matched correctly

### Build Your Tag Taxonomy First

If you already have a well-defined set of tags, the AI will preferentially match against them. Adding your standard tags before running Auto Tag leads to more consistent results.

### Use Existing-Only Mode for Strict Taxonomies

If your team enforces a fixed tag vocabulary, disable **Allow creating new tags** in the wizard. This ensures Auto Tag only proposes tags that already exist in your project and prevents accidental taxonomy drift.

### Run Incrementally

For large projects, consider running Auto Tag on one entity type at a time. This makes the review process more manageable and lets you refine your approach between runs.

## Troubleshooting

### AI Tag Button is Disabled or Missing

**Causes:**

- No LLM integration configured for the project
- User doesn't have permission to manage tags

**Solutions:**

- Configure an [LLM integration](./llm-integrations.md) in project or system settings
- Contact your administrator about tag management permissions

### No Suggestions Returned

**Causes:**

- Items have very little content (empty descriptions, no steps)
- All items already have comprehensive tags (when not using "Untagged Only")
- **Allow creating new tags** is disabled and no existing tags fit the analyzed content

**Solutions:**

- Ensure items have meaningful names and descriptions
- Try running without the "Untagged Only" filter

### Some Items Show as Failed

**Causes:**

- AI provider returned an error for that batch
- Response was too large or malformed

**Solutions:**

- Check your LLM provider's API status
- Try again — transient errors often resolve on retry
- If specific items consistently fail, they may have unusually large content that exceeds token limits

### Suggestions Seem Irrelevant

**Causes:**

- AI model may not have enough context
- Temperature setting may be too high

**Solutions:**

- Customize the system prompt in [Prompt Configurations](./prompt-configurations.md) with guidance specific to your domain
- Lower the temperature setting for more conservative suggestions
- Ensure items have descriptive names and content

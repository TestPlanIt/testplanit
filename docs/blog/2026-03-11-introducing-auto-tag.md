---
slug: introducing-auto-tag
title: "Introducing Auto Tag: AI-Powered Tags for Cases, Runs, and Sessions"
description: "TestPlanIt v0.16.0 ships Auto Tag — let AI analyze your test cases, test runs, and sessions and apply consistent tags in seconds. Keep your repository organized without the manual overhead."
authors: [bdermanouelian]
tags: [release, announcement]
---

Tags are one of those features that looks great in a demo and gets ignored in practice. The concept is solid: label your test cases, test runs, and sessions by area, type, or risk level so you can filter, group, and report on them meaningfully. The reality is that tagging is a manual chore, it's inconsistent across team members, and it's the first thing to slip when you're under pressure to get tests written and runs scheduled. So most repositories end up with either no tags or a sprawl of half-applied, differently-spelled labels that don't actually help anyone filter anything.

TestPlanIt v0.16.0 introduces **Auto Tag** — AI-powered tag suggestions that analyze your test cases, test runs, and sessions and propose relevant tags in bulk. Review the suggestions, accept what fits, and move on. Your existing tags are reused when they match; new ones are created when they don't.

<!-- truncate -->

## The Short Version

1. Open the **Tags** page from the top menu, go to **Project → Tags**, or select cases in the **Repository**.
2. Click **Auto Tag**.
3. AI analyzes your content
4. Review the suggested tags — accept all at once, toogle to select or double-click to rename a tag.
5. Done. Your cases, runs, and sessions are tagged consistently.

No manual taxonomy decisions for each item. No arguing about naming conventions mid-sprint.

## Why Tags Fail Without Automation

The problem isn't that people don't want organized test repositories — it's that the cost of maintaining that organization doesn't pay off quickly enough to feel worth it. Tagging 10 test cases is fine. Tagging 300 cases, 50 test runs, and a backlog of exploratory sessions is a project. And once you're behind, catching up feels impossible, so you don't.

The result is a repository where filtering by tag is useless because the tags aren't reliable and new team members have no consistent model to follow when adding cases or planning runs.

Auto Tag attacks this at the source. Instead of making tagging a discipline you have to enforce, it makes it something that just happens — fast enough that you'll actually do it, and consistent enough that the results are useful.

## How It Works

Auto Tag sends your selected content to your configured LLM. What gets analyzed depends on the entity type:

- **Test cases** — name, folder path, steps and expected results, and any custom field values
- **Test runs** — name, notes, and documentation
- **Sessions** — name, notes, mission statement, and any custom field values

The model proposes tags based on the full content, not just the title. A test case called "Verify login form validation" with steps that walk through email format errors, password length requirements, and empty field handling will get tags that reflect all of that, not just "login."

Crucially, the AI works within your existing tag vocabulary. It reuses tags that are already in your project when they're a good fit. New tags only get created when the content genuinely needs something that doesn't exist yet. This keeps your tag taxonomy coherent instead of exploding into a new set of synonyms every time Auto Tag runs.

## Review Before Applying

Auto Tag doesn't apply anything automatically. You see the proposed tags for each item before anything changes, and you decide what to keep. Accept all suggestions with one click, or go item by item and toggle individual tags on or off. If the AI misread a test case or proposed something that doesn't fit your conventions, skip it — the control stays with you.

This is the right default. AI suggestions are good, not perfect. Reviewing them takes seconds, and it builds trust that what ends up in your repository reflects real decisions, not unreviewed output.

If the suggestions aren't quite right for your team — too broad, too specific, or not matching your taxonomy style — you can tune the prompt. Auto Tag uses TestPlanIt's [configurable AI prompt system](/docs/user-guide/prompt-configurations): administrators can edit the system prompt and user prompt template under **Admin → Prompt Configs** to steer the AI toward your conventions. Tell it to prefer feature-area tags over implementation-detail tags, to always include a priority label, or to match your existing naming patterns. The content analysis stays the same; you're just giving the model better instructions for your context.

## Three Entry Points

Auto Tag is available wherever it makes sense to use it:

- **Tags page** (top menu) — run Auto Tag across cases, runs, and sessions in your full repository or a filtered subset
- **Project → Tags** — tag items within a specific project's context
- **Repository** — select specific test cases and click Auto Tag to tag just those

The Repository entry point is the most targeted: if you've just written a batch of new test cases and want to tag them immediately, select them and run Auto Tag without leaving the view you're already in.

## Getting Started

You'll need an [LLM integration](/docs/user-guide/llm-integrations) configured on your project. Once that's in place, Auto Tag appears in all three locations automatically.

If you're already using AI features like Magic Select or QuickScript, Auto Tag will use the same LLM configuration — nothing extra to set up.

## Upgrade to v0.16.0

```bash
git pull origin main
pnpm install
pnpm generate
pnpm build
```

For Docker deployments:

```bash
docker pull ghcr.io/testplanit/testplanit:latest
```

## Get Involved

- Star the repo on [GitHub](https://github.com/testplanit/testplanit)
- Follow [@TestPlanItHQ](https://x.com/TestPlanItHQ) for updates
- Join our [Community Discord](https://discord.gg/kpfha4W2JH)
- Report issues and suggest features on GitHub

Thank you for using TestPlanIt!

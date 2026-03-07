---
slug: introducing-quickscript
title: "Introducing QuickScript: Turn Test Cases into Automation Code"
description: "TestPlanIt v0.15.0 ships QuickScript — select your manual test cases, pick a framework, and export real automation scripts. With AI generation, your test knowledge finally reaches the codebase."
authors: [bdermanouelian]
tags: [release, announcement]
---

Last week I wrote about [why AI isn't killing manual QA](/blog/ai-isnt-killing-manual-qa) — it's closing the gap between knowing what to test and expressing it as runnable code. That was the argument. Today we're shipping the solution.

TestPlanIt v0.15.0 introduces **QuickScript**, a new feature that converts your manual test cases into automation scripts for Playwright, Cypress, Selenium, pytest, Jest, and any other framework you use. Select cases from the Repository, pick a template, and export. QuickScript can generate complete, context-aware test files that reference your actual page objects, helpers, and utilities.

<!-- truncate -->

Check out the demo to see QuickScript in action:

<iframe width="100%" style={{aspectRatio: '16/9'}} src="https://www.youtube.com/embed/ZUByrgED-ao" title="QuickScript Demo" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

## The Short Version

1. Select test cases in the Repository.
2. Click **QuickScript**.
3. Choose a template and output mode (single file or individual files as a ZIP).
4. Export — or toggle **Generate with AI** for smarter output.
5. Download real, reviewable, version-controllable code.

That's it. No proprietary format, no fighting with no-code limitations, no vendor lock-in. The output is a `.spec.ts`, `.py`, `.feature`, or whatever your template targets. It lives in your repo alongside your application code.

## You Choose How Much AI to Use

Not every team is ready to pipe test data through an LLM, and not every test case needs AI to generate useful output. QuickScript is designed so you decide exactly how much intelligence — and how much external connectivity — you want. It works at three levels, and you can move between them at any time.

### Level 1: Templates Only — No AI, No Data Leaves Your System

QuickScript ships with 40 built-in templates for popular frameworks — Playwright (TypeScript and JavaScript), Cypress, Selenium (Java, Python, C#), Webdriver.io (TypeScript and JavaScript), pytest, Jest, Robot Framework, Gherkin, and plenty more. Each template uses Mustache syntax with three sections:

- **Header** — rendered once at the top of the file (imports, setup)
- **Body** — rendered once per test case (the actual test logic with your case data)
- **Footer** — rendered once at the bottom (cleanup, closing brackets)

This means exporting ten test cases into a single Playwright file produces one clean file with a single import block — not ten copies of the same boilerplate. Templates have access to all your case fields, steps, expected results, and custom fields.

No LLM integration needed. No data sent anywhere. You click Export and get a file. For teams that need to keep test data fully disconnected from external services, this is the starting point — and it's already more useful than copy-pasting test steps into a code editor.

Administrators can edit the built-in templates, create new ones for internal frameworks, set a default, or disable any that aren't relevant. The template editor includes a live preview panel so you can see exactly what the output looks like as you write.

### Level 2: Add AI — Smarter Output, Real Test Logic

Configure an [LLM integration](/docs/user-guide/llm-integrations) on your project and a **Generate with AI** toggle appears in the QuickScript dialog — enabled by default. Instead of static Mustache substitution, each test case gets sent to the AI along with your template's framework context. The AI generates a complete test file — not a skeleton with `// TODO` comments, but actual assertions, setup logic, and framework-idiomatic patterns.

This is where templates go from structured scaffolding to working tests. The AI understands the framework, knows what an assertion should look like, and produces code that a developer can review and run — not just fill in.

### Level 3: Connect Your Code Repository — The Full Picture

This is where it gets interesting. Connect a code repository to your project, and QuickScript feeds the AI context from your actual codebase — the helpers, page objects, fixtures, and utilities most relevant to each test case. The AI doesn't just generate generic Playwright code. It generates code that uses *your* `LoginPage` class, *your* `createTestUser` fixture, *your* project's patterns.

The difference is significant. Without repository context, AI produces good framework-idiomatic code. With it, the output is tailored to your codebase — the imports are right, the helper functions exist, and the patterns match what your team already does. It's the difference between code that looks correct and code that actually fits. And remember — you configure the best LLM for the job and can customize the templates to control the prompts for your specific needs.

### Keep It All Private

Here's what makes this work for security-conscious teams: you don't need to send anything to OpenAI or Anthropic to get the full benefit. TestPlanIt supports [bring-your-own LLM](/blog/stop-renting-ai-bring-your-own-llm) — including local models via **Ollama**. Pair that with an internal Git repository, and you get Level 3 generation with zero data leaving your network. Your test cases, your code, your LLM, your infrastructure. QuickScript just orchestrates it.

### Graceful Fallbacks

If AI generation fails for a particular test case — network issue, token limit, anything — QuickScript falls back to template rendering for that case automatically. The preview pane badges each file as **AI Generated** or **Template Generated** so you know exactly what you're getting. The download is always available.

## Why This Matters

In the [previous post](/blog/ai-isnt-killing-manual-qa), I talked about how no-code tools tried to solve this problem by hiding the code behind a visual abstraction. That approach hits a ceiling — maintenance pain, vendor lock-in, limited debugging, no real version control.

QuickScript takes the opposite approach. The output is real code in a real file. Your automation lead can review it, refactor it, and maintain it with the same tools they use for everything else. If the AI generates something that's 80% right, a developer can fix the last 20% in their IDE. And crucially, every team gets to choose where they sit on the spectrum — from pure templates to full AI-with-repository-context — based on their own comfort level, security requirements, and infrastructure.

The manual tester's job has always been knowing *what* to test. QuickScript makes that knowledge actionable — it turns the domain expertise already captured in your test cases into automation scripts that your team can immediately use, review, and iterate on.

## Getting Started

QuickScript is available from three places:

- **Bulk** — select cases in the Repository and click the QuickScript toolbar button
- **Row action** — click the QuickScript icon on any individual case row
- **Case view** — open a test case and click QuickScript next to the Edit button

For AI generation, you'll need an [LLM integration](/docs/user-guide/llm-integrations) configured on your project. For repository-aware generation, connect a code repository as well.

Template management is under **Administration > QuickScript Templates**. See the [QuickScript Templates docs](/docs/user-guide/quickscript-templates) for details on creating and customizing templates.

## Upgrade to v0.15.0

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

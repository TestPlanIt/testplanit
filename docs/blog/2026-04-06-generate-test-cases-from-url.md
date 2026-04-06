---
slug: generate-test-cases-from-url
title: "Generate Test Cases from Any URL"
description: "TestPlanIt v0.21.0 adds URL-based test case generation — point the AI at a web page, crawl linked pages, and generate test cases with real-time streaming."
authors: [bdermanouelian]
tags: [release, announcement]
---

TestPlanIt v0.21.0 adds a third source for AI-powered test case generation: any publicly accessible URL. Point the wizard at a web page, optionally crawl linked pages, and watch test cases stream in as the AI analyzes each page.

<!-- truncate -->

## Why Generate from a URL?

The Generate Test Cases wizard already supports issues (Jira, GitHub, Azure DevOps) and pasted requirements documents. But not every feature starts with a ticket. Sometimes the spec is a product page, an API reference, a competitor's app, or a staging deployment with no linked issues.

With URL-based generation, you skip the copy-paste step entirely. Give TestPlanIt the URL and let the AI read the page directly.

## How It Works

Open the Generate Test Cases wizard from any repository folder, select the **From URL** tab, and enter a URL.

### Two Modes

- **Application** — Treats the page as a live application. The AI generates functional test cases for the UI, workflows, and features it finds.
- **Requirements** — Treats the page content as a requirements or specification document. The AI generates test cases that verify the described functionality.

### Multi-Page Crawling

Enable **Follow Links** to crawl beyond the seed page. TestPlanIt follows same-domain links up to your configured depth and page limits (max 5 levels deep, up to 50 pages).

As the URL is crawled you'll see a progress bar as each page is fetched. Once crawling finishes, the AI processes each page sequentially, streaming test cases into the review step as they're generated.

Crawled pages respect `robots.txt`, skip duplicate content, and detect single-page applications that may need JavaScript rendering.

### Real-Time Streaming

Test cases appear as collapsible cards the moment the AI starts generating them — you don't have to wait for the entire batch to finish. Each card shows the test case name and expands to reveal all fields, steps, tags, etc. You can immediately start reviewing test cases.

For multi-page crawls, the footer shows which page is being processed and how many test cases have been generated so far.

### Per-Page Folders

When importing test cases from multiple pages, each page's cases are placed in their own subfolder (named after the page). This keeps things organized when a crawl produces dozens of test cases across different sections of a site.

### Safe to Close

Progress is saved after each page completes. If you close the wizard mid-generation, the test cases from completed pages are preserved. When you reopen the wizard, the **Recent Generations** list shows your previous crawls with page counts, test case counts, and timestamps. Click any entry to review the generated test cases.

Results are cached for 7 days. You can remove entries you no longer need from the list.

## Streaming for All Sources

While building the URL feature, we brought the same real-time streaming experience to issue and document generation. Previously, test cases from issues and documents appeared all at once after the AI finished. Now they stream in incrementally — you see partial field values as they arrive, just like with URL generation.

## Performance

Generating lots test cases used to cause browser rendering/memory issues. Now hundreds of test cases are rendered smoothly each their own collapsible cards. The collapsed view shows the name, folder label, and tags. Click the chevron to expand and see all template fields and steps. This makes it much easier to scan through a large batch before importing.

## Interactive Tag Editing

Tags in edit mode now use interactive badges instead of a comma-separated text input. Each tag appears as a removable badge — click the X to remove it. Type and press Enter or comma to add a new tag. Backspace removes the last tag when the input is empty.

## Try It Out

Open the Generate Test Cases wizard from any repository folder, switch to the **From URL** tab, and paste a URL. Start with a single page to see the quality, then try multi-page crawling for broader coverage.

[Read the full documentation](/docs/user-guide/llm-test-generation)

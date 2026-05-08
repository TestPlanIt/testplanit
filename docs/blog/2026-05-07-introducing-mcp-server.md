---
slug: introducing-mcp-server
title: "Introducing the TestPlanIt MCP Server: Talk to Your Test Data"
description: "The TestPlanIt MCP Server lets AI assistants like Claude and Cursor read and act on your test data directly — no copy-pasting, no context switching, no manual lookups."
authors: [bdermanouelian]
tags: [release, announcement]
---

Most of the time, your AI assistant and your test management tool live in completely separate worlds. You're in Claude or Cursor, you want to know something about your test coverage, and you either have to go look it up yourself or paste a wall of data into the chat and hope the AI makes sense of it. The AI is smart but blind — it can't see your TestPlanIt data, so it can't actually help you with it.

The TestPlanIt MCP Server changes that.

<!-- truncate -->

## What it is

MCP stands for Model Context Protocol — a standard that lets AI assistants connect to external tools and read or act on live data. With the TestPlanIt MCP Server installed, Claude, Cursor, or any MCP-compatible AI client can query your TestPlanIt account directly during a conversation.

You don't paste anything. You don't switch tabs. The AI asks TestPlanIt, gets real data, and uses it to answer your question.

## What you can actually do

Here are the kinds of conversations you can have once it's set up.

**When a ticket lands:**

> "Add test cases for JIRA-1234 and put together a test run for those cases, plus any other cases that validate that nothing it touches has regressed."

The AI looks up the ticket, reads what it describes, and creates test cases for the new behavior — writing them directly into your repository. Then it searches your existing test suite for cases in folders related to what the ticket describes, builds a run with the new cases and the relevant regression cases together, and links everything back to JIRA-1234. You go from ticket to test run without opening the TestPlanIt UI.

**Before a release:**

> "Which test cases in the Authentication folder haven't been run in the last two weeks?"

The AI checks your repository and test run history, finds the cases that are overdue for execution, and gives you a prioritized list — without you building a filter or exporting a report.

**During a sprint:**

> "How much test coverage do we have for the checkout flow? What's failing?"

Instead of navigating to the repository, building a filter, switching to test runs, and correlating the results yourself, you get a summary in the chat.

**After a QA session:**

> "Summarize everything we found in today's exploratory sessions. Any patterns across sessions?"

The AI reads the session results and notes, finds the common themes, and drafts a summary you can paste into a ticket or a standup.

**When planning:**

> "How much work is left in the current milestone? Which milestones are at risk?"

It looks at milestone completion status, linked test runs, and open sessions and gives you a straight answer.

## Why this matters for QA teams

QA teams spend a lot of time translating between systems. A developer asks a question in Slack, you go look it up in TestPlanIt, come back with an answer, and then get asked a follow-up that requires another lookup. It's not a problem with TestPlanIt — it's a problem with information living in one place and conversations happening in another.

The MCP Server collapses that gap. When your AI assistant can read your test data in real time, it becomes a useful participant in planning conversations instead of a writing tool you have to separately feed information to.

It also means you can ask questions you'd normally skip because the lookup cost isn't worth it. "How many test cases did I write last month?" is a simple question, but getting the answer manually requires a filter, maybe building a report, and a few minutes. With the MCP Server, it's one sentence.

## What the MCP Server can do

The initial release covers the full read and write surface of TestPlanIt:

- **Test cases** — search, filter by folder, tag, status, creator, date range; create, update, delete
- **Test runs** — create runs, add cases, submit results, update state; read details, case results, step results, and linked issues
- **Sessions** — create and update exploratory test sessions; read results and notes
- **Milestones** — create, update, and mark complete; read completion status, linked runs, and descendant structure
- **Repositories and issues** — linked cases, external issue connections
- **Issue links** — link or unlink test cases, sessions, test runs, and results to issues in a single call

Together these close the loop on the full testing workflow in a single conversation: find an issue, create cases for it, and build a test run — without leaving the chat.

All operations are scoped to your API token's permissions. The AI can only see and modify what your account can access.

## Getting started

The MCP Server is a standalone package you install once. It authenticates with your existing TestPlanIt API token and works with any MCP-compatible client — Claude Desktop, Cursor, and others.

Full setup instructions are in the [MCP Server documentation](/docs/mcp-server).

---

The MCP Server is open source alongside the rest of TestPlanIt. If there's a query pattern or action you'd like to see added, open an issue or discussion on GitHub.

- Star the repo on [GitHub](https://github.com/testplanit/testplanit)
- Follow [@TestPlanItHQ](https://x.com/TestPlanItHQ) for updates
- Join our [Community Discord](https://discord.gg/kpfha4W2JH)

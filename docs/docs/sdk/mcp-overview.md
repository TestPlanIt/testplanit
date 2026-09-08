---
sidebar_label: 'MCP Server'
title: TestPlanIt MCP Server (@testplanit/mcp-server)
sidebar_position: 1
---

# TestPlanIt MCP Server

The TestPlanIt MCP server lets AI agents — Claude Desktop, Cursor, custom MCP-aware clients — connect to a TestPlanIt instance and query test management data on your behalf. It speaks the [Model Context Protocol](https://modelcontextprotocol.io/) over stdio JSON-RPC and authenticates via a TestPlanIt API token.

## What an agent can ask

- List, fetch, create (one at a time or many in a single bulk call), update, and soft-delete test cases (with steps, custom fields, tags, folder breadcrumb, linked issues, and linked automated tests inline)
- List a project's templates and the case fields each defines, and choose which template a new case uses — custom fields are validated against that template
- List and create test runs, add cases to existing runs, submit test results, and update run state
- List sessions, session results, and session findings — the exploratory testing surface — and create or update sessions
- Create and update milestones, mark them started or complete, and list milestone progress with pooled status rollups inline
- Resolve issues by external key (Jira / GitHub / Azure DevOps) and walk the issue → linked test cases graph
- Traverse the bridge between automated tests (repository cases) and manual test cases via repository case links
- List code repositories configured in a project (with credentials never returned)
- List folders and tags scoped to a project, with usage counts and tree relationships preserved — the folder tree to any depth, with recursive and automated-case subtree totals on request
- Count test cases server-side under any case filter, grouped by folder, top-level area, tag, state, source, or creator — automation-coverage rollups without paginating the repository
- Generate a QuickScript (AI automation script) from one or more test cases, following the project's connected code repository when one is configured
- List the review requests assigned to you — the Review inbox queue, covering both direct assignment and assignment to a role you hold — with the subject, the workflow transition being requested, and the requester's note
- Approve, request changes on, or reject a review request on your behalf — the same eligibility, append-only, and auto-transition rules the app enforces, and refused outright for read-only tokens

See the [npm package README](https://www.npmjs.com/package/@testplanit/mcp-server) for the full tool reference, including request/response schemas for all 50 tools.

## Installation

```bash
npx @testplanit/mcp-server
```

There is no daemon to manage and no port to forward. Your MCP-aware client launches the server as a stdio subprocess on demand. The server exits after the client disconnects.

## Environment variables

### Required

| Variable               | Description                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `TESTPLANIT_API_TOKEN` | API token from your TestPlanIt profile. Must start with `tpi_`. Mint one under **Profile → API Tokens**. |
| `TESTPLANIT_API_URL`   | Base URL of your TestPlanIt instance (e.g. `https://yourcompany.testplanit.com`).                        |

The server validates `TESTPLANIT_API_TOKEN` on startup and exits cleanly with a human-readable error if the token is invalid, expired, or unreachable — your agent reports a clean failure rather than hanging.

## Next steps

- [Configuration](./mcp-configuration.md) — Claude Desktop / Cursor snippets, token scopes, and the read-only agent token walkthrough
- [Example prompts](./mcp-prompts.md) — agent prompts for issue lookup, run history, and maintenance flows
- [npm package README](https://www.npmjs.com/package/@testplanit/mcp-server) — full tool catalog with request/response schemas

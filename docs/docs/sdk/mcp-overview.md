---
sidebar_label: 'MCP Server'
title: TestPlanIt MCP Server (@testplanit/mcp-server)
sidebar_position: 1
---

# TestPlanIt MCP Server

The TestPlanIt MCP server lets AI agents — Claude Desktop, Cursor, custom MCP-aware clients — connect to a TestPlanIt instance and query test management data on your behalf. It speaks the [Model Context Protocol](https://modelcontextprotocol.io/) over stdio JSON-RPC and authenticates via a TestPlanIt API token.

## What an agent can ask

- List, fetch, create, update, and soft-delete test cases (with steps, custom fields, tags, folder breadcrumb, linked issues, and linked automated tests inline)
- List test runs and run-results, including step-level results and inline executor identity
- List sessions, session results, and session findings — the exploratory testing surface
- Resolve issues by external key (Jira / GitHub / Azure DevOps) and walk the issue → linked test cases graph
- Traverse the bridge between automated tests (repository cases) and manual test cases via repository case links
- List code repositories configured in a project (with credentials never returned)
- List folders and tags scoped to a project, with usage counts and tree relationships preserved

See the [npm package README](https://www.npmjs.com/package/@testplanit/mcp-server) for the full tool reference, including request/response schemas for all 28 tools.

## Installation

```bash
npx @testplanit/mcp-server
```

There is no daemon to manage and no port to forward. Your MCP-aware client launches the server as a stdio subprocess on demand. The server exits after the client disconnects.

## Environment variables

### Required

| Variable               | Description |
| ---------------------- | ----------- |
| `TESTPLANIT_API_TOKEN` | API token from your TestPlanIt profile. Must start with `tpi_`. Mint one under **Profile → API Tokens**. |

### Optional

| Variable             | Default                          | Description |
| -------------------- | -------------------------------- | ----------- |
| `TESTPLANIT_API_URL` | TestPlanIt SaaS endpoint         | Override for self-hosted instances. |

The server validates `TESTPLANIT_API_TOKEN` on startup and exits cleanly with a human-readable error if the token is invalid, expired, or unreachable — your agent reports a clean failure rather than hanging.

## Next steps

- [Configuration](./mcp-configuration.md) — Claude Desktop / Cursor snippets, token scopes, and the read-only agent token walkthrough
- [Example prompts](./mcp-prompts.md) — Read-only and PR Test Impact flow examples
- [npm package README](https://www.npmjs.com/package/@testplanit/mcp-server) — full tool catalog with request/response schemas

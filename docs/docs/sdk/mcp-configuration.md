---
title: Configuration
sidebar_position: 2
---

# Configuration

Wire the TestPlanIt MCP server into your AI client and provision a token scoped for agent use.

## Configuration

### Claude Desktop

Edit your Claude Desktop config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "testplanit": {
      "command": "npx",
      "args": ["-y", "@testplanit/mcp-server"],
      "env": {
        "TESTPLANIT_API_TOKEN": "tpi_your_token_here",
        "TESTPLANIT_API_URL": "https://your-instance.testplanit.com"
      }
    }
  }
}
```

Restart Claude Desktop after editing. The TestPlanIt server appears in the MCP servers list. Send a message asking Claude to *use the testplanit whoami tool* to verify the wiring.

### Cursor

Edit your Cursor MCP config file:

- Global: `~/.cursor/mcp.json`
- Project-scoped: `.cursor/mcp.json` in your project root

```json
{
  "mcpServers": {
    "testplanit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@testplanit/mcp-server"],
      "env": {
        "TESTPLANIT_API_TOKEN": "tpi_your_token_here",
        "TESTPLANIT_API_URL": "https://your-instance.testplanit.com"
      }
    }
  }
}
```

Restart Cursor after editing. If you prefer to pull the token from your shell environment rather than hardcoding it, Cursor supports interpolation: `"TESTPLANIT_API_TOKEN": "${env:TESTPLANIT_API_TOKEN}"`.

## Token scopes

API tokens have two optional scope tags that change the server's behavior:

- **`mode:read`** — narrows the token to read-only operations across REST and MCP. Recommended for agents that should query data but never modify it. The host enforces a single chokepoint and write attempts return a structured `READ_ONLY_TOKEN` error before the underlying mutation runs.
- **`client:mcp`** — attributes audit-log entries from this token to the MCP source (`metadata.source: "mcp"`). The attribution is derived from the token scope itself — it cannot be forged from request-time headers. Recommended for any token used by an MCP-aware agent so administrators can correctly attribute agent-driven changes.

Empty scopes (the default for pre-existing tokens) means full access with audit source `"api"` — backwards compatible.

## Create a read-only agent token

1. Sign into your TestPlanIt instance and open your **Profile**.
2. Open the **API Tokens** section and click **Create API Token**.
3. Enter a descriptive name (e.g., *"Claude Desktop — Read-only"*).
4. Optionally set an expiration date.
5. Check **Read-only**. Helptext: *"Use for AI agents that should only query data, never modify it."*
6. Check **Mark as agent token**. Helptext: *"Tags audit log entries with metadata.source: \"mcp\" so admins can attribute agent-driven changes."*
7. Click **Create**.
8. Copy the token (starts with `tpi_`) — it is shown only once.

:::warning Important
TestPlanIt stores only a hashed version of the token and cannot retrieve the original. Copy and store it in your client config or password manager immediately.
:::

Tokens with both scopes set show a **Read-only** badge and an **Agent token** badge in the API Tokens list — use these to confirm you're configuring the right token in your AI client.

## Tool catalog

The full tool catalog — 28 tools across cases, folders, tags, projects, test runs, results, sessions, findings, code repositories, issues, and repository case links — lives in the [npm package README](https://www.npmjs.com/package/@testplanit/mcp-server). Each tool entry shows its input parameters, output shape, and (where applicable) which killer-app composition it participates in.

## Troubleshooting

### Server exits with `INVALID_TOKEN` or `EXPIRED_TOKEN`

**Symptoms:** The agent reports the MCP server failed to start. Logs show a token like `tpi_xxxx` (redacted) flagged as invalid or expired.

**Fix:** Mint a new token under **Profile → API Tokens** and update your client config. Check the expiration date on existing tokens. See the [API Tokens — Authentication Errors](../api-tokens.md#authentication-errors) table for the full error code list.

### Write tool returns `READ_ONLY_TOKEN`

**Symptoms:** A read tool succeeds, but any create/update/soft-delete tool returns a structured `READ_ONLY_TOKEN` error.

**Cause:** The token has `mode:read` scope and the host blocks all writes for it across REST and MCP.

**Fix:** If your agent only queries data, this is the correct behavior. If you genuinely need writes, mint a separate non-read-only token and keep the read-only token for the agent that doesn't need writes — running both side by side is the recommended pattern.

### Agent doesn't see the testplanit tools

**Fix:** Restart the AI client after editing the config file. For Claude Desktop, confirm the MCP servers panel lists `testplanit`. For Cursor, check **Settings → MCP** — the entry should be enabled.

## See also

- [Overview](./mcp-overview.md) — what the MCP server does
- [Example prompts](./mcp-prompts.md) — agent prompt examples
- [API Tokens](../api-tokens.md) — general API token management

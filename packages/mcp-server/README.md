# @testplanit/mcp-server

Model Context Protocol server for [TestPlanIt](https://github.com/testplanit/testplanit) — exposes test-management data to AI agents (Claude Desktop, Cursor, etc.) over stdio JSON-RPC.

## Quick install

```sh
npx @testplanit/mcp-server
```

The server runs as a stdio MCP transport — your MCP-aware client (Claude Desktop, Cursor, etc.) starts it on demand. There is no daemon to manage and no port to forward.

## Environment variables

| Variable               | Required | Description                                                                                              |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `TESTPLANIT_API_TOKEN` | yes      | API token from your TestPlanIt profile. Must start with `tpi_`. Mint one under **Profile → API Tokens**. |
| `TESTPLANIT_API_URL`   | no       | Override for self-hosted instances. Defaults to the TestPlanIt SaaS endpoint when unset.                 |

The server validates `TESTPLANIT_API_TOKEN` against the TestPlanIt API on startup. Invalid, expired, or revoked tokens cause the server to exit with code 1 before the MCP handshake completes — the agent will report a clean failure rather than hang.

## Token scopes

API tokens have two optional scope tags that change the server's behavior:

- **`mode:read`** — narrows the token to read-only operations across REST and MCP. The host enforces a single chokepoint that returns HTTP 403 with `code: "READ_ONLY_TOKEN"` on any write attempt; the MCP server translates that into a friendly agent-visible error. Recommended for AI agents that should be able to query data but never modify it.
- **`client:mcp`** — attributes audit-log entries from this token to the MCP source (`metadata.source: "mcp"`). The attribution is derived from the token scope itself — it cannot be forged by request-time headers. Recommended for any token used by an MCP-aware agent so administrators can correctly attribute agent-driven changes.

Set scopes when creating the token in **Profile → API Tokens** (checkboxes: "Read-only" and "Mark as agent token"). A token with no scopes behaves as a full-access traditional API token (backwards compatible).

## Tool catalog (Phase 5)

| Tool     | Description                                                     |
| -------- | --------------------------------------------------------------- |
| `whoami` | Debug: returns the authenticated user (token owner) and scopes. |

Phase 5 ships exactly one tool. The production read/write tool surface (test-case domain, execution domain, repository domain) lands in Phase 6+.

## Claude Desktop configuration

Add the server to your `claude_desktop_config.json`:

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

Restart Claude Desktop after editing the config. The TestPlanIt server should appear in the MCP servers list. Send a message asking Claude to "use the testplanit whoami tool" to verify the wiring.

## Diagnostics

- All diagnostic output is written to **stderr**. Stdout is reserved for the JSON-RPC stream — never write to it.
- On token-validation failure, a clear error is written to stderr and the process exits with code 1 **before** the agent expects a handshake response. Check the host client's MCP logs for the stderr text.
- Token strings are redacted to the first 8 characters (`tpi_xxxx`) in any error message — the full secret is never logged.

## Security notes

- Published with [npm provenance attestation](https://docs.npmjs.com/generating-provenance-statements). Verify the published artifact's chain of custody with:
  ```sh
  npm audit signatures @testplanit/mcp-server
  ```
- The package's `publishConfig` locks `provenance: true` and `access: "public"` at the source. The release workflow in this repo declares `id-token: write` so npm can attest the build.
- Read-only enforcement (`mode:read`) is verified end-to-end via Playwright in the host repo (`testplanit/e2e/tests/api-tokens/scopes.spec.ts`) — the chokepoint is shared with the REST API, so any client (browser, MCP, custom integration) hits the same gate.

## Roadmap

Phase 6+ adds production tools for the test-case, execution, and repository domains. Each new tool plugs into the same registry pattern (`tools/index.ts → registerAll`) without touching `server.ts`. The error-mapping seam (`mapHttpErrorToToolResult`) is already shared, so write tools that hit a `READ_ONLY_TOKEN` 403 surface the same friendly message Phase 5's `whoami` would.

## License

MIT

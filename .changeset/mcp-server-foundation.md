---
"@testplanit/mcp-server": minor
---

Initial release: Model Context Protocol server for TestPlanIt.

- Stdio MCP server invokable via `npx @testplanit/mcp-server`.
- Authenticates via `TESTPLANIT_API_TOKEN`; supports self-hosted instances via `TESTPLANIT_API_URL`.
- Token validation on startup with clear error and clean exit on failure.
- Single `whoami` tool returns the authenticated user and scopes (debug). Production tool catalog lands in Phase 6+.
- Read-only API token flag (`mode:read` scope tag on the existing `ApiToken.scopes` field) enforced symmetrically across REST and MCP.
- MCP audit attribution (`metadata.source: "mcp"`) derived from `client:mcp` scope tag — unforgeable by request-time headers.

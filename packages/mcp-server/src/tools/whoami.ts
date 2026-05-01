import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { validateToken, TestPlanItHttpError } from "../http.js";
import type { EnvConfig } from "../env.js";
import { mapHttpErrorToToolResult } from "../errors.js";

export interface WhoamiDeps {
  env: EnvConfig;
}

/**
 * Register the `whoami` MCP tool — the production replacement for plan
 * 05-06's smoke tool.
 *
 * The tool re-fetches `GET /api/auth/whoami` on every invocation (NOT
 * cached from the bootstrap probe) so scope changes — particularly the
 * read-only flag — reflect immediately.
 *
 * On failure, the handler consumes the wider `ValidateResult` shape locked
 * in plan 05-06 by reading `probe.code` and `probe.statusCode` directly,
 * NOT by string-parsing `probe.message`. The constructed
 * `TestPlanItHttpError` is then translated by `mapHttpErrorToToolResult`
 * which knows how to format `READ_ONLY_TOKEN` (T-05-01 mitigation) and the
 * other 7 host errorCodes.
 *
 * The description starts with `"Debug:"` so well-behaved agents
 * deprioritize this tool versus the data tools shipping in Phase 6+.
 */
export function registerWhoami(server: McpServer, deps: WhoamiDeps): void {
  server.registerTool(
    "whoami",
    {
      description:
        "Debug: returns the authenticated user (token owner) and scopes.",
      // RAW zod shape per SDK Pitfall 4 — NOT z.object({}).
      inputSchema: {},
      outputSchema: {
        id: z.string(),
        name: z.string().nullable(),
        email: z.string().email(),
        scopes: z.array(z.string()),
        readOnly: z.boolean(),
        isAgent: z.boolean(),
      },
    },
    async () => {
      try {
        const probe = await validateToken(deps.env);
        if (!probe.ok) {
          // Consume the wider ValidateResult shape locked in plan 05-06.
          // probe.code and probe.statusCode flow through unchanged — no
          // string-includes parsing of probe.message.
          throw new TestPlanItHttpError(probe.message, {
            statusCode: probe.statusCode,
            code: probe.code,
          });
        }
        // The MCP SDK's tool-result `structuredContent` is typed as
        // `Record<string, unknown>`. WhoamiUser is locked at plan 05-06 and
        // does not carry an index signature, so we widen here at the
        // boundary — the runtime shape is unchanged, the cast only
        // satisfies TS's structural compatibility check against the SDK's
        // CallToolResult contract.
        return {
          content: [{ type: "text", text: JSON.stringify(probe.user) }],
          structuredContent: { ...probe.user } as Record<string, unknown>,
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}

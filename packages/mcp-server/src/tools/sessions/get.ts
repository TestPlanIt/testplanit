import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  SESSION_DETAIL_INCLUDE,
  mapSessionDetail,
  type RawSessionDetail,
} from "./shared.js";

export interface SessionsGetDeps {
  env: EnvConfig;
}

const SESSION_RESULTS_INLINE_CAP = 100;

export function registerSessionsGet(
  server: McpServer,
  deps: SessionsGetDeps,
): void {
  server.registerTool(
    "testplanit_sessions_get",
    {
      description:
        "Fetch a single session by id with denormalized header (state/createdBy/assignedTo/template/configuration/milestone/tags), session-level linked issues, mission and note (ProseMirror -> plain text), customFields (flat name-keyed dict from sessionFieldValues), and sessionResults inline up to 100 (D7-12 — when more exist, `truncated: true` is set; call testplanit_session_results_list({sessionId}) with cursor pagination for the full set). (per SESS-02 / D7-12)",
      inputSchema: {
        sessionId: z.number().int().positive(),
      },
    },
    async (input) => {
      try {
        const raw = await zenstack<RawSessionDetail | null>(
          "sessions",
          "findUnique",
          {
            where: { id: input.sessionId },
            include: SESSION_DETAIL_INCLUDE,
          },
          deps.env,
        );

        if (!raw) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Session ${input.sessionId} not found.`,
              },
            ],
          };
        }

        // D7-12: detect overflow via the take:101 cap on the include shape.
        // Trim the raw rows to the inline cap (100) BEFORE mapping so the
        // surfaced sessionResults array never exceeds the documented bound.
        const sessionResultsRaw = raw.sessionResults ?? [];
        const truncated = sessionResultsRaw.length > SESSION_RESULTS_INLINE_CAP;
        const trimmedRaw: RawSessionDetail = {
          ...raw,
          sessionResults: truncated
            ? sessionResultsRaw.slice(0, SESSION_RESULTS_INLINE_CAP)
            : sessionResultsRaw,
        };

        const detail = mapSessionDetail(trimmedRaw, { truncated });

        return {
          content: [{ type: "text", text: JSON.stringify(detail) }],
          structuredContent: detail as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}

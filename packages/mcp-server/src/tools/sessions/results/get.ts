import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../../api.js";
import type { EnvConfig } from "../../../env.js";
import { mapHttpErrorToToolResult } from "../../../errors.js";
import {
  SESSION_RESULT_DETAIL_INCLUDE,
  mapSessionResultDetail,
  type RawSessionResultDetail,
} from "../shared.js";

export interface SessionResultsGetDeps {
  env: EnvConfig;
}

export function registerSessionResultsGet(
  server: McpServer,
  deps: SessionResultsGetDeps,
): void {
  server.registerTool(
    "testplanit_session_results_get",
    {
      description:
        "Fetch a single session result by id. Returns the result with denormalized status, createdBy (the executor — sessions don't have a separate executor field; per D7-13), session summary, attachments, linked issues, and customFields (resultFieldValues denormalized to a flat name-keyed dict per A3 — same shape as caseFieldValues for read). NOTE: no step-level results — sessions are exploratory and don't have ordered steps (per D7-13). resultData is surfaced as plain text (resultDataText) via ProseMirror extraction. (per SESS-04 / D7-13)",
      inputSchema: {
        // T-07-04 IDOR mitigation: positive integer only; non-int / non-positive
        // values rejected at the zod boundary before zenstack is called. Host's
        // ZenStack @@allow policy is the per-row access boundary.
        resultId: z.number().int().positive(),
      },
    },
    async (input) => {
      try {
        const raw = await zenstack<RawSessionResultDetail | null>(
          "sessionResults",
          "findUnique",
          {
            where: { id: input.resultId },
            // SESSION_RESULT_DETAIL_INCLUDE (07-01) ships:
            //   - status / createdBy / session denormalized
            //   - attachments (isDeleted:false), issues (isDeleted:false)
            //   - resultFieldValues with field.type.type + field.fieldOptions[].fieldOption
            // The constant is `as const satisfies Prisma.SessionResultsInclude`
            // so a schema drift fails at typecheck (Phase 6 WR-09 invariant).
            include: SESSION_RESULT_DETAIL_INCLUDE,
          },
          deps.env,
        );

        if (!raw) {
          // T-07-02 IDOR: when host @@allow denies the row, findUnique returns
          // null. Surface as not-found rather than 403 to avoid leaking row
          // existence to unauthorized callers.
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Session result ${input.resultId} not found.`,
              },
            ],
          };
        }

        const detail = mapSessionResultDetail(raw);
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

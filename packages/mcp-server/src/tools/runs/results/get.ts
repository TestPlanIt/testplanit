import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../../api.js";
import type { EnvConfig } from "../../../env.js";
import { mapHttpErrorToToolResult } from "../../../errors.js";
import {
  RUN_RESULT_DETAIL_INCLUDE,
  mapRunResultDetail,
  type RawRunResultDetail,
} from "../shared.js";

export interface RunResultsGetDeps {
  env: EnvConfig;
}

export function registerRunResultsGet(
  server: McpServer,
  deps: RunResultsGetDeps,
): void {
  server.registerTool(
    "testplanit_test_run_results_get",
    {
      description:
        "Fetch a single test run result with step-level results inlined (drill-down model — D7-09; no separate step-results-list tool). Each step result carries stepText / expectedResultText (ProseMirror plain-text), status (from the stepStatus relation per R2 / schema.zmodel:2437), notes (ProseMirror), evidence (Json surfaced as-is per D7-08), attachments, and linked issues. Top-level result includes customFields (resultFieldValues denormalized) and the parent testRunCase summary. (per EXEC-05 / D7-07)",
      inputSchema: {
        // T-07-04 IDOR mitigation: positive integer only; non-int / non-positive
        // rejected at the zod boundary before zenstack is called. Host's
        // ZenStack @@allow policy is the row-level access boundary.
        resultId: z.number().int().positive(),
      },
    },
    async (input) => {
      try {
        const raw = await zenstack<RawRunResultDetail | null>(
          "testRunResults",
          "findUnique",
          {
            where: { id: input.resultId },
            // RUN_RESULT_DETAIL_INCLUDE (07-01) ships the full step-level
            // shape: stepResults with stepStatus (R2), step text, attachments,
            // issues, plus top-level resultFieldValues / attachments / issues.
            // The constant is `as const`
            // so a schema drift fails at typecheck (Phase 6 WR-09 invariant).
            include: RUN_RESULT_DETAIL_INCLUDE,
          },
          deps.env,
        );

        if (!raw) {
          // T-07-02 IDOR: when the host's ZenStack @@allow policy denies the
          // row, findUnique returns null. Surface as a not-found rather than
          // a 403 to avoid leaking row-existence to unauthorized callers.
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Test run result ${input.resultId} not found.`,
              },
            ],
          };
        }

        const detail = mapRunResultDetail(raw);
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

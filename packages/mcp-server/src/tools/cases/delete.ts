import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";

export interface CasesDeleteDeps {
  env: EnvConfig;
}

const CASE_DELETE_SELECT = {
  id: true,
  isDeleted: true,
} as const;

/**
 * Soft-delete a test case.
 *
 * Implementation invariant (T-06-06): this handler ONLY uses
 * `zenstack("repositoryCases", "update", { data: { isDeleted: true } })`.
 * The ZenStack `delete` and `deleteMany` operations are NEVER invoked — the
 * soft-delete invariant is enforced at the package layer as defense in depth
 * (the host's ZenStack access policies would also reject hard-delete for
 * non-admin roles, but we don't rely on that).
 */
export function registerCasesDelete(
  server: McpServer,
  deps: CasesDeleteDeps,
): void {
  server.registerTool(
    "testplanit_cases_delete",
    {
      description:
        "Soft-delete a test case by id. Sets isDeleted=true so the case is hidden from subsequent list/get queries. Returns { id, isDeleted: true }. (per D-05 / CASE-05)",
      inputSchema: {
        caseId: z.number().int().positive().describe("ID of the test case to soft-delete."),
      },
    },
    async (input) => {
      try {
        const result = await zenstack<{ id: number; isDeleted: boolean }>(
          "repositoryCases",
          "update",
          {
            where: { id: input.caseId },
            data: { isDeleted: true },
            select: CASE_DELETE_SELECT,
          },
          deps.env,
        );
        const out = { id: result.id, isDeleted: result.isDeleted };
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          structuredContent: out as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}

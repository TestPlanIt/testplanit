import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  RepositoryCasesSelect,
  RepositoryCasesWhereInput,
  RepositoryFoldersSelect,
  RepositoryFoldersWhereInput,
} from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { TestPlanItHttpError } from "../../http.js";

export interface FoldersDeleteDeps {
  env: EnvConfig;
}

const FOLDER_DELETE_SELECT = {
  id: true,
  isDeleted: true,
} as const satisfies RepositoryFoldersSelect;

/**
 * Soft-delete a folder. The MCP tool layer enforces the "no cases,
 * no sub-folders" rule (BL-01) before issuing the soft-delete PATCH —
 * the host REST API does NOT enforce this constraint at the ZenStack
 * layer (verified by validation-errors.spec.ts), so the pre-check has
 * to live here.
 *
 * Non-empty folders yield a structured TestPlanItHttpError with status
 * 422 which `mapHttpErrorToToolResult` surfaces as a CASE-12 error.
 *
 * T-06-06: ALWAYS uses `update` with `isDeleted: true`. NEVER calls
 * ZenStack `delete` or `deleteMany`.
 */
export function registerFoldersDelete(server: McpServer, deps: FoldersDeleteDeps): void {
  server.registerTool(
    "testplanit_folders_delete",
    {
      description:
        "Soft-delete a folder by id. Folders with cases or sub-folders cannot be deleted; the tool returns a structured error in that case. Returns { id, isDeleted: true } on success.",
      inputSchema: {
        folderId: z.number().int().positive(),
      },
    },
    async (input) => {
      try {
        // BL-01: pre-check that the folder is empty before issuing the
        // soft-delete PATCH. Two `findMany` reads with take:1 are cheap
        // and avoid double-counting on the host. Empty arrays mean clear.
        const [activeCases, activeChildren] = await Promise.all([
          zenstack<Array<{ id: number }>>(
            "repositoryCases",
            "findMany",
            {
              where: {
                folderId: input.folderId,
                isDeleted: false,
              } satisfies RepositoryCasesWhereInput,
              select: { id: true } satisfies RepositoryCasesSelect,
              take: 1,
            },
            deps.env,
          ),
          zenstack<Array<{ id: number }>>(
            "repositoryFolders",
            "findMany",
            {
              where: {
                parentId: input.folderId,
                isDeleted: false,
              } satisfies RepositoryFoldersWhereInput,
              select: { id: true } satisfies RepositoryFoldersSelect,
              take: 1,
            },
            deps.env,
          ),
        ]);
        if (activeCases.length > 0 || activeChildren.length > 0) {
          const reasons: string[] = [];
          if (activeCases.length > 0) reasons.push("active cases");
          if (activeChildren.length > 0) reasons.push("active sub-folders");
          throw new TestPlanItHttpError(
            `Folder ${input.folderId} is not empty (contains ${reasons.join(" and ")}). Move or soft-delete contents first.`,
            { statusCode: 422 },
          );
        }

        const result = await zenstack<{ id: number; isDeleted: boolean }>(
          "repositoryFolders",
          "update",
          {
            where: { id: input.folderId },
            data: { isDeleted: true },
            select: FOLDER_DELETE_SELECT,
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

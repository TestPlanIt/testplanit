import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";

export interface FoldersDeleteDeps {
  env: EnvConfig;
}

/**
 * Soft-delete a folder. The host enforces the "no cases, no sub-folders"
 * rule — a non-empty folder yields HTTP 422 which `mapHttpErrorToToolResult`
 * surfaces as a structured tool error (CASE-12).
 *
 * T-06-06: ALWAYS uses `update` with `isDeleted: true`. NEVER calls
 * ZenStack `delete` or `deleteMany`.
 */
export function registerFoldersDelete(server: McpServer, deps: FoldersDeleteDeps): void {
  server.registerTool(
    "testplanit_folders_delete",
    {
      description:
        "Soft-delete a folder by id. Folders with cases or sub-folders cannot be deleted; the host returns a structured error in that case. Returns { id, isDeleted: true } on success.",
      inputSchema: {
        folderId: z.number().int().positive(),
      },
    },
    async (input) => {
      try {
        const result = await zenstack<{ id: number; isDeleted: boolean }>(
          "repositoryFolders",
          "update",
          {
            where: { id: input.folderId },
            data: { isDeleted: true },
            select: { id: true, isDeleted: true },
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

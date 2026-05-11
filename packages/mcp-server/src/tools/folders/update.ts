import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { fetchFolderDetail } from "./shared.js";

export interface FoldersUpdateDeps {
  env: EnvConfig;
}

export function registerFoldersUpdate(server: McpServer, deps: FoldersUpdateDeps): void {
  server.registerTool(
    "testplanit_folders_update",
    {
      description:
        "Update a folder (partial). Provide name to rename; provide parentId to reparent (use null to move to root). Returns the updated folder with breadcrumb + case count.",
      inputSchema: {
        folderId: z.number().int().positive(),
        name: z.string().min(1).max(255).optional(),
        parentId: z.number().int().positive().nullable().optional(),
      },
    },
    async (input) => {
      try {
        const data: Record<string, unknown> = {};
        if (input.name !== undefined) data["name"] = input.name;
        if (input.parentId !== undefined) {
          data["parent"] = input.parentId === null
            ? { disconnect: true }
            : { connect: { id: input.parentId } };
        }
        if (Object.keys(data).length > 0) {
          await zenstack(
            "repositoryFolders",
            "update",
            { where: { id: input.folderId }, data },
            deps.env,
          );
        }
        const detail = await fetchFolderDetail(input.folderId, deps.env);
        if (!detail) {
          return {
            isError: true as const,
            content: [{ type: "text" as const, text: `Folder ${input.folderId} not found.` }],
          };
        }
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

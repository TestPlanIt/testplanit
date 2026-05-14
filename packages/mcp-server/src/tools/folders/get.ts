import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { fetchFolderDetail } from "./shared.js";

export interface FoldersGetDeps {
  env: EnvConfig;
}

export function registerFoldersGet(server: McpServer, deps: FoldersGetDeps): void {
  server.registerTool(
    "testplanit_folders_get",
    {
      description:
        "Fetch a single folder by id with parent breadcrumb, children, cases summary (capped at 100; use testplanit_cases_list for full pagination), and total case count.",
      inputSchema: { folderId: z.number().int().positive() },
    },
    async (input) => {
      try {
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

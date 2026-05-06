import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack, resolveActiveRepository } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { fetchFolderDetail } from "./shared.js";

export interface FoldersCreateDeps {
  env: EnvConfig;
}

export function registerFoldersCreate(server: McpServer, deps: FoldersCreateDeps): void {
  server.registerTool(
    "testplanit_folders_create",
    {
      description:
        "Create a folder under a parent (omit parentId for root). Resolves the active repository automatically. Returns the created folder with breadcrumb + case count.",
      inputSchema: {
        projectId: z.number().int().positive(),
        name: z.string().min(1).max(255),
        parentId: z.number().int().positive().optional(),
      },
    },
    async (input) => {
      try {
        const repositoryId = await resolveActiveRepository(input.projectId, deps.env);
        const data: Record<string, unknown> = {
          name: input.name,
          project: { connect: { id: input.projectId } },
          repository: { connect: { id: repositoryId } },
        };
        if (input.parentId !== undefined) {
          data["parent"] = { connect: { id: input.parentId } };
        }
        const created = await zenstack<{ id: number }>(
          "repositoryFolders",
          "create",
          { data },
          deps.env,
        );
        const detail = await fetchFolderDetail(created.id, deps.env);
        const out = detail ?? { id: created.id };
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

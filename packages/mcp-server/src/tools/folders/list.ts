import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  RepositoryFoldersInclude,
} from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { mapFolderTreeNode } from "./shared.js";

export interface FoldersListDeps {
  env: EnvConfig;
}

const FOLDER_TREE_INCLUDE = {
  _count: { select: { cases: { where: { isDeleted: false } } } },
  children: {
    where: { isDeleted: false },
    include: {
      _count: { select: { cases: { where: { isDeleted: false } } } },
      children: { where: { isDeleted: false } },
    },
  },
} as const satisfies RepositoryFoldersInclude;

export function registerFoldersList(server: McpServer, deps: FoldersListDeps): void {
  server.registerTool(
    "testplanit_folders_list",
    {
      description:
        "List the folder tree for a project. Returns root folders with nested children and per-folder case counts (soft-deleted excluded). Two levels deep inline; deeper subtrees can be fetched via testplanit_folders_get.",
      inputSchema: { projectId: z.number().int().positive() },
    },
    async (input) => {
      try {
        const rows = await zenstack<unknown[]>(
          "repositoryFolders",
          "findMany",
          {
            where: { projectId: input.projectId, isDeleted: false, parentId: null },
            include: FOLDER_TREE_INCLUDE,
            orderBy: { order: "asc" },
          },
          deps.env,
        );
        const tree = (rows ?? []).map((r) => mapFolderTreeNode(r as never));
        const out = { tree };
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

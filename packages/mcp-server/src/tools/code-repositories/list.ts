import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ProjectCodeRepositoryConfigWhereInput,
} from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  PROJECT_REPO_CONFIG_INCLUDE,
  mapCodeRepoConfig,
  type RawCodeRepoConfigRow,
} from "./shared.js";

export interface CodeRepositoriesListDeps {
  env: EnvConfig;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export function registerCodeRepositoriesList(
  server: McpServer,
  deps: CodeRepositoriesListDeps,
): void {
  server.registerTool(
    "testplanit_code_repositories_list",
    {
      description:
        "List the code repositories bound to a project. Each row is one binding (ProjectCodeRepositoryConfig) and carries its `purpose`: QUICKSCRIPT bindings point at the repository that holds the project's automated tests (QuickScript generation and test-case links read it); IMPACT bindings point at the application code that impact analysis and Code Pins read. A project holds up to one binding per purpose and repository, so expect several rows; filter by `purpose` to pick one side. The repository is denormalized inline: id, name, provider, status, lastTestedAt, settings reduced to the provider's public keys (owner/repo, projectPath, workspace/repoSlug, organizationUrl/project/repositoryId, baseUrl), and a derived web url. Credentials are never returned.",
      inputSchema: {
        projectId: z.number().int().positive(),
        purpose: z.enum(["QUICKSCRIPT", "IMPACT"]).optional(),
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(MAX_LIMIT).optional(),
      },
    },
    async (input) => {
      try {
        const limit = input.limit ?? DEFAULT_LIMIT;
        const where: ProjectCodeRepositoryConfigWhereInput = {
          projectId: input.projectId,
          // CodeRepository carries `isDeleted`; the join table does not.
          repository: { isDeleted: false },
        };
        if (input.purpose !== undefined) where.purpose = input.purpose;
        const body: Record<string, unknown> = {
          where,
          include: PROJECT_REPO_CONFIG_INCLUDE,
          // Deterministic ordering — newest first; id breaks ties for rows
          // created in the same millisecond.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        };
        if (input.cursor !== undefined) {
          body.cursor = { id: input.cursor };
          body.skip = 1;
        }

        const rows =
          (await zenstack<RawCodeRepoConfigRow[]>(
            "projectCodeRepositoryConfig",
            "findMany",
            body,
            deps.env,
          )) ?? [];
        const hasNextPage = rows.length > limit;
        const trimmed = rows.slice(0, limit);
        const items = trimmed.map(mapCodeRepoConfig);
        const nextCursor =
          hasNextPage && items.length > 0
            ? (items[items.length - 1] as { id: number }).id
            : null;

        const result = { items, hasNextPage, nextCursor };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}

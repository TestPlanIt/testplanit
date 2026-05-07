import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Prisma } from "@prisma/client";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { mapCaseRow } from "./shared.js";

export interface CasesListDeps {
  env: EnvConfig;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const CASE_ROW_INCLUDE = {
  project: { select: { id: true, name: true } },
  folder: { select: { id: true, name: true, parentId: true } },
  state: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true, email: true } },
  tags: { select: { id: true, name: true } },
} as const satisfies Prisma.RepositoryCasesInclude;

export function registerCasesList(server: McpServer, deps: CasesListDeps): void {
  server.registerTool(
    "testplanit_cases_list",
    {
      description:
        "List test cases scoped to a project. Filters: folderId, tagIds, name (case-insensitive substring), stateId, customField (by display name). Cursor pagination via the `cursor` returned in `nextCursor`. (per D-05 / CASE-01)",
      inputSchema: {
        projectId: z.number().int().positive(),
        folderId: z.number().int().positive().optional(),
        tagIds: z.array(z.number().int().positive()).optional(),
        name: z.string().min(1).optional(),
        stateId: z.number().int().positive().optional(),
        // BL-02: only `name` is supported. Value-equality on the Json?
        // `caseFieldValues.value` column is unreliable across field types
        // (Dropdown stores option IDs, Multi-Select stores arrays, Text
        // stores strings). Silently swallowing an agent-supplied `value`
        // (the prior behavior) would let the agent act on incorrect data.
        // Dropping it from the schema makes the unsupported dimension
        // explicit; agents that need value filtering should call
        // testplanit_cases_get on candidate IDs and filter locally.
        customField: z
          .object({
            name: z.string().min(1),
          })
          .optional(),
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(MAX_LIMIT).optional(),
      },
    },
    async (input) => {
      try {
        const limit = input.limit ?? DEFAULT_LIMIT;
        const where: Record<string, unknown> = {
          projectId: input.projectId,
          isDeleted: false,
        };
        if (input.folderId !== undefined) where.folderId = input.folderId;
        if (input.tagIds && input.tagIds.length > 0) {
          where.tags = { some: { id: { in: input.tagIds } } };
        }
        if (input.name) {
          where.name = { contains: input.name, mode: "insensitive" };
        }
        if (input.stateId !== undefined) where.stateId = input.stateId;
        if (input.customField) {
          where.caseFieldValues = {
            some: { field: { displayName: input.customField.name } },
          };
        }

        const body: Record<string, unknown> = {
          where,
          include: CASE_ROW_INCLUDE,
          orderBy: { id: "asc" },
          take: limit + 1,
        };
        if (input.cursor !== undefined) {
          body.cursor = { id: input.cursor };
          body.skip = 1;
        }

        const rows = await zenstack<unknown[]>(
          "repositoryCases",
          "findMany",
          body,
          deps.env,
        );

        const hasNextPage = (rows ?? []).length > limit;
        const trimmed = (rows ?? []).slice(0, limit);
        const items = trimmed.map((r) => mapCaseRow(r as never));
        const nextCursor =
          hasNextPage && items.length > 0
            ? (items[items.length - 1] as { id: number }).id
            : null;

        const result = { items, hasNextPage, nextCursor };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}

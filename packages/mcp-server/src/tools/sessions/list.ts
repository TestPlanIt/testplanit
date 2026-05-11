import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  SESSION_ROW_INCLUDE,
  mapSessionRow,
  type RawSessionRow,
} from "./shared.js";

export interface SessionsListDeps {
  env: EnvConfig;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export function registerSessionsList(
  server: McpServer,
  deps: SessionsListDeps,
): void {
  server.registerTool(
    "testplanit_sessions_list",
    {
      description:
        "List sessions scoped to a project. Filters: stateId, isCompleted, createdById (user id, string), from/to (createdAt date range, ISO 8601). Cursor pagination ordered by createdAt DESC then id DESC (BL-04 deterministic). Each row carries denormalized state/createdBy/assignedTo/template/configuration/milestone/tags + mission and note extracted to plain text. (per SESS-01)",
      inputSchema: {
        projectId: z.number().int().positive(),
        stateId: z.number().int().positive().optional(),
        isCompleted: z.boolean().optional(),
        createdById: z.string().min(1).optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
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
        if (input.stateId !== undefined) where.stateId = input.stateId;
        if (input.isCompleted !== undefined)
          where.isCompleted = input.isCompleted;
        if (input.createdById) where.createdById = input.createdById;
        if (input.from || input.to) {
          where.createdAt = {
            ...(input.from ? { gte: new Date(input.from) } : {}),
            ...(input.to ? { lte: new Date(input.to) } : {}),
          };
        }

        const body: Record<string, unknown> = {
          where,
          include: SESSION_ROW_INCLUDE,
          // BL-04: deterministic page ordering. Newest session first; id breaks
          // ties for sessions created in the same millisecond.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        };
        if (input.cursor !== undefined) {
          body.cursor = { id: input.cursor };
          body.skip = 1;
        }

        const rows =
          (await zenstack<RawSessionRow[]>(
            "sessions",
            "findMany",
            body,
            deps.env,
          )) ?? [];
        const hasNextPage = rows.length > limit;
        const trimmed = rows.slice(0, limit);
        const items = trimmed.map(mapSessionRow);
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

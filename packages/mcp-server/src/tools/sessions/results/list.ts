import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Prisma } from "@prisma/client";
import * as z from "zod/v4";
import { zenstack } from "../../../api.js";
import type { EnvConfig } from "../../../env.js";
import { mapHttpErrorToToolResult } from "../../../errors.js";
import {
  SESSION_RESULT_LIST_INCLUDE,
  mapSessionResultRow,
  type RawSessionResultRow,
} from "../shared.js";

export interface SessionResultsListDeps {
  env: EnvConfig;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export function registerSessionResultsList(
  server: McpServer,
  deps: SessionResultsListDeps,
): void {
  server.registerTool(
    "testplanit_session_results_list",
    {
      description:
        "List session results with cursor pagination. Filters: sessionId, createdById (executor user id, string), statusId. NOTE: there is NO testCase filter — `SessionResults` has no `testCaseId` column (sessions are exploratory and not case-linked; R4 / Pitfall 4 / SESS-03 schema gap). Each row carries denormalized status / createdBy (the executor) / session summary, plus resultData extracted to plain text via ProseMirror. Ordered by createdAt DESC then id DESC (BL-04 deterministic). isDeleted:false defense-in-depth. (per SESS-03)",
      inputSchema: {
        sessionId: z.number().int().positive().optional(),
        createdById: z.string().min(1).optional(),
        statusId: z.number().int().positive().optional(),
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(MAX_LIMIT).optional(),
      },
    },
    async (input) => {
      try {
        const limit = input.limit ?? DEFAULT_LIMIT;

        // R4 / Pitfall 4 invariant: SessionResults has NO `testCaseId` column.
        // The annotation `Prisma.SessionResultsWhereInput` would TS2353 if any
        // `testCaseId` assignment were ever introduced. The input schema does
        // not declare `testCaseId` either; zod's raw-shape validator strips
        // unknown fields before this handler runs.
        const where: Prisma.SessionResultsWhereInput = { isDeleted: false };
        if (input.sessionId !== undefined) where.sessionId = input.sessionId;
        if (input.createdById) where.createdById = input.createdById;
        if (input.statusId !== undefined) where.statusId = input.statusId;

        const body: Record<string, unknown> = {
          where,
          include: SESSION_RESULT_LIST_INCLUDE,
          // BL-04: deterministic page ordering. Newest result first; id breaks
          // ties for results recorded in the same millisecond.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        };
        if (input.cursor !== undefined) {
          body.cursor = { id: input.cursor };
          body.skip = 1;
        }

        const rows =
          (await zenstack<RawSessionResultRow[]>(
            "sessionResults",
            "findMany",
            body,
            deps.env,
          )) ?? [];
        const hasNextPage = rows.length > limit;
        const trimmed = rows.slice(0, limit);
        const items = trimmed.map(mapSessionResultRow);
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

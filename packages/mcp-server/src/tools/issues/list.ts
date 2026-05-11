import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  ISSUE_ROW_INCLUDE,
  mapIssueRow,
  type RawIssueRow,
} from "./shared.js";

export interface IssuesListDeps {
  env: EnvConfig;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export function registerIssuesList(
  server: McpServer,
  deps: IssuesListDeps,
): void {
  server.registerTool(
    "testplanit_issues_list",
    {
      description:
        "List issues scoped to a project. Filters: externalSystem (IntegrationProvider enum), integrationId, status (TestPlanIt-side, exact match), externalStatus (externally-synced label, case-insensitive substring). Cursor pagination ordered by createdAt DESC then id DESC (deterministic). Each row carries linkedCaseCount via _count for the dominant fan-out signal. The assignee filter is intentionally omitted — Issue has no native assigneeId column; assignee data lives in Issue.data: Json (provider-shaped) and is not addressable here.",
      inputSchema: {
        projectId: z.number().int().positive(),
        externalSystem: z
          .enum(["JIRA", "GITHUB", "AZURE_DEVOPS", "SIMPLE_URL"])
          .optional(),
        integrationId: z.number().int().positive().optional(),
        status: z.string().min(1).optional(),
        externalStatus: z.string().min(1).optional(),
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
        if (input.externalSystem !== undefined) {
          where.integration = { provider: input.externalSystem };
        }
        if (input.integrationId !== undefined) {
          where.integrationId = input.integrationId;
        }
        if (input.status !== undefined) {
          where.status = input.status;
        }
        if (input.externalStatus !== undefined) {
          where.externalStatus = {
            contains: input.externalStatus,
            mode: "insensitive",
          };
        }
        const body: Record<string, unknown> = {
          where,
          include: ISSUE_ROW_INCLUDE,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        };
        if (input.cursor !== undefined) {
          body.cursor = { id: input.cursor };
          body.skip = 1;
        }
        const rows =
          (await zenstack<RawIssueRow[]>("issue", "findMany", body, deps.env)) ??
          [];
        const hasNextPage = rows.length > limit;
        const trimmed = rows.slice(0, limit);
        const items = trimmed.map(mapIssueRow);
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

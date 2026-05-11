import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  ISSUE_DETAIL_INCLUDE,
  ISSUE_LINKED_ARRAYS_INLINE_CAP,
  mapIssueDetail,
  type RawIssueDetail,
} from "./shared.js";

export interface IssuesGetDeps {
  env: EnvConfig;
}

export function registerIssuesGet(
  server: McpServer,
  deps: IssuesGetDeps,
): void {
  server.registerTool(
    "testplanit_issues_get",
    {
      description:
        "Fetch a single Issue by id with its full denormalized header (including ProseMirror note rendered to plain text, integration, createdBy) and three inlined linked arrays — linkedCases, linkedSessions, linkedTestRuns — each capped at 100. When an array is over-capacity the response carries truncated.<key>: true and the rest are reachable via testplanit_cases_list({ issueId }) or testplanit_issues_list_links with the appropriate target.",
      inputSchema: {
        id: z.number().int().positive(),
      },
    },
    async (input) => {
      try {
        const raw = await zenstack<RawIssueDetail | null>(
          "issue",
          "findUnique",
          {
            where: { id: input.id, isDeleted: false },
            include: ISSUE_DETAIL_INCLUDE,
          },
          deps.env,
        );
        if (!raw) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Issue ${input.id} not found.`,
              },
            ],
          };
        }
        // D8-06 / D7-12 widened: detect overflow per array via the take:101
        // cap on each sub-include. Trim each array to the inline cap (100)
        // BEFORE mapping so the surfaced arrays never exceed the documented
        // bound. Each array gets its own truncated.<key> flag.
        const linkedCasesRaw = raw.repositoryCases ?? [];
        const linkedSessionsRaw = raw.sessions ?? [];
        const linkedTestRunsRaw = raw.testRuns ?? [];
        const truncated: {
          linkedCases?: true;
          linkedSessions?: true;
          linkedTestRuns?: true;
        } = {};
        if (linkedCasesRaw.length > ISSUE_LINKED_ARRAYS_INLINE_CAP) {
          truncated.linkedCases = true;
        }
        if (linkedSessionsRaw.length > ISSUE_LINKED_ARRAYS_INLINE_CAP) {
          truncated.linkedSessions = true;
        }
        if (linkedTestRunsRaw.length > ISSUE_LINKED_ARRAYS_INLINE_CAP) {
          truncated.linkedTestRuns = true;
        }
        const trimmedRaw: RawIssueDetail = {
          ...raw,
          repositoryCases: linkedCasesRaw.slice(
            0,
            ISSUE_LINKED_ARRAYS_INLINE_CAP,
          ),
          sessions: linkedSessionsRaw.slice(
            0,
            ISSUE_LINKED_ARRAYS_INLINE_CAP,
          ),
          testRuns: linkedTestRunsRaw.slice(
            0,
            ISSUE_LINKED_ARRAYS_INLINE_CAP,
          ),
        };
        const detail = mapIssueDetail(trimmedRaw, { truncated });
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

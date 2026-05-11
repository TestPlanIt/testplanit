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

export interface IssuesFindByKeyDeps {
  env: EnvConfig;
}

// D8-04: hard cap on the multi-match probe. The schema constraint is only
// @@unique([externalId, integrationId]); externalKey is NOT globally unique.
// In practice 0–2 rows match a `(externalKey, externalSystem, projectId)`
// tuple. Cap at 5 so a corrupt or pathological dataset can't fan out an
// unbounded probe (T-08-DoS).
const MULTI_MATCH_TAKE = 5;

export function registerIssuesFindByKey(
  server: McpServer,
  deps: IssuesFindByKeyDeps,
): void {
  server.registerTool(
    "testplanit_issues_find_by_key",
    {
      description:
        "Resolve an Issue by (externalKey, externalSystem, projectId). Schema enforces @@unique([externalId, integrationId]) — externalKey is NOT globally unique, so when two integrations of the same provider share a key in the same project, the response shape is { issues: [...], multipleMatches: true, hint: 'Pass integrationId to disambiguate.' } instead of { issue, multipleMatches: false }. Pass optional integrationId to skip the multi-match path. Internal-only issues (where Issue.integrationId IS NULL) are NOT addressable by this tool — agents reach those via testplanit_issues_list.",
      inputSchema: {
        externalKey: z.string().min(1),
        externalSystem: z.enum([
          "JIRA",
          "GITHUB",
          "AZURE_DEVOPS",
          "SIMPLE_URL",
        ]),
        projectId: z.number().int().positive(),
        integrationId: z.number().int().positive().optional(),
      },
    },
    async (input) => {
      try {
        const where: Record<string, unknown> = {
          externalKey: input.externalKey,
          isDeleted: false,
          projectId: input.projectId,
          integration: { provider: input.externalSystem },
        };
        if (input.integrationId !== undefined) {
          where.integrationId = input.integrationId;
        }
        const rows =
          (await zenstack<RawIssueRow[]>(
            "issue",
            "findMany",
            {
              where,
              include: ISSUE_ROW_INCLUDE,
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: MULTI_MATCH_TAKE,
            },
            deps.env,
          )) ?? [];
        if (rows.length === 0) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Issue '${input.externalKey}' not found in project ${input.projectId}.`,
              },
            ],
          };
        }
        const result =
          rows.length === 1
            ? { issue: mapIssueRow(rows[0]), multipleMatches: false as const }
            : {
                issues: rows.map(mapIssueRow),
                multipleMatches: true as const,
                hint: "Pass integrationId to disambiguate.",
              };
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

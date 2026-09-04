import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { resolveIssueKeys, zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  ISSUE_ROW_INCLUDE,
  mapIssueRow,
  type RawIssueRow,
} from "./shared.js";

export interface IssuesResolveDeps {
  env: EnvConfig;
}

const MAX_KEYS = 50;

export function registerIssuesResolve(
  server: McpServer,
  deps: IssuesResolveDeps,
): void {
  server.registerTool(
    "testplanit_issues_resolve",
    {
      description:
        "Resolve tracker issue keys (e.g. 'PROJ-123') to TestPlanIt Issue rows, creating any row that does not exist here yet by reading the ticket through the project's own integration credentials. Use this instead of testplanit_issues_find_by_key when the key may never have been opened in the TestPlanIt web UI — find_by_key only searches rows that already exist and returns not-found otherwise. Resolution upserts on (externalId, integrationId), the same key the web UI writes, so a key resolved here and later linked in the UI is one row, never two. integrationId is optional when the project has exactly one active issue-tracker integration. Per-key failures are reported in `results` and never fail the whole call. GitHub issues need the compound 'owner/repo#N' form, not a bare number. Costs one tracker round trip per key not already present locally.",
      inputSchema: {
        projectId: z
          .number()
          .int()
          .positive()
          .describe("Project the resolved issues belong to."),
        keys: z
          .array(z.string().min(1).max(255))
          .min(1)
          .max(MAX_KEYS)
          .describe(
            "Tracker issue keys to resolve. Deduplicated server-side, so repeating a key across a batch costs one lookup.",
          ),
        integrationId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Integration to resolve against. Required only when the project has more than one active issue-tracker integration.",
          ),
      },
    },
    async (input) => {
      try {
        const resolution = await resolveIssueKeys(
          input.projectId,
          input.keys,
          deps.env,
          input.integrationId,
        );

        // Read the resolved rows back through the same include/mapper
        // testplanit_issues_find_by_key uses, so both tools hand the agent an
        // identically shaped issue and neither owns a private mapping.
        const issueIds = resolution.results
          .map((r) => r.issueId)
          .filter((id): id is number => id != null);
        const rows = issueIds.length
          ? ((await zenstack<RawIssueRow[]>(
              "issue",
              "findMany",
              {
                where: { id: { in: issueIds } },
                include: ISSUE_ROW_INCLUDE,
              },
              deps.env,
            )) ?? [])
          : [];
        const byId = new Map(rows.map((row) => [row.id, mapIssueRow(row)]));

        const result = {
          resolved: resolution.results
            .filter((r) => r.issueId != null)
            .map((r) => ({
              key: r.key,
              created: r.created === true,
              issue: byId.get(r.issueId as number) ?? null,
            })),
          failed: resolution.results
            .filter((r) => r.issueId == null)
            .map((r) => ({ key: r.key, error: r.error ?? "Not resolved." })),
          resolvedCount: resolution.resolvedCount,
          createdCount: resolution.createdCount,
          failedCount: resolution.failedCount,
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

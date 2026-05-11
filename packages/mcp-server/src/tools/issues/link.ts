import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";

export interface IssuesLinkDeps {
  env: EnvConfig;
}

const ENTITY_TYPES = [
  "testCase",
  "session",
  "testRun",
  "testRunResult",
  "testRunStepResult",
] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

const ENTITY_RELATION: Record<EntityType, string> = {
  testCase: "repositoryCases",
  session: "sessions",
  testRun: "testRuns",
  testRunResult: "testRunResults",
  testRunStepResult: "testRunStepResults",
};

const LINK_INPUT_SCHEMA = {
  issueId: z
    .number()
    .int()
    .positive()
    .describe("ID of the issue to link entities to."),
  entityType: z
    .enum(ENTITY_TYPES)
    .describe(
      "Type of entity to link: testCase | session | testRun | testRunResult | testRunStepResult.",
    ),
  entityIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(100)
    .describe("One or more entity IDs to link to the issue."),
};

const UNLINK_INPUT_SCHEMA = {
  issueId: z
    .number()
    .int()
    .positive()
    .describe("ID of the issue to unlink entities from."),
  entityType: z
    .enum(ENTITY_TYPES)
    .describe(
      "Type of entity to unlink: testCase | session | testRun | testRunResult | testRunStepResult.",
    ),
  entityIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(100)
    .describe("One or more entity IDs to unlink from the issue."),
};

export function registerIssuesLink(
  server: McpServer,
  deps: IssuesLinkDeps,
): void {
  server.registerTool(
    "testplanit_issues_link",
    {
      description:
        "Link one or more entities (test cases, sessions, test runs, etc.) to an issue. Supports batch linking: pass up to 100 entity IDs in a single call. Use entityType='testCase' to link test cases created with testplanit_cases_create. Returns a count of linked entities.",
      inputSchema: LINK_INPUT_SCHEMA,
    },
    async (input) => {
      try {
        const relation = ENTITY_RELATION[input.entityType];
        await zenstack(
          "issue",
          "update",
          {
            where: { id: input.issueId },
            data: {
              [relation]: {
                connect: input.entityIds.map((id) => ({ id })),
              },
            },
            select: { id: true },
          },
          deps.env,
        );
        const result = {
          linked: input.entityIds.length,
          issueId: input.issueId,
          entityType: input.entityType,
          entityIds: input.entityIds,
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

export function registerIssuesUnlink(
  server: McpServer,
  deps: IssuesLinkDeps,
): void {
  server.registerTool(
    "testplanit_issues_unlink",
    {
      description:
        "Remove links between one or more entities and an issue. Supports batch: pass up to 100 entity IDs in a single call. Returns a count of unlinked entities.",
      inputSchema: UNLINK_INPUT_SCHEMA,
    },
    async (input) => {
      try {
        const relation = ENTITY_RELATION[input.entityType];
        await zenstack(
          "issue",
          "update",
          {
            where: { id: input.issueId },
            data: {
              [relation]: {
                disconnect: input.entityIds.map((id) => ({ id })),
              },
            },
            select: { id: true },
          },
          deps.env,
        );
        const result = {
          unlinked: input.entityIds.length,
          issueId: input.issueId,
          entityType: input.entityType,
          entityIds: input.entityIds,
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

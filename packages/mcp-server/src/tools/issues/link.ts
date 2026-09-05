import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { resolveIssueKeys, zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { TestPlanItHttpError } from "../../http.js";

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
    .optional()
    .describe(
      "ID of the issue to link entities to. Omit it and pass externalKey + projectId to link a tracker ticket by key instead.",
    ),
  externalKey: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe(
      "Tracker issue key (e.g. 'PROJ-123') to link, as an alternative to issueId. Requires projectId. The Issue row is created from the tracker when TestPlanIt has never seen the key.",
    ),
  projectId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Project the externalKey belongs to. Required with externalKey."),
  integrationId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Integration to resolve externalKey against. Required only when the project has more than one active issue-tracker integration.",
    ),
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

interface IssueTargetInput {
  issueId?: number;
  externalKey?: string;
  projectId?: number;
  integrationId?: number;
}

/**
 * Settle which Issue the call means: the id it was handed, or the row behind a
 * tracker key — resolving that key upstream when TestPlanIt has never seen it.
 *
 * The two forms are exclusive on purpose. Accepting both and silently
 * preferring one would let an agent link a different issue than the key it
 * named, which is precisely the kind of quiet mismatch this tool must not
 * produce. A key that resolves to nothing raises rather than linking, because
 * there is no partial success to report for a single-issue call.
 */
async function resolveTargetIssueId(
  input: IssueTargetInput,
  env: EnvConfig,
): Promise<number> {
  if (input.issueId != null && input.externalKey != null) {
    throw new TestPlanItHttpError(
      "Pass either issueId or externalKey, not both.",
      { statusCode: 400 },
    );
  }
  if (input.issueId != null) return input.issueId;
  if (input.externalKey == null) {
    throw new TestPlanItHttpError(
      "Provide issueId, or externalKey together with projectId.",
      { statusCode: 400 },
    );
  }
  if (input.projectId == null) {
    throw new TestPlanItHttpError(
      "externalKey requires projectId — an issue key is only unique within a project's integration.",
      { statusCode: 400 },
    );
  }

  const resolution = await resolveIssueKeys(
    input.projectId,
    [input.externalKey],
    env,
    input.integrationId,
  );
  const resolved = resolution.results[0];
  if (resolved?.issueId == null) {
    throw new TestPlanItHttpError(
      `Could not resolve issue '${input.externalKey}': ${resolved?.error ?? "not found."}`,
      { statusCode: 404 },
    );
  }
  return resolved.issueId;
}

export function registerIssuesLink(
  server: McpServer,
  deps: IssuesLinkDeps,
): void {
  server.registerTool(
    "testplanit_issues_link",
    {
      description:
        "Link one or more entities (test cases, sessions, test runs, etc.) to an issue. Supports batch linking: pass up to 100 entity IDs in a single call. Use entityType='testCase' to link test cases created with testplanit_cases_create. Identify the issue EITHER by issueId, OR by externalKey + projectId — the key form resolves the ticket through the project's integration and creates the Issue row when TestPlanIt has never seen it, so no one has to open the ticket in the web UI first. Resolution shares the row the web UI would write, so a key linked here is never a duplicate. Returns a count of linked entities.",
      inputSchema: LINK_INPUT_SCHEMA,
    },
    async (input) => {
      try {
        const issueId = await resolveTargetIssueId(input, deps.env);
        const relation = ENTITY_RELATION[input.entityType];
        await zenstack(
          "issue",
          "update",
          {
            where: { id: issueId },
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
          issueId,
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

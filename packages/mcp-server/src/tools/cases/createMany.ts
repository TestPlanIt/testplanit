import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { postHostJson } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";

export interface CasesCreateManyDeps {
  env: EnvConfig;
}

const FETCH_TIMEOUT_MS = 30000;

/** Per-case outcome echoed back from the bulk-create route. */
interface BulkCaseResult {
  id: string;
  name: string;
  status: "success" | "error";
  caseId?: number;
  error?: string;
}

interface BulkCreateResponse {
  success: boolean;
  importedCount: number;
  failedCount: number;
  results: BulkCaseResult[];
}

/**
 * POST the batch to the dedicated bulk-create route, which resolves shared
 * context once and hands each (folder, state) group to the transactional
 * importer. `postHostJson` carries the same error parsing as api.ts/zenstack,
 * so a host-side READ_ONLY_TOKEN (403) or validation message reaches the agent
 * with its `code` intact for the friendly mode:read mapping in errors.ts.
 */
async function postBulkCreate(
  projectId: number,
  body: unknown,
  env: EnvConfig,
): Promise<BulkCreateResponse> {
  return postHostJson<BulkCreateResponse>(
    `/api/projects/${projectId}/cases/bulk-create`,
    body,
    env,
    FETCH_TIMEOUT_MS,
  );
}

export function registerCasesCreateMany(
  server: McpServer,
  deps: CasesCreateManyDeps,
): void {
  server.registerTool(
    "testplanit_cases_create_many",
    {
      description:
        "Create many test cases in one operation, far faster than calling testplanit_cases_create per case. Each case supports the same fields as a single create (name, steps, tags, customFields) plus optional per-case folderId / stateName overriding the batch defaults. Cases are grouped by their effective (folder, state) and each group is persisted in one transaction. Returns a per-case results array so partial failures are visible (each entry has status 'success' with caseId, or 'error' with a message). customFields must belong to the chosen template — out-of-template fields are reported as a per-case error, not silently dropped. Each case may also carry `issues`: tracker issue keys resolved server-side and created when TestPlanIt has never seen them, so attaching a ticket needs no UI pre-step.",
      inputSchema: {
        projectId: z
          .number()
          .int()
          .positive()
          .describe("Project to create the cases in."),
        folderId: z
          .number()
          .int()
          .positive()
          .describe("Default folder for the batch. Each case may override it."),
        templateId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Template for the whole batch. Defaults to the project's first enabled template.",
          ),
        stateName: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Default CASES workflow state name for the batch. Defaults to the first state by order. Each case may override it.",
          ),
        integrationId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Integration to resolve per-case `issues` keys against. Required only when the project has more than one active issue-tracker integration.",
          ),
        cases: z
          .array(
            z.object({
              name: z.string().min(1).max(2000).describe("Test case name."),
              folderId: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Override the batch folder for this case."),
              stateName: z
                .string()
                .min(1)
                .optional()
                .describe("Override the batch workflow state for this case."),
              steps: z
                .array(
                  z.object({
                    text: z.string().optional().describe("Step description."),
                    expectedResult: z
                      .string()
                      .optional()
                      .describe("Expected result."),
                    order: z
                      .number()
                      .int()
                      .nonnegative()
                      .optional()
                      .describe("Step order (0-based). Inferred if omitted."),
                  }),
                )
                .optional()
                .describe("Ordered test steps."),
              tags: z
                .array(z.union([z.number().int().positive(), z.string().min(1)]))
                .optional()
                .describe(
                  "Tag IDs (numbers) or tag names (strings, created if missing).",
                ),
              customFields: z
                .record(z.string(), z.unknown())
                .optional()
                .describe(
                  "Custom field values keyed by display name, e.g. { 'Priority': 'High' }. Must be fields on the chosen template.",
                ),
              issues: z
                .array(z.string().min(1).max(255))
                .max(50)
                .optional()
                .describe(
                  "Tracker issue keys (e.g. 'PROJ-123') to link to this case. Resolved server-side through the project's integration and created when TestPlanIt has never seen the key, so no one has to open the ticket in the web UI first. Keys are deduplicated across the batch. A key that cannot be resolved fails only the cases citing it, reported as a per-case error.",
                ),
            }),
          )
          .min(1)
          .max(200)
          .describe("The cases to create (1–200)."),
      },
    },
    async (input) => {
      try {
        const out = await postBulkCreate(
          input.projectId,
          {
            ...(input.templateId != null ? { templateId: input.templateId } : {}),
            folderId: input.folderId,
            ...(input.stateName != null ? { stateName: input.stateName } : {}),
            ...(input.integrationId != null
              ? { integrationId: input.integrationId }
              : {}),
            cases: input.cases,
          },
          deps.env,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          structuredContent: out as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}

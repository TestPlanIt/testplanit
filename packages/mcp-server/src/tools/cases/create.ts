import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { postHostJson } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { TestPlanItHttpError } from "../../http.js";
import type { BulkCreateResponse } from "./createMany.js";
import { fetchCaseDetail } from "./fetchDetail.js";

export interface CasesCreateDeps {
  env: EnvConfig;
}

const FETCH_TIMEOUT_MS = 30000;

export function registerCasesCreate(
  server: McpServer,
  deps: CasesCreateDeps,
): void {
  server.registerTool(
    "testplanit_cases_create",
    {
      description:
        "Create a new test case in a project + folder, stored exactly as the web UI stores it: Markdown in steps and Text Long fields is formatted, custom field values are checked against the template (options by name or id, numbers, dates, true/false), the template's default values fill fields you leave out, and required fields must end up with a value. Resolves the active repository, template and CASES workflow state automatically. Returns the full case detail.",
      inputSchema: {
        projectId: z.number().int().positive().describe("Project to create the case in."),
        folderId: z.number().int().positive().describe("Folder to place the case in."),
        name: z.string().min(1).max(255).describe("Test case name (up to 255 characters)."),
        templateId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Template to use. Defaults to the template marked Default when it is assigned to the project, otherwise the project's first enabled template. Use testplanit_templates_list to see available templates and their fields.",
          ),
        stateName: z
          .string()
          .min(1)
          .optional()
          .describe("CASES workflow state name. Defaults to the state marked Default, else the first by order."),
        steps: z
          .array(
            z.object({
              text: z.string().optional().describe("Step description. Markdown is formatted."),
              expectedResult: z
                .string()
                .optional()
                .describe("Expected result. Markdown is formatted."),
              order: z.number().int().nonnegative().optional().describe("Step order (0-based). Inferred if omitted."),
            }),
          )
          .optional()
          .describe("Ordered test steps."),
        tags: z
          .array(z.union([z.number().int().positive(), z.string().min(1)]))
          .optional()
          .describe("Tag IDs (numbers) or tag names (strings, created if missing)."),
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
            "Tracker issue keys (e.g. 'PROJ-123') to link to the case, resolved through the project's integration and created when TestPlanIt has never seen them.",
          ),
        integrationId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Integration to resolve `issues` against. Required only when the project has more than one active issue-tracker integration.",
          ),
      },
    },
    async (input) => {
      try {
        // One writer for every API-created case: the host's bulk-create route,
        // which creates the case, its steps, tags, issues, field values and
        // version 1 in one transaction, the same way the web UI does.
        const out = await postHostJson<BulkCreateResponse>(
          `/api/projects/${input.projectId}/cases/bulk-create`,
          {
            ...(input.templateId != null ? { templateId: input.templateId } : {}),
            folderId: input.folderId,
            ...(input.stateName != null ? { stateName: input.stateName } : {}),
            ...(input.integrationId != null
              ? { integrationId: input.integrationId }
              : {}),
            cases: [
              {
                name: input.name,
                ...(input.steps ? { steps: input.steps } : {}),
                ...(input.tags ? { tags: input.tags } : {}),
                ...(input.customFields ? { customFields: input.customFields } : {}),
                ...(input.issues ? { issues: input.issues } : {}),
              },
            ],
          },
          deps.env,
          FETCH_TIMEOUT_MS,
        );

        const result = out.results[0];
        if (result?.status !== "success" || result.caseId == null) {
          throw new TestPlanItHttpError(
            result?.error ?? "The test case was not created.",
            { statusCode: 422 },
          );
        }

        const detail = await fetchCaseDetail(result.caseId, deps.env);
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

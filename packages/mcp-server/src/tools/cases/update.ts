import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  RepositoryCasesSelect,
} from "@db/input";
import * as z from "zod/v4";
import { zenstack, resolveCaseWorkflowState } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { resolveCustomFields, writeCustomFieldValues } from "./customFields.js";
import { resolveTagIds } from "./shared.js";
import { replaceStepsForCase, type StepInput } from "./steps.js";
import { fetchCaseDetail } from "./fetchDetail.js";

export interface CasesUpdateDeps {
  env: EnvConfig;
}

export function registerCasesUpdate(
  server: McpServer,
  deps: CasesUpdateDeps,
): void {
  server.registerTool(
    "testplanit_cases_update",
    {
      description:
        "Update a test case (partial). Provide only the fields to change: name, automated, steps (replaces all current steps), tags (replaces the tag set), customFields (upserts each), stateName, folderId. Returns the full denormalized case detail (CASE-02 shape). (per D-05 / CASE-04)",
      inputSchema: {
        caseId: z.number().int().positive().describe("ID of the test case to update."),
        name: z.string().min(1).max(2000).optional().describe("New test case name."),
        automated: z
          .boolean()
          .optional()
          .describe(
            "Whether the case is driven by automation. Set true to flip a manually-authored case that now receives automated results.",
          ),
        stateName: z
          .string()
          .min(1)
          .optional()
          .describe("CASES workflow state name to set."),
        folderId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Move case to this folder ID."),
        steps: z
          .array(
            z.object({
              text: z.string().optional().describe("Step description."),
              expectedResult: z.string().optional().describe("Expected result."),
              order: z.number().int().nonnegative().optional().describe("Step order."),
            }),
          )
          .optional()
          .describe("New step set. Replaces ALL existing steps (soft-deletes them first)."),
        tags: z
          .array(z.union([z.number().int().positive(), z.string().min(1)]))
          .optional()
          .describe("New tag set (replaces all tags). Mix of IDs and names."),
        customFields: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Custom field values to upsert, keyed by display name."),
      },
    },
    async (input) => {
      try {
        // Fetch the case head first — needed to get projectId for state
        // resolution and templateId for template-scoped custom-field
        // resolution, and to validate the case exists before any writes.
        const head = await zenstack<{
          id: number;
          projectId: number;
          templateId: number;
        } | null>(
          "repositoryCases",
          "findUnique",
          {
            where: { id: input.caseId },
            select: {
              id: true,
              projectId: true,
              templateId: true,
            } satisfies RepositoryCasesSelect,
          },
          deps.env,
        );
        if (!head) {
          return {
            isError: true as const,
            content: [
              { type: "text" as const, text: `Test case ${input.caseId} not found.` },
            ],
          };
        }

        // Build the partial update data object — only include provided fields.
        const data: Record<string, unknown> = {};

        if (input.name !== undefined) {
          data.name = input.name;
        }
        if (input.automated !== undefined) {
          data.automated = input.automated;
        }
        if (input.folderId !== undefined) {
          data.folder = { connect: { id: input.folderId } };
        }
        if (input.stateName !== undefined) {
          const state = await resolveCaseWorkflowState(
            head.projectId,
            deps.env,
            input.stateName,
          );
          data.state = { connect: { id: state.id } };
        }
        if (input.tags !== undefined) {
          const tagIds = await resolveTagIds(input.tags, deps.env);
          // Tags live on the explicit RepositoryCaseTag join model. "set"
          // (replace-all) semantics map to: clear the existing join rows,
          // then create one per requested tag (nested caseTags.tag.connect).
          // The implicit `tags` relation no longer exists and would 422.
          data.caseTags = {
            deleteMany: {},
            create: tagIds.map((id) => ({ tag: { connect: { id } } })),
          };
        }

        // Only write if there are scalar/relation fields to update.
        if (Object.keys(data).length > 0) {
          await zenstack(
            "repositoryCases",
            "update",
            { where: { id: input.caseId }, data },
            deps.env,
          );
        }

        // Steps replacement: soft-delete existing + create new (T-06-06).
        if (input.steps !== undefined) {
          await replaceStepsForCase(
            input.caseId,
            input.steps as StepInput[],
            deps.env,
          );
        }

        // Custom field upserts — resolved against the case's own template so an
        // out-of-template field is rejected and global name ambiguity is moot.
        if (input.customFields !== undefined) {
          const resolved = await resolveCustomFields(
            input.customFields,
            head.templateId,
            deps.env,
          );
          await writeCustomFieldValues(input.caseId, resolved, deps.env);
        }

        // Re-fetch with full D-10 denormalized shape.
        const detail = await fetchCaseDetail(input.caseId, deps.env);
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

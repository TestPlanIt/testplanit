import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Prisma } from "@prisma/client";
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
        "Update a test case (partial). Provide only the fields to change: name, steps (replaces all current steps), tags (replaces the tag set), customFields (upserts each), stateName, folderId. Returns the full denormalized case detail (CASE-02 shape). (per D-05 / CASE-04)",
      inputSchema: {
        caseId: z.number().int().positive().describe("ID of the test case to update."),
        name: z.string().min(1).max(2000).optional().describe("New test case name."),
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
        // Fetch the case head first — needed to get projectId for state resolution
        // and to validate the case exists before any writes.
        const head = await zenstack<{ id: number; projectId: number } | null>(
          "repositoryCases",
          "findUnique",
          {
            where: { id: input.caseId },
            select: { id: true, projectId: true } satisfies Prisma.RepositoryCasesSelect,
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
          data.tags = { set: tagIds.map((id) => ({ id })) };
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

        // Custom field upserts.
        if (input.customFields !== undefined) {
          const resolved = await resolveCustomFields(input.customFields, deps.env);
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

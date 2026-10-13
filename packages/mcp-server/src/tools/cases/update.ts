import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  RepositoryCasesSelect,
} from "@db/input";
import * as z from "zod/v4";
import {
  zenstack,
  createCaseVersion,
  resolveCaseWorkflowState,
} from "../../api.js";
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
        "Update a test case (partial). Provide only the fields to change: name, automated, steps (replaces all current steps), tags (replaces the tag set), customFields (upserts each), stateName, folderId. Returns the full denormalized case detail (same shape as testplanit_cases_get).",
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
          .describe(
            "New step set. Replaces ALL existing steps (soft-deletes them first). Shared steps aren't supported: these are plain steps, and replacing the steps removes any shared step groups from the case (a shared step group reads back from testplanit_cases_get as an empty step).",
          ),
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
          caseTags: { tagId: number }[];
        } | null>(
          "repositoryCases",
          "findUnique",
          {
            where: { id: input.caseId },
            select: {
              id: true,
              projectId: true,
              templateId: true,
              caseTags: { select: { tagId: true } },
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
        let changed = false;

        if (input.tags !== undefined) {
          const tagIds = await resolveTagIds(input.tags, deps.env);
          // Tags live on the explicit RepositoryCaseTag join model, so
          // "replace the set" is a nested deleteMany + create on caseTags.
          // The host runs nested relation operations in its own fixed
          // order, create before deleteMany, so `deleteMany: {}` paired
          // with the new links wiped the links it had just created (#668).
          // Diffing against the current links keeps the two operations on
          // disjoint rows, so their order no longer matters.
          const current = new Set(head.caseTags.map((ct) => ct.tagId));
          const wanted = new Set(tagIds);
          const toCreate = tagIds.filter((id) => !current.has(id));
          const toDelete = [...current].filter((id) => !wanted.has(id));
          const caseTags: Record<string, unknown> = {};
          if (toDelete.length > 0) {
            caseTags.deleteMany = { tagId: { in: toDelete } };
          }
          if (toCreate.length > 0) {
            caseTags.create = toCreate.map((id) => ({ tag: { connect: { id } } }));
          }
          if (Object.keys(caseTags).length > 0) {
            data.caseTags = caseTags;
          }
          // A tag set that already matches still counts as an edit, as a
          // web UI save does, so the version bump below is not skipped.
          changed = true;
        }

        // Steps and field values first: they don't touch the case row, so
        // the one case write below can carry the version bump with every
        // other change, as a web UI save does.

        // Steps replacement: soft-delete existing + create new (T-06-06).
        if (input.steps !== undefined) {
          await replaceStepsForCase(
            input.caseId,
            input.steps as StepInput[],
            deps.env,
          );
          changed = true;
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
          changed = true;
        }

        // An edit through this tool leaves the same history a UI save does
        // (#598): one version bump, in the same write as the case's own
        // changes, then a snapshot of the case as it now stands. Bumping in a
        // separate call let the automated-flag hook snapshot the half-written
        // case first, so flipping `automated` recorded two versions. Skipped
        // when the call carried no writable field, so a read-shaped update
        // doesn't invent a version.
        if (changed || Object.keys(data).length > 0) {
          await zenstack(
            "repositoryCases",
            "update",
            {
              where: { id: input.caseId },
              data: { ...data, currentVersion: { increment: 1 } },
            },
            deps.env,
          );
          await createCaseVersion(input.caseId, {}, deps.env);
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

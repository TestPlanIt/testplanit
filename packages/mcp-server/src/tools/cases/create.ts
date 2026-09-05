import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import {
  zenstack,
  createCaseVersion,
  resolveActiveRepository,
  resolveTemplateForProject,
  resolveCaseWorkflowState,
} from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { TestPlanItHttpError } from "../../http.js";
import { resolveCustomFields, writeCustomFieldValues } from "./customFields.js";
import { resolveTagIds } from "./shared.js";
import { createStepsForCase, type StepInput } from "./steps.js";
import { fetchCaseDetail } from "./fetchDetail.js";

export interface CasesCreateDeps {
  env: EnvConfig;
}

export function registerCasesCreate(
  server: McpServer,
  deps: CasesCreateDeps,
): void {
  server.registerTool(
    "testplanit_cases_create",
    {
      description:
        "Create a new test case in a project + folder. Resolves the active repository, default template, and CASES workflow state automatically. Returns the full denormalized case detail (CASE-02 shape). (per D-05 / CASE-03)",
      inputSchema: {
        projectId: z.number().int().positive().describe("Project to create the case in."),
        folderId: z.number().int().positive().describe("Folder to place the case in."),
        name: z.string().min(1).max(2000).describe("Test case name."),
        templateId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Template to use. Defaults to the project's first enabled template. Use testplanit_templates_list to see available templates and their fields.",
          ),
        stateName: z
          .string()
          .min(1)
          .optional()
          .describe("CASES workflow state name. Defaults to the first state by order."),
        steps: z
          .array(
            z.object({
              text: z.string().optional().describe("Step description."),
              expectedResult: z.string().optional().describe("Expected result."),
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
          .describe("Custom field values keyed by display name, e.g. { 'Priority': 'High' }."),
      },
    },
    async (input) => {
      try {
        // Pre-resolution: fail fast if project is misconfigured.
        const repositoryId = await resolveActiveRepository(input.projectId, deps.env);
        // Honor an explicit templateId (validated against the project) or fall
        // back to the project's default template when omitted.
        const templateId = await resolveTemplateForProject(
          input.projectId,
          deps.env,
          input.templateId,
        );
        const state = await resolveCaseWorkflowState(
          input.projectId,
          deps.env,
          input.stateName,
        );

        // Resolve custom fields against the chosen template — a field that
        // isn't on the template is rejected (not silently dropped), and the
        // template scope removes any global display-name ambiguity.
        const resolvedCustomFields = await resolveCustomFields(
          input.customFields,
          templateId,
          deps.env,
        );
        const tagIds = await resolveTagIds(input.tags, deps.env);

        // Case create body — relation-connect syntax throughout (D-02 anti-pattern check).
        // creatorId is NOT passed — auto-injected by /api/model/[...path]/route.ts.
        const data: Record<string, unknown> = {
          name: input.name,
          source: "MANUAL",
          automated: false,
          project: { connect: { id: input.projectId } },
          repository: { connect: { id: repositoryId } },
          folder: { connect: { id: input.folderId } },
          template: { connect: { id: templateId } },
          state: { connect: { id: state.id } },
        };

        const created = await zenstack<{ id: number }>(
          "repositoryCases",
          "create",
          { data },
          deps.env,
        );

        // BL-03: post-create wiring (steps / tags / custom fields /
        // re-fetch) runs in a try/catch so a mid-flight failure does
        // not leave a half-built case in the database. On any failure
        // we issue a best-effort soft-delete (T-06-06: NEVER `delete`)
        // and re-throw an error that names the orphan caseId so the
        // agent can recover deterministically.
        try {
          if (input.steps && input.steps.length > 0) {
            await createStepsForCase(
              created.id,
              input.steps as StepInput[],
              deps.env,
            );
          }
          if (tagIds.length > 0) {
            // Tags live on the explicit RepositoryCaseTag join model. The
            // case was just created with no tags, so create the join rows
            // directly (nested through caseTags.tag.connect). The implicit
            // `tags` relation no longer exists and would 422.
            await zenstack(
              "repositoryCases",
              "update",
              {
                where: { id: created.id },
                data: {
                  caseTags: {
                    create: tagIds.map((id) => ({ tag: { connect: { id } } })),
                  },
                },
              },
              deps.env,
            );
          }
          if (resolvedCustomFields.length > 0) {
            await writeCustomFieldValues(created.id, resolvedCustomFields, deps.env);
          }

          // Version 1 snapshot, written LAST so it captures the steps, tags
          // and custom fields wired above. A case with `currentVersion: 1`
          // and no version row can't be read back as it was executed, so a
          // failure here is a failure of the whole create and rolls the case
          // back through the compensating soft-delete below.
          await createCaseVersion(created.id, {}, deps.env);

          // Re-fetch with full D-10 denormalized shape.
          const detail = await fetchCaseDetail(created.id, deps.env);
          return {
            content: [{ type: "text", text: JSON.stringify(detail) }],
            structuredContent: detail as unknown as Record<string, unknown>,
          };
        } catch (postCreateErr) {
          // Best-effort compensating soft-delete. Swallow cleanup failures
          // (the agent already has the orphan caseId in the surfaced
          // error and can call testplanit_cases_delete to clean up).
          await zenstack(
            "repositoryCases",
            "update",
            {
              where: { id: created.id },
              data: { isDeleted: true },
            },
            deps.env,
          ).catch(() => {
            /* swallow — we surface the orphan id below */
          });
          const inner =
            postCreateErr instanceof Error
              ? postCreateErr.message
              : String(postCreateErr);
          const status =
            postCreateErr instanceof TestPlanItHttpError
              ? postCreateErr.statusCode
              : undefined;
          throw new TestPlanItHttpError(
            `Test case ${created.id} was created but post-create wiring failed (steps / tags / custom fields / version snapshot / re-fetch); the case was soft-deleted as a best-effort cleanup. Underlying error: ${inner}`,
            status !== undefined ? { statusCode: status } : {},
          );
        }
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}

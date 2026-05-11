import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Prisma } from "@prisma/client";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { TestPlanItHttpError } from "../../http.js";
import { resolveTagIds } from "../cases/shared.js";
import { RUN_DETAIL_INCLUDE } from "./get.js";
import {
  computeStatusRollup,
  extractStatusNames,
  mapRunRow,
  mapRunDetailTestCase,
  type RawRunRow,
  type RawRunDetailTestCase,
} from "./shared.js";

export interface RunsCreateDeps {
  env: EnvConfig;
}

const TESTCASES_INLINE_LIMIT = 50;
const MAX_CASE_IDS = 250;

export async function resolveRunState(
  projectId: number,
  env: EnvConfig,
  name?: string,
): Promise<{ id: number; name: string }> {
  const workflows = await zenstack<{ id: number; name: string }[]>(
    "workflows",
    "findMany",
    {
      where: {
        isEnabled: true,
        isDeleted: false,
        scope: "RUNS",
        projects: { some: { projectId } },
        ...(name ? { name } : {}),
      } satisfies Prisma.WorkflowsWhereInput,
      orderBy: { order: "asc" } satisfies Prisma.WorkflowsOrderByWithRelationInput,
      take: 1,
    },
    env,
  );
  if (!workflows || workflows.length === 0) {
    const suffix = name ? ` named "${name}"` : "";
    throw new TestPlanItHttpError(
      `No RUNS-scope workflow state found for project ${projectId}${suffix}.`,
      { statusCode: 422 },
    );
  }
  return workflows[0];
}

export function registerRunsCreate(
  server: McpServer,
  deps: RunsCreateDeps,
): void {
  server.registerTool(
    "testplanit_runs_create",
    {
      description:
        "Create a new test run in a project. Optionally add test cases, link to a milestone or configuration, set tags, and pick a workflow state by name. Returns the full denormalized run detail (same shape as testplanit_test_runs_get). State defaults to the first RUNS-scope state by order when omitted. testRunType is always REGULAR.",
      inputSchema: {
        projectId: z
          .number()
          .int()
          .positive()
          .describe("Project to create the run in."),
        name: z.string().min(1).max(500).describe("Test run name."),
        caseIds: z
          .array(z.number().int().positive())
          .max(MAX_CASE_IDS)
          .optional()
          .describe(
            `Repository case IDs to add to the run (max ${MAX_CASE_IDS}). Order is preserved.`,
          ),
        milestoneId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Milestone to link the run to."),
        configId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Configuration ID to associate with the run."),
        stateName: z
          .string()
          .min(1)
          .optional()
          .describe(
            "RUNS workflow state name. Defaults to the first state by order.",
          ),
        tags: z
          .array(z.union([z.number().int().positive(), z.string().min(1)]))
          .optional()
          .describe(
            "Tag IDs (numbers) or tag names (strings, created if missing).",
          ),
      },
    },
    async (input) => {
      try {
        const state = await resolveRunState(
          input.projectId,
          deps.env,
          input.stateName,
        );
        const tagIds = await resolveTagIds(input.tags, deps.env);

        const created = await zenstack<{ id: number }>(
          "testRuns",
          "create",
          {
            data: {
              name: input.name,
              testRunType: "REGULAR",
              project: { connect: { id: input.projectId } },
              state: { connect: { id: state.id } },
              ...(input.milestoneId
                ? { milestone: { connect: { id: input.milestoneId } } }
                : {}),
              ...(input.configId
                ? { configuration: { connect: { id: input.configId } } }
                : {}),
              ...(tagIds.length > 0
                ? { tags: { connect: tagIds.map((id) => ({ id })) } }
                : {}),
            },
            select: { id: true },
          },
          deps.env,
        );

        if (input.caseIds && input.caseIds.length > 0) {
          await zenstack(
            "testRunCases",
            "createMany",
            {
              data: input.caseIds.map((caseId, i) => ({
                testRunId: created.id,
                repositoryCaseId: caseId,
                order: i + 1,
              })),
            },
            deps.env,
          );
        }

        const raw = await zenstack<
          (RawRunRow & { testCases: RawRunDetailTestCase[] }) | null
        >(
          "testRuns",
          "findUnique",
          {
            where: { id: created.id },
            include: RUN_DETAIL_INCLUDE,
          },
          deps.env,
        );

        if (!raw) {
          throw new TestPlanItHttpError(
            `Test run ${created.id} was created but could not be re-fetched.`,
            { statusCode: 422 },
          );
        }

        const { groups, nameById } = await extractStatusNames(
          created.id,
          deps.env,
        );
        const rollup = computeStatusRollup(groups, nameById);

        const testCases = (raw.testCases ?? []).map(mapRunDetailTestCase);
        const testCasesNextCursor =
          rollup.total > TESTCASES_INLINE_LIMIT &&
          testCases.length === TESTCASES_INLINE_LIMIT
            ? testCases[testCases.length - 1].id
            : null;

        const detail = {
          ...mapRunRow(raw),
          statusCounts: rollup.statusCounts,
          untested: rollup.untested,
          total: rollup.total,
          testCases,
          testCasesNextCursor,
        };

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


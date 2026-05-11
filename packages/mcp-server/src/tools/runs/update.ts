import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Prisma } from "@prisma/client";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { resolveTagIds } from "../cases/shared.js";
import { resolveRunState } from "./create.js";
import {
  RUN_DETAIL_INCLUDE,
} from "./get.js";
import {
  computeStatusRollup,
  extractStatusNames,
  mapRunRow,
  mapRunDetailTestCase,
  type RawRunRow,
  type RawRunDetailTestCase,
} from "./shared.js";

export interface RunsUpdateDeps {
  env: EnvConfig;
}

const TESTCASES_INLINE_LIMIT = 50;

export function registerRunsUpdate(
  server: McpServer,
  deps: RunsUpdateDeps,
): void {
  server.registerTool(
    "testplanit_runs_update",
    {
      description:
        "Update an existing test run. Supports renaming, changing workflow state, swapping milestone or configuration, and replacing tags. All fields except runId are optional — only supplied fields are changed. Returns the full denormalized run detail (same shape as testplanit_test_runs_get).",
      inputSchema: {
        runId: z.number().int().positive().describe("ID of the run to update."),
        name: z
          .string()
          .min(1)
          .max(500)
          .optional()
          .describe("New run name."),
        stateName: z
          .string()
          .min(1)
          .optional()
          .describe("RUNS workflow state name to transition to."),
        milestoneId: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("Milestone to link; pass null to remove the current link."),
        configId: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("Configuration ID; pass null to remove."),
        tags: z
          .array(z.union([z.number().int().positive(), z.string().min(1)]))
          .optional()
          .describe(
            "Replacement tag list (full set). Tag IDs (numbers) or names (strings, created if missing). Replaces all current tags.",
          ),
        isCompleted: z
          .boolean()
          .optional()
          .describe("Mark the run as completed (true) or reopen it (false)."),
      },
    },
    async (input) => {
      try {
        const data: Record<string, unknown> = {};

        if (input.name !== undefined) data.name = input.name;

        if (input.stateName !== undefined) {
          // Fetch the run first to get projectId for state resolution.
          const run = await zenstack<{ projectId: number } | null>(
            "testRuns",
            "findUnique",
            {
              where: { id: input.runId },
              select: { projectId: true } satisfies Prisma.TestRunsSelect,
            },
            deps.env,
          );
          if (!run) {
            return {
              isError: true as const,
              content: [
                {
                  type: "text" as const,
                  text: `Test run ${input.runId} not found.`,
                },
              ],
            };
          }
          const state = await resolveRunState(
            run.projectId,
            deps.env,
            input.stateName,
          );
          data.state = { connect: { id: state.id } };
        }

        if (input.milestoneId !== undefined) {
          data.milestone =
            input.milestoneId === null
              ? { disconnect: true }
              : { connect: { id: input.milestoneId } };
        }

        if (input.configId !== undefined) {
          data.configuration =
            input.configId === null
              ? { disconnect: true }
              : { connect: { id: input.configId } };
        }

        if (input.isCompleted !== undefined) {
          data.isCompleted = input.isCompleted;
          if (input.isCompleted) {
            data.completedAt = new Date().toISOString();
          } else {
            data.completedAt = null;
          }
        }

        if (input.tags !== undefined) {
          const tagIds = await resolveTagIds(input.tags, deps.env);
          data.tags = { set: tagIds.map((id) => ({ id })) };
        }

        if (Object.keys(data).length === 0) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: "No fields to update — provide at least one optional field.",
              },
            ],
          };
        }

        await zenstack(
          "testRuns",
          "update",
          {
            where: { id: input.runId },
            data,
            select: { id: true },
          },
          deps.env,
        );

        const raw = await zenstack<
          (RawRunRow & { testCases: RawRunDetailTestCase[] }) | null
        >(
          "testRuns",
          "findUnique",
          {
            where: { id: input.runId },
            include: RUN_DETAIL_INCLUDE,
          },
          deps.env,
        );

        if (!raw) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Test run ${input.runId} not found after update.`,
              },
            ],
          };
        }

        const { groups, nameById } = await extractStatusNames(
          input.runId,
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

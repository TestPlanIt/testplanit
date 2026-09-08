import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  MilestonesFindUniqueArgs,
  SessionResultsGroupByArgs,
  SessionsFindManyArgs,
  StatusFindManyArgs,
  TestRunCasesGroupByArgs,
  TestRunsFindManyArgs,
} from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  MILESTONE_DETAIL_INCLUDE,
  MILESTONE_LINKED_TEST_RUNS_CAP,
  MILESTONE_LINKED_SESSIONS_CAP,
  MILESTONE_CHILDREN_CAP,
  computeStatusRollup,
  fetchDescendantCounts,
  mapMilestoneDetail,
  mergeMilestoneStatusGroups,
  type BatchedRunGroup,
  type BatchedSessionGroup,
  type RawMilestoneDetail,
} from "./shared.js";

type MilestonesWhereUniqueInput = NonNullable<MilestonesFindUniqueArgs["where"]>;

export interface MilestonesGetDeps {
  env: EnvConfig;
}

/**
 * `testplanit_milestones_get` — fetch a single milestone with the full
 * denormalized header, plain-text note + docs (ProseMirror), pooled
 * `statusCounts`, and three inlined linked arrays:
 *   - linkedTestRuns (cap 250 — wider than the standard 100; milestones
 *     legitimately carry hundreds of runs)
 *   - linkedSessions (cap 100)
 *   - children (cap 100, 1-level deep; each child carries totalDescendants)
 *
 * Per-array `truncated.<key>: true` overflow stamps so the agent can decide
 * to paginate via the dedicated list tools.
 *
 * Issues two recursive-CTE host calls per request:
 *   1. self → totalDescendants for the milestone itself.
 *   2. children → totalDescendants for each direct child.
 */
export function registerMilestonesGet(
  server: McpServer,
  deps: MilestonesGetDeps,
): void {
  server.registerTool(
    "testplanit_milestones_get",
    {
      description:
        "Fetch a single Milestone by id with denormalized header (milestoneType {id,name}, creator, parentId, directChildrenCount, commentCount, totalDescendants), note + docs (ProseMirror plain text), pooled statusCounts (testRuns + sessions merged) + untested + total, and three inlined linked arrays — linkedTestRuns (cap 250), linkedSessions (cap 100), children (cap 100, 1-level deep with totalDescendants). When an array overflows the cap the response carries truncated.<key>: true; the rest is reachable via testplanit_milestones_list with parentId, or testplanit_test_runs_list. No icon field — schema only carries an icon class identifier, deliberately dropped for v1.",
      inputSchema: { milestoneId: z.number().int().positive() },
    },
    async (input) => {
      try {
        const raw = await zenstack<RawMilestoneDetail | null>(
          "milestones",
          "findUnique",
          {
            where: {
              id: input.milestoneId,
              isDeleted: false,
            } satisfies MilestonesWhereUniqueInput,
            include: MILESTONE_DETAIL_INCLUDE,
          },
          deps.env,
        );
        if (!raw) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Milestone ${input.milestoneId} not found.`,
              },
            ],
          };
        }

        // Detect overflow per array via the take:cap+1 ceilings stamped
        // into MILESTONE_DETAIL_INCLUDE; trim each array to its inline cap
        // BEFORE mapping so the surfaced output never exceeds the bound.
        const truncated: {
          linkedTestRuns?: true;
          linkedSessions?: true;
          children?: true;
        } = {};
        if (raw.testRuns.length > MILESTONE_LINKED_TEST_RUNS_CAP) {
          truncated.linkedTestRuns = true;
        }
        if (raw.sessions.length > MILESTONE_LINKED_SESSIONS_CAP) {
          truncated.linkedSessions = true;
        }
        if (raw.children.length > MILESTONE_CHILDREN_CAP) {
          truncated.children = true;
        }

        const trimmed: RawMilestoneDetail = {
          ...raw,
          testRuns: raw.testRuns.slice(0, MILESTONE_LINKED_TEST_RUNS_CAP),
          sessions: raw.sessions.slice(0, MILESTONE_LINKED_SESSIONS_CAP),
          children: raw.children.slice(0, MILESTONE_CHILDREN_CAP),
        };

        // CR-02 fix: derive the rollup id sets from milestoneId-scoped
        // findMany queries rather than the trimmed inline arrays, so the
        // pooled statusCounts / untested / total stay correct even when
        // the inline display caps fire (e.g. milestones with >250 linked
        // runs). The cost is two short id-only findMany calls; the
        // resulting rollup matches what milestones_list reports for the
        // same milestone.
        const allRuns =
          (await zenstack<Array<{ id: number }>>(
            "testRuns",
            "findMany",
            {
              where: { milestoneId: raw.id, isDeleted: false },
              select: { id: true },
            } satisfies TestRunsFindManyArgs,
            deps.env,
          )) ?? [];
        const runIds = allRuns.map((r) => r.id);
        const allSessions =
          (await zenstack<Array<{ id: number }>>(
            "sessions",
            "findMany",
            {
              where: { milestoneId: raw.id, isDeleted: false },
              select: { id: true },
            } satisfies SessionsFindManyArgs,
            deps.env,
          )) ?? [];
        const sessionIds = allSessions.map((s) => s.id);

        // Pooled rollup for the milestone itself: same merge algorithm as
        // milestones_list, but bounded to a single milestone's runs +
        // sessions.
        let runGroups: BatchedRunGroup[] = [];
        if (runIds.length > 0) {
          runGroups =
            (await zenstack<BatchedRunGroup[]>(
              "testRunCases",
              "groupBy",
              {
                by: ["testRunId", "statusId"],
                where: { testRunId: { in: runIds } },
                _count: { id: true },
              } satisfies TestRunCasesGroupByArgs,
              deps.env,
            )) ?? [];
        }
        let sessionGroups: BatchedSessionGroup[] = [];
        if (sessionIds.length > 0) {
          sessionGroups =
            (await zenstack<BatchedSessionGroup[]>(
              "sessionResults",
              "groupBy",
              {
                by: ["sessionId", "statusId"],
                where: { sessionId: { in: sessionIds }, isDeleted: false },
                _count: { id: true },
              } satisfies SessionResultsGroupByArgs,
              deps.env,
            )) ?? [];
        }
        const nonNullStatusIds = Array.from(
          new Set([
            ...runGroups
              .map((g) => g.statusId)
              .filter((id): id is number => id !== null),
            ...sessionGroups.map((g) => g.statusId),
          ]),
        );
        const statuses =
          nonNullStatusIds.length === 0
            ? []
            : ((await zenstack<Array<{ id: number; name: string }>>(
                "status",
                "findMany",
                {
                  where: { id: { in: nonNullStatusIds } },
                  select: { id: true, name: true },
                } satisfies StatusFindManyArgs,
                deps.env,
              )) ?? []);
        const nameById = new Map<number, string>(
          statuses.map((s) => [s.id, s.name]),
        );

        const runIdToMilestoneId = new Map<number, number>(
          runIds.map((id) => [id, raw.id]),
        );
        const sessionIdToMilestoneId = new Map<number, number>(
          sessionIds.map((id) => [id, raw.id]),
        );
        const groupsByMilestone = mergeMilestoneStatusGroups({
          runGroups,
          sessionGroups,
          runIdToMilestoneId,
          sessionIdToMilestoneId,
        });
        const rollup = computeStatusRollup(
          groupsByMilestone.get(raw.id) ?? [],
          nameById,
        );

        // Two CTE calls — one for the milestone itself, one batched across
        // the direct children. Children's totalDescendants surfaces inline
        // so agents can prioritize which subtree to walk first without a
        // round trip per child.
        const selfDescendants = await fetchDescendantCounts(
          [raw.id],
          deps.env,
        );
        const childIds = trimmed.children.map((c) => c.id);
        const childTotalDescendants = await fetchDescendantCounts(
          childIds,
          deps.env,
        );

        const detail = mapMilestoneDetail(
          trimmed,
          {
            totalDescendants: selfDescendants.get(raw.id) ?? 0,
            rollup,
          },
          { truncated, childTotalDescendants },
        );
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

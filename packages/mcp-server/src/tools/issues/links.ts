import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  ISSUE_ROW_INCLUDE,
  mapIssueRow,
  type RawIssueRow,
} from "./shared.js";

export interface IssuesListLinksDeps {
  env: EnvConfig;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const TARGET_VALUES = [
  "cases",
  "sessions",
  "sessionResults",
  "testRuns",
  "testRunResults",
  "testRunStepResults",
] as const;
type Target = (typeof TARGET_VALUES)[number];

interface OutboundDescriptor {
  model: string;
  hasIsDeleted: boolean;
  selectShape: Record<string, unknown>;
  mapItem: (raw: Record<string, unknown>) => Record<string, unknown>;
}

// All 6 outbound targets carry `isDeleted` in their schema (verified against
// schema.zmodel: RepositoryCases, Sessions, SessionResults, TestRuns,
// TestRunResults, TestRunStepResults all declare `isDeleted Boolean`). We
// filter consistently. R2: TestRunStepResults uses the `stepStatus` relation
// to Status (NOT `status`); reintroducing `status: true` would TS2353 against
// Prisma.TestRunStepResultsSelect (Phase 7 invariant).
const OUTBOUND_MAP: Record<Target, OutboundDescriptor> = {
  cases: {
    model: "repositoryCases",
    hasIsDeleted: true,
    selectShape: {
      id: true,
      name: true,
      source: true,
      automated: true,
    },
    mapItem: (raw) => ({
      id: raw.id,
      name: raw.name,
      source: raw.source,
      automated: raw.automated,
    }),
  },
  sessions: {
    model: "sessions",
    hasIsDeleted: true,
    selectShape: {
      id: true,
      name: true,
      isCompleted: true,
      state: { select: { id: true, name: true } },
    },
    mapItem: (raw) => ({
      id: raw.id,
      name: raw.name,
      isCompleted: raw.isCompleted,
      state: raw.state ?? null,
    }),
  },
  sessionResults: {
    model: "sessionResults",
    hasIsDeleted: true,
    selectShape: {
      id: true,
      sessionId: true,
      executedAt: true,
      status: { select: { id: true, name: true } },
    },
    mapItem: (raw) => ({
      id: raw.id,
      sessionId: raw.sessionId,
      executedAt: raw.executedAt ?? null,
      status: raw.status ?? null,
    }),
  },
  testRuns: {
    model: "testRuns",
    hasIsDeleted: true,
    selectShape: {
      id: true,
      name: true,
      isCompleted: true,
      completedAt: true,
    },
    mapItem: (raw) => ({
      id: raw.id,
      name: raw.name,
      isCompleted: raw.isCompleted,
      completedAt: raw.completedAt ?? null,
    }),
  },
  testRunResults: {
    model: "testRunResults",
    hasIsDeleted: true,
    selectShape: {
      id: true,
      testRunId: true,
      executedAt: true,
      status: { select: { id: true, name: true } },
    },
    mapItem: (raw) => ({
      id: raw.id,
      testRunId: raw.testRunId,
      executedAt: raw.executedAt ?? null,
      status: raw.status ?? null,
    }),
  },
  testRunStepResults: {
    // R2: relation to Status is named `stepStatus` (NOT `status`) per
    // schema.zmodel:2437 — Phase 7 runs/shared.ts:79 already established
    // this. TestRunStepResults DOES carry isDeleted (schema.zmodel:2443),
    // so we filter consistently with the other 5 targets.
    model: "testRunStepResults",
    hasIsDeleted: true,
    selectShape: {
      id: true,
      testRunResultId: true,
      stepStatus: { select: { id: true, name: true } },
    },
    mapItem: (raw) => ({
      id: raw.id,
      testRunResultId: raw.testRunResultId,
      stepStatus: raw.stepStatus ?? null,
    }),
  },
};

const INBOUND_KEY_TO_RELATION: Record<
  string,
  { relation: string; hasIsDeleted: boolean }
> = {
  caseId: { relation: "repositoryCases", hasIsDeleted: true },
  sessionId: { relation: "sessions", hasIsDeleted: true },
  sessionResultId: { relation: "sessionResults", hasIsDeleted: true },
  runId: { relation: "testRuns", hasIsDeleted: true },
  runResultId: { relation: "testRunResults", hasIsDeleted: true },
  // TestRunStepResults DOES carry isDeleted (schema.zmodel:2443); filter
  // consistently with the other 5 inbound keys.
  runStepResultId: { relation: "testRunStepResults", hasIsDeleted: true },
};

export function registerIssuesListLinks(
  server: McpServer,
  deps: IssuesListLinksDeps,
): void {
  server.registerTool(
    "testplanit_issues_list_links",
    {
      description:
        "Walk the issue ↔ X graph in either direction. Outbound mode: provide issueId + target (one of: cases, sessions, sessionResults, testRuns, testRunResults, testRunStepResults) to get the linked counterpart rows. Inbound mode: provide exactly one of caseId, sessionId, sessionResultId, runId, runResultId, runStepResultId to get the issues linked to that row. Cursor pagination, deterministic orderBy.",
      inputSchema: {
        issueId: z.number().int().positive().optional(),
        target: z.enum(TARGET_VALUES).optional(),
        caseId: z.number().int().positive().optional(),
        sessionId: z.number().int().positive().optional(),
        sessionResultId: z.number().int().positive().optional(),
        runId: z.number().int().positive().optional(),
        runResultId: z.number().int().positive().optional(),
        runStepResultId: z.number().int().positive().optional(),
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(MAX_LIMIT).optional(),
      },
    },
    async (input) => {
      try {
        // Symmetric XOR validation per D7-11 — raw-shape inputSchema doesn't
        // compose with zod refine, so the gate lives in the handler.
        const inboundEntries: Array<[string, number]> = [];
        for (const key of Object.keys(INBOUND_KEY_TO_RELATION)) {
          const v = (input as Record<string, unknown>)[key];
          if (typeof v === "number") inboundEntries.push([key, v]);
        }
        const hasIssue = input.issueId !== undefined;
        const hasInbound = inboundEntries.length > 0;
        if (hasIssue === hasInbound) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: "Provide exactly one of issueId (with target) OR exactly one of (caseId, sessionId, sessionResultId, runId, runResultId, runStepResultId).",
              },
            ],
          };
        }
        if (hasInbound && inboundEntries.length !== 1) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: "Provide exactly one inbound id.",
              },
            ],
          };
        }
        if (hasIssue && input.target === undefined) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: "target is required when issueId is provided.",
              },
            ],
          };
        }
        if (hasInbound && input.target !== undefined) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: "target is only valid in outbound (issueId) mode.",
              },
            ],
          };
        }

        const limit = input.limit ?? DEFAULT_LIMIT;
        const body: Record<string, unknown> = {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        };
        if (input.cursor !== undefined) {
          body.cursor = { id: input.cursor };
          body.skip = 1;
        }

        if (hasIssue) {
          const target = input.target as Target;
          const desc = OUTBOUND_MAP[target];
          const issueClause = desc.hasIsDeleted
            ? {
                isDeleted: false,
                issues: { some: { id: input.issueId, isDeleted: false } },
              }
            : {
                issues: { some: { id: input.issueId, isDeleted: false } },
              };
          body.where = issueClause;
          body.select = desc.selectShape;
          const rows =
            (await zenstack<Array<Record<string, unknown>>>(
              desc.model,
              "findMany",
              body,
              deps.env,
            )) ?? [];
          const hasNextPage = rows.length > limit;
          const trimmed = rows.slice(0, limit);
          const items = trimmed.map(desc.mapItem);
          const nextCursor =
            hasNextPage && items.length > 0
              ? (items[items.length - 1].id as number)
              : null;
          const result = { items, hasNextPage, nextCursor };
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result as unknown as Record<string, unknown>,
          };
        }

        // inbound mode
        const [inboundKey, inboundId] = inboundEntries[0];
        const rel = INBOUND_KEY_TO_RELATION[inboundKey];
        const someClause = rel.hasIsDeleted
          ? { id: inboundId, isDeleted: false }
          : { id: inboundId };
        body.where = {
          isDeleted: false,
          [rel.relation]: { some: someClause },
        };
        body.include = ISSUE_ROW_INCLUDE;
        const rows =
          (await zenstack<RawIssueRow[]>("issue", "findMany", body, deps.env)) ??
          [];
        const hasNextPage = rows.length > limit;
        const trimmed = rows.slice(0, limit);
        const items = trimmed.map(mapIssueRow);
        const nextCursor =
          hasNextPage && items.length > 0
            ? items[items.length - 1].id
            : null;
        const result = { items, hasNextPage, nextCursor };
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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Prisma } from "@prisma/client";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { mapCaseRow } from "./shared.js";

export interface CasesListDeps {
  env: EnvConfig;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
// Phase 8 D8-02: handler-side post-filter for staleSinceUpdate cannot be
// expressed as a `where` clause (per-row arithmetic across two relation
// timestamps + the versioned lastUpdatedAt). Bound the scan at 400 rows
// (4× MAX_LIMIT) and surface `truncated: true` on the result envelope when
// the cap is hit, so agents know they may need to page (RESEARCH § Pitfall 8).
const POST_FILTER_SCAN_CAP = 400;

const CASE_ROW_INCLUDE = {
  project: { select: { id: true, name: true } },
  folder: { select: { id: true, name: true, parentId: true } },
  state: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true, email: true } },
  tags: { select: { id: true, name: true } },
  // Phase 8 D8-02: latest version for lastUpdatedAt + sub-orderings for
  // latestResult union. Each take:1 sub-include carries deterministic
  // orderBy [{<field>:"desc"},{id:"desc"}] (Pitfall 5 / Phase 7 MED-02).
  repositoryCaseVersions: {
    orderBy: [{ version: "desc" }, { id: "desc" }],
    take: 1,
    select: { createdAt: true, version: true },
  },
  junitResults: {
    orderBy: [{ executedAt: "desc" }, { id: "desc" }],
    take: 1,
    select: {
      id: true,
      executedAt: true,
      status: { select: { id: true, name: true } },
    },
  },
  testRuns: {
    // testRuns is the TestRunCases[] junction (RepositoryCases.testRuns).
    // Order by id desc and grab the latest result per junction row;
    // resolveLatestResult collapses the union at the mapper boundary.
    orderBy: [{ id: "desc" }],
    take: 1,
    select: {
      results: {
        where: { isDeleted: false },
        orderBy: [{ executedAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          id: true,
          executedAt: true,
          status: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const satisfies Prisma.RepositoryCasesInclude;

// Phase 8 D8-02: enum literals for the source filter. Mirrors
// RepositoryCaseSource on schema.zmodel:1470 — keep synchronized.
const SOURCE_VALUES = [
  "MANUAL",
  "JUNIT",
  "TESTNG",
  "XUNIT",
  "NUNIT",
  "MSTEST",
  "MOCHA",
  "CUCUMBER",
  "API",
] as const;

export function registerCasesList(server: McpServer, deps: CasesListDeps): void {
  server.registerTool(
    "testplanit_cases_list",
    {
      description:
        "List test cases scoped to a project. Filters: folderId, tagIds, name (case-insensitive substring), stateId, customField (by display name), issueId (linked Issue numeric id — see issues_list for resolution from external keys). Cursor pagination via the `cursor` returned in `nextCursor`. (per CASE-01 + EXEC-06 chain via D7-03) " +
        "Phase-8 maintenance filters: automated (user-controlled flag), source (single or array of RepositoryCaseSource), repositoryId, hasNeverExecuted (no junitResults AND no TestRunResults via TestRunCases), staleSinceUpdate (handler-side post-filter — bounded scan of POST_FILTER_SCAN_CAP=400; surfaces truncated:true when scan cap hit), updatedAfter/updatedBefore (filter via the repositoryCaseVersions relation since RepositoryCases has no updatedAt column). Each row carries lastUpdatedAt and latestResult (union of latest junitResults / TestRunResults). " +
        "Creator and date filters: creatorIds (array of user ids — matches any; deliberately array-shaped while runs_list/sessions_list use single-string createdById), from/to (ISO 8601 createdAt range).",
      inputSchema: {
        projectId: z.number().int().positive(),
        folderId: z.number().int().positive().optional(),
        tagIds: z.array(z.number().int().positive()).optional(),
        name: z.string().min(1).optional(),
        stateId: z.number().int().positive().optional(),
        // BL-02: only `name` is supported. Value-equality on the Json?
        // `caseFieldValues.value` column is unreliable across field types
        // (Dropdown stores option IDs, Multi-Select stores arrays, Text
        // stores strings). Silently swallowing an agent-supplied `value`
        // (the prior behavior) would let the agent act on incorrect data.
        // Dropping it from the schema makes the unsupported dimension
        // explicit; agents that need value filtering should call
        // testplanit_cases_get on candidate IDs and filter locally.
        customField: z
          .object({
            name: z.string().min(1),
          })
          .optional(),
        // D7-03: filter cases linked to a specific issue. Pass the internal
        // numeric Issue.id (the Phase-8 `issues_list` / `issues_get` `id`
        // field), NOT the externalKey. `externalKey` (e.g. "JIRA-123") is
        // intentionally NOT a filter dimension here because it is not
        // globally unique on the schema (`@@unique([externalId,
        // integrationId])` is the only constraint — multiple integrations
        // can have the same external key). Phase 8 ships proper issueKey
        // resolution scoped by integration.
        issueId: z.number().int().positive().optional(),
        // Phase-8 D8-02 maintenance filters.
        automated: z.boolean().optional(),
        source: z
          .union([z.enum(SOURCE_VALUES), z.array(z.enum(SOURCE_VALUES))])
          .optional(),
        repositoryId: z.number().int().positive().optional(),
        hasNeverExecuted: z.boolean().optional(),
        staleSinceUpdate: z.boolean().optional(),
        updatedAfter: z.string().datetime({ offset: true }).optional(),
        updatedBefore: z.string().datetime({ offset: true }).optional(),
        creatorIds: z.array(z.string().trim().min(1)).optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(MAX_LIMIT).optional(),
      },
    },
    async (input) => {
      try {
        const limit = input.limit ?? DEFAULT_LIMIT;
        // REVIEW MED-03 fix: use Prisma's typed where so reintroducing an
        // unknown column or forgetting a relation accessor TS2353s at
        // compile time. The previous `Record<string, unknown>` annotation
        // accepted any shape including `updatedAt` (which doesn't exist on
        // RepositoryCases — Pitfall 1).
        const where: Prisma.RepositoryCasesWhereInput = {
          projectId: input.projectId,
          isDeleted: false,
        };
        if (input.folderId !== undefined) where.folderId = input.folderId;
        if (input.tagIds && input.tagIds.length > 0) {
          where.tags = { some: { id: { in: input.tagIds } } };
        }
        if (input.name) {
          where.name = { contains: input.name, mode: "insensitive" };
        }
        if (input.stateId !== undefined) where.stateId = input.stateId;
        if (input.customField) {
          where.caseFieldValues = {
            some: { field: { displayName: input.customField.name } },
          };
        }
        if (input.issueId !== undefined) {
          // D7-03: RepositoryCases.issues is many-to-many to Issue. Filtering
          // `some: { isDeleted: false }` excludes soft-deleted issue links
          // from matching, consistent with the soft-delete invariant.
          where.issues = { some: { id: input.issueId, isDeleted: false } };
        }
        // Phase-8 D8-02 filter appends.
        if (input.automated !== undefined) where.automated = input.automated;
        if (input.source !== undefined) {
          where.source = Array.isArray(input.source)
            ? { in: input.source }
            : input.source;
        }
        if (input.repositoryId !== undefined) {
          where.repositoryId = input.repositoryId;
        }
        if (input.hasNeverExecuted) {
          // Pure-where (RESEARCH § 3.1) — no execution exists when
          // junitResults has no rows AND no TestRunCases junction has any
          // associated results.
          where.junitResults = { none: {} };
          where.testRuns = { none: { results: { some: {} } } };
        }
        if (
          input.updatedAfter !== undefined ||
          input.updatedBefore !== undefined
        ) {
          // Pitfall 1: RepositoryCases has no updatedAt column — go through
          // the repositoryCaseVersions relation (the row matching
          // currentVersion carries the canonical lastUpdatedAt).
          const createdAt: { gte?: Date; lte?: Date } = {};
          if (input.updatedAfter !== undefined) {
            createdAt.gte = new Date(input.updatedAfter);
          }
          if (input.updatedBefore !== undefined) {
            createdAt.lte = new Date(input.updatedBefore);
          }
          where.repositoryCaseVersions = { some: { createdAt } };
        }
        if (input.creatorIds && input.creatorIds.length > 0) {
          where.creatorId = { in: input.creatorIds };
        }
        if (input.from || input.to) {
          where.createdAt = {
            ...(input.from ? { gte: new Date(input.from) } : {}),
            ...(input.to ? { lte: new Date(input.to) } : {}),
          };
        }

        // staleSinceUpdate over-fetches up to POST_FILTER_SCAN_CAP+1 rows so
        // the handler can detect when more rows existed than the post-filter
        // could consider (Pitfall 8). Otherwise default cursor pagination.
        const fetchTake = input.staleSinceUpdate
          ? Math.min(POST_FILTER_SCAN_CAP, limit * 4) + 1
          : limit + 1;
        const body: Record<string, unknown> = {
          where,
          include: CASE_ROW_INCLUDE,
          orderBy: { id: "asc" },
          take: fetchTake,
        };
        if (input.cursor !== undefined) {
          body.cursor = { id: input.cursor };
          body.skip = 1;
        }

        const rows = (await zenstack<unknown[]>(
          "repositoryCases",
          "findMany",
          body,
          deps.env,
        )) ?? [];

        let scanned: unknown[] = rows;
        let staleTruncated = false;
        if (input.staleSinceUpdate) {
          // The over-fetch grabs POST_FILTER_SCAN_CAP+1 rows so we can
          // surface truncated when the underlying scan exceeded the cap.
          staleTruncated = scanned.length > POST_FILTER_SCAN_CAP;
          scanned = scanned.filter((r) => {
            const row = r as {
              repositoryCaseVersions?: Array<{ createdAt: Date | string }>;
              junitResults?: Array<{ executedAt: Date | string | null }>;
              testRuns?: Array<{
                results: Array<{ executedAt: Date | string | null }>;
              }>;
            };
            const lastUpdated = row.repositoryCaseVersions?.[0]?.createdAt;
            if (!lastUpdated) {
              // No version row → cannot compute staleness. Treat as
              // never-executed/stale per RESEARCH § 3 (the safer default
              // for a maintenance dashboard).
              return true;
            }
            const lastUpdatedMs = new Date(lastUpdated).getTime();
            const j = row.junitResults?.[0]?.executedAt;
            const t = row.testRuns?.[0]?.results?.[0]?.executedAt;
            const latestExec =
              j && t
                ? Math.max(new Date(j).getTime(), new Date(t).getTime())
                : j
                  ? new Date(j).getTime()
                  : t
                    ? new Date(t).getTime()
                    : null;
            // Stale = never executed OR latest exec strictly older than
            // the last-update timestamp.
            return latestExec === null || latestExec < lastUpdatedMs;
          });
        }

        const hasNextPage = input.staleSinceUpdate
          ? scanned.length > limit || staleTruncated
          : rows.length > limit;
        const trimmed = scanned.slice(0, limit);
        const items = trimmed.map((r) => mapCaseRow(r as never));
        const nextCursor =
          hasNextPage && items.length > 0
            ? (items[items.length - 1] as { id: number }).id
            : null;

        const result: Record<string, unknown> = {
          items,
          hasNextPage,
          nextCursor,
        };
        if (staleTruncated) result.truncated = true;
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}

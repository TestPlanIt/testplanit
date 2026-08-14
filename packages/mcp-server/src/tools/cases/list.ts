import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RepositoryCasesInclude } from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  buildFolderIndex,
  buildPathInfo,
  collectSubtreeIds,
  fetchProjectFolders,
  MAX_SUBTREE_FOLDER_IDS,
  type FolderIndex,
  type FolderPathInfo,
} from "../folders/tree.js";
import { mapCaseRow } from "./shared.js";
import { buildCasesWhere, CASES_FILTER_SHAPE } from "./where.js";

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
  // RepositoryCases tags now live on the explicit RepositoryCaseTag join
  // model — select through caseTags.tag (the implicit `tags` relation no
  // longer exists and would 422).
  caseTags: { select: { tag: { select: { id: true, name: true } } } },
  // Phase 8 D8-02: latest version for lastUpdatedAt + sub-orderings for
  // latestResult union. Each take:1 sub-include carries deterministic
  // orderBy (Pitfall 5 / Phase 7 MED-02).
  repositoryCaseVersions: {
    orderBy: [{ version: "desc" }, { id: "desc" }],
    take: 1,
    select: { createdAt: true, version: true },
  },
  // executedAt is nullable and Postgres puts NULLs first under plain desc,
  // so a timestampless imported row would shadow the real latest result —
  // nulls:"last" keeps slot 0 on the greatest non-null executedAt, which
  // both latestResult and lastAutomatedResultAt read.
  junitResults: {
    orderBy: [{ executedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
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
} as const satisfies RepositoryCasesInclude;

export function registerCasesList(server: McpServer, deps: CasesListDeps): void {
  server.registerTool(
    "testplanit_cases_list",
    {
      description:
        "List test cases scoped to a project. Filters: folderId (exact folder; add includeDescendants:true to cover the folder's entire subtree), tagIds, name (case-insensitive substring), stateId, customField, issueId (linked Issue numeric id — see issues_list for resolution from external keys). customField takes {name} to match cases that have the field set, or {name, value} to match by value (Dropdown/Multi-Select accept the option name or id; an unknown field name or option returns a validation error rather than unfiltered results). Cursor pagination via the `cursor` returned in `nextCursor`. (per CASE-01 + EXEC-06 chain via D7-03) " +
        "Phase-8 maintenance filters: automated (user-controlled intent flag), source (single or array of RepositoryCaseSource), repositoryId, hasNeverExecuted (no junitResults AND no TestRunResults via TestRunCases), staleSinceUpdate (handler-side post-filter — bounded scan of POST_FILTER_SCAN_CAP=400; surfaces truncated:true when scan cap hit), updatedAfter/updatedBefore (filter via the repositoryCaseVersions relation since RepositoryCases has no updatedAt column). Each row carries lastUpdatedAt, latestResult (union of latest junitResults / TestRunResults), plus the automation-reality pair hasAutomatedResults / lastAutomatedResultAt (JUnit result rows — execution evidence, distinct from the user-set `automated` flag). " +
        "Automation-reality filters: hasAutomatedResults (a JUnit result row exists), automatedResultSince (has a JUnit result at/after the ISO timestamp), noAutomatedResultSince (NO JUnit result at/after the timestamp — with automated:true this finds flagged-automated cases whose automation has gone quiet). " +
        "Creator and date filters: creatorIds (array of user ids — matches any; deliberately array-shaped while runs_list/sessions_list use single-string createdById), from/to (ISO 8601 createdAt range). " +
        "Set includeFolderPath:true to expand each row's folder to {id, name, path, ancestorIds, rootId, rootName} — a full leaf-to-area mapping with no extra folders_get calls. For counts and per-folder rollups use testplanit_cases_count instead of paginating this tool.",
      inputSchema: {
        ...CASES_FILTER_SHAPE,
        staleSinceUpdate: z.boolean().optional(),
        includeFolderPath: z.boolean().optional(),
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(MAX_LIMIT).optional(),
      },
    },
    async (input) => {
      try {
        const limit = input.limit ?? DEFAULT_LIMIT;
        const where = await buildCasesWhere(input, deps.env);

        // One flat folder fetch serves both subtree expansion and path
        // enrichment when either is requested.
        const wantsSubtree =
          input.includeDescendants === true && input.folderId !== undefined;
        let folderIndex: FolderIndex | null = null;
        if (wantsSubtree || input.includeFolderPath) {
          folderIndex = buildFolderIndex(
            await fetchProjectFolders(input.projectId, deps.env),
          );
        }
        if (wantsSubtree && folderIndex) {
          if (!folderIndex.byId.has(input.folderId!)) {
            return {
              isError: true as const,
              content: [
                {
                  type: "text" as const,
                  text: `Folder ${input.folderId} not found in project ${input.projectId}.`,
                },
              ],
            };
          }
          const subtreeIds = collectSubtreeIds(folderIndex, input.folderId!);
          if (subtreeIds.length > MAX_SUBTREE_FOLDER_IDS) {
            return {
              isError: true as const,
              content: [
                {
                  type: "text" as const,
                  text:
                    `Folder ${input.folderId} has ${subtreeIds.length} folders in its subtree — over the ${MAX_SUBTREE_FOLDER_IDS}-folder limit for includeDescendants on cases_list. ` +
                    "Use testplanit_cases_count (which scopes subtrees without this limit) for rollups, or list a deeper folder.",
                },
              ],
            };
          }
          where.folderId = { in: subtreeIds };
        }
        const folderPaths: Map<number, FolderPathInfo> | undefined =
          input.includeFolderPath && folderIndex
            ? buildPathInfo(folderIndex)
            : undefined;

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
        const items = trimmed.map((r) => mapCaseRow(r as never, folderPaths));
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

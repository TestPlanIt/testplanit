import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  RepositoryCaseTagGroupByArgs,
  RepositoryCasesCountArgs,
  RepositoryCasesGroupByArgs,
  RepositoryCasesWhereInput,
  TagsFindManyArgs,
  UserFindManyArgs,
  WorkflowsFindManyArgs,
} from "@db/input";
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
} from "../folders/tree.js";
import { buildCasesWhere, CASES_FILTER_SHAPE } from "./where.js";

export interface CasesCountDeps {
  env: EnvConfig;
}

const GROUP_DIMENSIONS = [
  "folder",
  "folderRoot",
  "tag",
  "state",
  "source",
  "creator",
] as const;

type GroupKey = {
  id: number | string;
  name: string | null;
  [extra: string]: unknown;
};
interface Group {
  key: GroupKey;
  count: number;
}

/**
 * One batched groupBy over folderId — the workhorse for every folder-shaped
 * aggregation (folder / folderRoot groupings, subtree-scoped totals). Same
 * per-page-batched rollup pattern the run statusCounts use: never N+1.
 */
async function groupCountsByFolder(
  where: RepositoryCasesWhereInput,
  env: EnvConfig,
): Promise<Array<{ folderId: number; count: number }>> {
  const groups = await zenstack<
    Array<{ folderId: number; _count: { id: number } }>
  >(
    "repositoryCases",
    "groupBy",
    {
      by: ["folderId"],
      where,
      _count: { id: true },
    } satisfies RepositoryCasesGroupByArgs,
    env,
  );
  return (groups ?? []).map((g) => ({ folderId: g.folderId, count: g._count.id }));
}

function sortGroups(groups: Group[]): Group[] {
  return groups.sort(
    (a, b) => b.count - a.count || String(a.key.name ?? "").localeCompare(String(b.key.name ?? "")),
  );
}

export function registerCasesCount(
  server: McpServer,
  deps: CasesCountDeps,
): void {
  server.registerTool(
    "testplanit_cases_count",
    {
      description:
        "Count test cases server-side — the aggregation companion to testplanit_cases_list. Accepts the same filters (folderId + includeDescendants for whole-subtree scope, tagIds, name, stateId, customField, issueId, automated, source, repositoryId, hasNeverExecuted, hasAutomatedResults, automatedResultSince, noAutomatedResultSince, updatedAfter/updatedBefore, creatorIds, from/to) and returns {total} — never paginate cases_list just to count. " +
        "Optional groupBy returns {total, groups: [{key, count}]} sorted by count desc: 'folder' (key: {id, name, path, rootId, rootName} — leaf-folder detail with the area rollup key inline), 'folderRoot' (key: {id, name} — top-level area totals), 'tag' (key: {id, name}; a case carries any number of tags, so tag counts do NOT sum to total), 'state' (key: {id, name}), 'source' (key/name = RepositoryCaseSource value), 'creator' (key: {id, name, email}). Only non-empty groups are returned. " +
        "Example — automation coverage by feature area: cases_count({projectId, groupBy: 'folderRoot'}) for denominators, cases_count({projectId, automated: true, groupBy: 'folderRoot'}) for numerators; swap groupBy to 'folder' for leaf detail. " +
        "staleSinceUpdate is deliberately NOT accepted: it is a bounded post-filter scan on cases_list and a count built on it could disagree with enumeration; page cases_list for that dimension. Grouping by a custom field (e.g. priority) is not supported — custom fields live in caseFieldValues rows, not columns; run one cases_count per customField {name, value} instead.",
      inputSchema: {
        ...CASES_FILTER_SHAPE,
        groupBy: z.enum(GROUP_DIMENSIONS).optional(),
      },
    },
    async (input) => {
      try {
        const where = await buildCasesWhere(input, deps.env);
        const scoped =
          input.includeDescendants === true && input.folderId !== undefined;
        const needsFolderIndex =
          scoped || input.groupBy === "folder" || input.groupBy === "folderRoot";

        let folderIndex: FolderIndex | null = null;
        let subtree: Set<number> | null = null;
        if (needsFolderIndex) {
          folderIndex = buildFolderIndex(
            await fetchProjectFolders(input.projectId, deps.env),
          );
          if (scoped) {
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
            subtree = new Set(collectSubtreeIds(folderIndex, input.folderId!));
          }
        }

        // Subtree-scoped totals avoid an id in-clause entirely: group by
        // folderId project-wide (bounded by distinct folders holding
        // matches), then keep the groups inside the subtree.
        const totalViaFolderGroups = async (): Promise<number> => {
          const groups = await groupCountsByFolder(where, deps.env);
          return groups
            .filter((g) => !subtree || subtree.has(g.folderId))
            .reduce((s, g) => s + g.count, 0);
        };

        // Plain total — reused standalone and as the 'tag' grouping's total
        // (tag groups multi-count cases, so their sum is NOT the total).
        const computeTotal = async (): Promise<number> => {
          if (scoped) return totalViaFolderGroups();
          return (
            (await zenstack<number>(
              "repositoryCases",
              "count",
              { where } satisfies RepositoryCasesCountArgs,
              deps.env,
            )) ?? 0
          );
        };

        if (input.groupBy === undefined) {
          const total = await computeTotal();
          const result = { total };
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result as unknown as Record<string, unknown>,
          };
        }

        let groups: Group[] = [];
        let total = 0;

        if (input.groupBy === "folder" || input.groupBy === "folderRoot") {
          const folderGroups = (await groupCountsByFolder(where, deps.env)).filter(
            (g) => !subtree || subtree.has(g.folderId),
          );
          total = folderGroups.reduce((s, g) => s + g.count, 0);
          const paths = buildPathInfo(folderIndex!);
          if (input.groupBy === "folder") {
            groups = folderGroups.map((g) => {
              const info = paths.get(g.folderId);
              return {
                key: {
                  id: g.folderId,
                  name: folderIndex!.byId.get(g.folderId)?.name ?? "Unknown",
                  path: info?.path ?? null,
                  rootId: info?.rootId ?? null,
                  rootName: info?.rootName ?? null,
                },
                count: g.count,
              };
            });
          } else {
            const byRoot = new Map<number, Group>();
            for (const g of folderGroups) {
              const info = paths.get(g.folderId);
              // Defensive: a folder missing from the index (data race) rolls
              // up under itself rather than being dropped from the total.
              const rootId = info?.rootId ?? g.folderId;
              const rootName =
                info?.rootName ??
                folderIndex!.byId.get(g.folderId)?.name ??
                "Unknown";
              const existing = byRoot.get(rootId);
              if (existing) existing.count += g.count;
              else
                byRoot.set(rootId, {
                  key: { id: rootId, name: rootName },
                  count: g.count,
                });
            }
            groups = Array.from(byRoot.values());
          }
        } else if (input.groupBy === "tag") {
          // Tags hang off the RepositoryCaseTag join model — group that,
          // scoped through its `case` relation. Subtree scope needs the id
          // in-clause here (the join row has no folderId to post-filter on).
          const caseWhere: RepositoryCasesWhereInput = { ...where };
          if (scoped) {
            if (subtree!.size > MAX_SUBTREE_FOLDER_IDS) {
              return {
                isError: true as const,
                content: [
                  {
                    type: "text" as const,
                    text:
                      `Folder ${input.folderId} has ${subtree!.size} folders in its subtree — over the ${MAX_SUBTREE_FOLDER_IDS}-folder limit for groupBy:'tag' with includeDescendants. ` +
                      "Scope to a deeper folder, or group without the subtree filter.",
                  },
                ],
              };
            }
            caseWhere.folderId = { in: Array.from(subtree!) };
          }
          const tagGroups =
            (await zenstack<Array<{ tagId: number; _count: { caseId: number } }>>(
              "repositoryCaseTag",
              "groupBy",
              {
                by: ["tagId"],
                where: { case: caseWhere },
                _count: { caseId: true },
              } satisfies RepositoryCaseTagGroupByArgs,
              deps.env,
            )) ?? [];
          const tagIds = tagGroups.map((g) => g.tagId);
          const nameById = new Map<number, string>();
          if (tagIds.length > 0) {
            const tags =
              (await zenstack<Array<{ id: number; name: string }>>(
                "tags",
                "findMany",
                {
                  where: { id: { in: tagIds } },
                  select: { id: true, name: true },
                } satisfies TagsFindManyArgs,
                deps.env,
              )) ?? [];
            for (const t of tags) nameById.set(t.id, t.name);
          }
          groups = tagGroups.map((g) => ({
            key: { id: g.tagId, name: nameById.get(g.tagId) ?? "Unknown" },
            count: g._count.caseId,
          }));
          total = await computeTotal();
        } else {
          // state / source / creator: single scalar dimension. Subtree scope
          // adds folderId as a second grouping key and re-aggregates after
          // the in-memory subtree filter — no id in-clause, no cap.
          const dimField =
            input.groupBy === "state"
              ? ("stateId" as const)
              : input.groupBy === "source"
                ? ("source" as const)
                : ("creatorId" as const);
          const by = scoped
            ? ([dimField, "folderId"] as [typeof dimField, "folderId"])
            : ([dimField] as [typeof dimField]);
          const rawGroups =
            (await zenstack<
              Array<
                Record<string, unknown> & {
                  folderId?: number;
                  _count: { id: number };
                }
              >
            >(
              "repositoryCases",
              "groupBy",
              {
                by,
                where,
                _count: { id: true },
              } satisfies RepositoryCasesGroupByArgs,
              deps.env,
            )) ?? [];
          const byDim = new Map<number | string, number>();
          for (const g of rawGroups) {
            if (subtree && (g.folderId === undefined || !subtree.has(g.folderId)))
              continue;
            const dim = g[dimField] as number | string;
            byDim.set(dim, (byDim.get(dim) ?? 0) + g._count.id);
          }
          total = Array.from(byDim.values()).reduce((s, n) => s + n, 0);

          if (input.groupBy === "source") {
            groups = Array.from(byDim.entries()).map(([dim, count]) => ({
              key: { id: dim, name: String(dim) },
              count,
            }));
          } else if (input.groupBy === "state") {
            const ids = Array.from(byDim.keys()) as number[];
            const nameById = new Map<number, string>();
            if (ids.length > 0) {
              const states =
                (await zenstack<Array<{ id: number; name: string }>>(
                  "workflows",
                  "findMany",
                  {
                    where: { id: { in: ids } },
                    select: { id: true, name: true },
                  } satisfies WorkflowsFindManyArgs,
                  deps.env,
                )) ?? [];
              for (const s of states) nameById.set(s.id, s.name);
            }
            groups = Array.from(byDim.entries()).map(([dim, count]) => ({
              key: {
                id: dim,
                name: nameById.get(dim as number) ?? "Unknown",
              },
              count,
            }));
          } else {
            const ids = Array.from(byDim.keys()) as string[];
            const userById = new Map<
              string,
              { name: string | null; email: string | null }
            >();
            if (ids.length > 0) {
              const users =
                (await zenstack<
                  Array<{ id: string; name: string | null; email: string }>
                >(
                  "user",
                  "findMany",
                  {
                    where: { id: { in: ids } },
                    select: { id: true, name: true, email: true },
                  } satisfies UserFindManyArgs,
                  deps.env,
                )) ?? [];
              for (const u of users)
                userById.set(u.id, { name: u.name, email: u.email });
            }
            groups = Array.from(byDim.entries()).map(([dim, count]) => {
              const u = userById.get(dim as string);
              return {
                key: {
                  id: dim,
                  // A creator outside the caller's collaborator read scope
                  // resolves to nulls rather than an error.
                  name: u?.name ?? null,
                  email: u?.email ?? null,
                },
                count,
              };
            });
          }
        }

        const result = { total, groups: sortGroups(groups) };
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

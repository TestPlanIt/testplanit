import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  buildFolderIndex,
  computeRecursiveCounts,
  fetchAutomatedCaseCounts,
  fetchProjectFolders,
  type FlatFolder,
  type FolderIndex,
} from "./tree.js";

export interface FoldersListDeps {
  env: EnvConfig;
}

// Depth guard mirrors MAX_BREADCRUMB_DEPTH's spirit: the app UI nests far
// shallower than this; anything deeper is a corrupt parent chain.
const MAX_DEPTH = 25;
const DEFAULT_DEPTH = 2;

export interface FolderListNode {
  id: number;
  name: string;
  parentId: number | null;
  /** Direct live-case count — accurate at EVERY depth, including the cut. */
  caseCount: number;
  hasChildren: boolean;
  caseCountRecursive?: number;
  automatedCaseCount?: number;
  automatedCaseCountRecursive?: number;
  /** Present (an array) when serialized; null + truncated:true at the cut. */
  children: FolderListNode[] | null;
  truncated?: true;
}

interface CountMaps {
  recursive: Map<number, number>;
  automatedDirect: Map<number, number>;
  automatedRecursive: Map<number, number>;
}

function serializeNode(
  folder: FlatFolder,
  index: FolderIndex,
  depthLeft: number,
  counts: CountMaps | null,
): FolderListNode {
  const children = index.childrenOf.get(folder.id) ?? [];
  const node: FolderListNode = {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    caseCount: folder.caseCount,
    hasChildren: children.length > 0,
    children: null,
  };
  if (counts) {
    node.caseCountRecursive = counts.recursive.get(folder.id) ?? 0;
    node.automatedCaseCount = counts.automatedDirect.get(folder.id) ?? 0;
    node.automatedCaseCountRecursive =
      counts.automatedRecursive.get(folder.id) ?? 0;
  }
  if (depthLeft > 0 || children.length === 0) {
    node.children = children.map((c) =>
      serializeNode(c, index, depthLeft - 1, counts),
    );
  } else {
    // Explicit truncation signal: children exist but are beyond the
    // requested depth. Never wire-identical to an empty leaf — an empty
    // leaf serializes children: [] with hasChildren: false.
    node.children = null;
    node.truncated = true;
  }
  return node;
}

export function registerFoldersList(server: McpServer, deps: FoldersListDeps): void {
  server.registerTool(
    "testplanit_folders_list",
    {
      description:
        "List the folder tree for a project. Every serialized node carries its accurate direct caseCount (soft-deleted excluded) and hasChildren. `depth` controls how many levels below the roots are inlined (default 2; pass 'all' for the entire tree) — nodes at the cut with children beyond it get children:null + truncated:true, so an empty leaf (children:[], hasChildren:false) is never confusable with an unfetched subtree. " +
        "Pass includeRecursiveCounts:true to add caseCountRecursive, automatedCaseCount, and automatedCaseCountRecursive to every node — one call answers 'total and automated cases per area at any depth' (recursive totals on each root sum to the project total). For rollups filtered beyond the automated flag, use testplanit_cases_count.",
      inputSchema: {
        projectId: z.number().int().positive(),
        depth: z
          .union([z.number().int().min(0).max(MAX_DEPTH), z.literal("all")])
          .optional(),
        includeRecursiveCounts: z.boolean().optional(),
      },
    },
    async (input) => {
      try {
        const folders = await fetchProjectFolders(input.projectId, deps.env);
        const index = buildFolderIndex(folders);

        let counts: CountMaps | null = null;
        if (input.includeRecursiveCounts) {
          const direct = new Map(folders.map((f) => [f.id, f.caseCount]));
          const automatedDirect = await fetchAutomatedCaseCounts(
            input.projectId,
            deps.env,
          );
          counts = {
            recursive: computeRecursiveCounts(index, direct),
            automatedDirect,
            automatedRecursive: computeRecursiveCounts(index, automatedDirect),
          };
        }

        const depthLeft =
          input.depth === "all"
            ? Number.POSITIVE_INFINITY
            : (input.depth ?? DEFAULT_DEPTH);
        const roots = index.childrenOf.get(null) ?? [];
        const tree = roots.map((r) =>
          serializeNode(r, index, depthLeft, counts),
        );
        const out = { tree };
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          structuredContent: out as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}

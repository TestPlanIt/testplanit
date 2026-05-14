import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Prisma } from "@prisma/client";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  LINK_INCLUDE,
  mapLinkRowDirectional,
  mapLinkRowOtherCase,
  type RawLinkRow,
} from "./shared.js";

export interface RepositoryCaseLinksListDeps {
  env: EnvConfig;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Register `testplanit_repository_case_links_list` — read-only traversal
 * of the RepositoryCaseLink graph between manual and imported cases.
 *
 * Three input modes (3-way XOR; exactly one ID must be supplied):
 *   - caseId — bidirectional, matches both caseA.id and caseB.id via OR
 *   - caseAId — one-way, originating side
 *   - caseBId — one-way, destination side
 *
 * Optional `linkType` narrows to a single LinkType variant.
 * Optional `cursor` + `limit` (≤ 100) drive deterministic pagination
 * ordered by [createdAt DESC, id DESC].
 *
 * Response shape varies by mode:
 *   - caseId mode: each row carries `otherCase` (the side opposite the
 *     queried id) instead of caseA/caseB.
 *   - caseAId / caseBId mode: each row carries both caseA and caseB.
 *
 * Project scope is enforced transitively by the host's @@allow rules on
 * caseA.project — RepositoryCaseLink itself is not project-scoped, so the
 * tool deliberately exposes no project-id input.
 */
export function registerRepositoryCaseLinksList(
  server: McpServer,
  deps: RepositoryCaseLinksListDeps,
): void {
  server.registerTool(
    "testplanit_repository_case_links_list",
    {
      description:
        "List RepositoryCaseLink rows for traversing the manual-↔-imported case linkage graph. Provide exactly one of caseId (bidirectional — matches both caseA.id and caseB.id), caseAId (one-way originating side), or caseBId (one-way destination side). Optional linkType narrows to SAME_TEST_DIFFERENT_SOURCE or DEPENDS_ON. In caseId mode each row carries an inline `otherCase` (the side opposite the queried id); in caseAId/caseBId mode each row carries both caseA and caseB. Project scope is enforced via the underlying access policy on caseA.project — the link row itself is not project-scoped.",
      inputSchema: {
        caseId: z.number().int().positive().optional(),
        caseAId: z.number().int().positive().optional(),
        caseBId: z.number().int().positive().optional(),
        linkType: z
          .enum(["SAME_TEST_DIFFERENT_SOURCE", "DEPENDS_ON"])
          .optional(),
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(MAX_LIMIT).optional(),
      },
    },
    async (input) => {
      try {
        const provided = [input.caseId, input.caseAId, input.caseBId].filter(
          (v) => v !== undefined,
        );
        if (provided.length !== 1) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: "Provide exactly one of caseId, caseAId, or caseBId.",
              },
            ],
          };
        }

        const limit = input.limit ?? DEFAULT_LIMIT;
        const where: Prisma.RepositoryCaseLinkWhereInput = {
          isDeleted: false,
        };
        if (input.linkType !== undefined) where.type = input.linkType;
        if (input.caseId !== undefined) {
          where.OR = [
            { caseAId: input.caseId },
            { caseBId: input.caseId },
          ];
        } else if (input.caseAId !== undefined) {
          where.caseAId = input.caseAId;
        } else if (input.caseBId !== undefined) {
          where.caseBId = input.caseBId;
        }

        const body: Record<string, unknown> = {
          where,
          include: LINK_INCLUDE,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        };
        if (input.cursor !== undefined) {
          body.cursor = { id: input.cursor };
          body.skip = 1;
        }

        const rows =
          (await zenstack<RawLinkRow[]>(
            "repositoryCaseLink",
            "findMany",
            body,
            deps.env,
          )) ?? [];
        const hasNextPage = rows.length > limit;
        const trimmed = rows.slice(0, limit);
        const items =
          input.caseId !== undefined
            ? trimmed.map((row) => mapLinkRowOtherCase(row, input.caseId!))
            : trimmed.map(mapLinkRowDirectional);
        const nextCursor =
          hasNextPage && items.length > 0
            ? (items[items.length - 1].id as number)
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

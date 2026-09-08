import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReviewRequestWhereInput } from "@db/input";
import * as z from "zod/v4";
import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import {
  REVIEW_ROW_INCLUDE,
  entityKey,
  fetchRequestNotes,
  fetchReviewFeatureEnabled,
  hydrateEntities,
  mapReviewRow,
  resolveViewerScope,
  type RawReviewRow,
} from "./shared.js";

export interface ReviewsListDeps {
  env: EnvConfig;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const DECIDED_STATUSES = [
  "APPROVED",
  "CHANGES_REQUESTED",
  "REJECTED",
] as const;

/**
 * `testplanit_reviews_list` — the token owner's Review inbox.
 *
 * Scope is always the caller: there is no `userId` input, and none should
 * be added. The tool answers "what review work is assigned to me", so the
 * viewer is resolved from the token via `whoami` and the two assignment
 * branches the schema allows (direct user, or a role the caller holds) are
 * both covered.
 *
 * Call sequence per page (at most 8 round trips, all batched — never
 * per-row):
 *   1. GET /api/config/review-feature — system kill switch; short-circuits
 *      to an empty page when off, matching the inbox.
 *   2. GET /api/auth/whoami — the caller's user id.
 *   3. user.findUnique — the role ids the caller can be reached through.
 *   4. reviewRequest.findMany — the page itself.
 *   5-7. repositoryCases / testRuns / sessions findMany — one call per
 *      entity type present on the page, for entity names.
 *   8. comment.findMany — the requesters' submit-time prose.
 */
export function registerReviewsList(
  server: McpServer,
  deps: ReviewsListDeps,
): void {
  server.registerTool(
    "testplanit_reviews_list",
    {
      description:
        "List the review requests assigned to the authenticated user — the same queue as the Review inbox in the app. This is work assigned TO the caller, so there is no user filter: rows are scoped to the token owner, covering both direct assignment and assignment to a role the caller holds. `view` selects the tab: 'pending' (default) = PENDING requests awaiting the caller's decision, oldest first; 'decided' = requests the caller has already approved / requested changes on / rejected, most recently decided first. Filters: projectId, entityType (CASE | RUN | SESSION). Each row carries the polymorphic subject resolved to entityName (plus entityDeleted — a request can outlive its subject), the workflow transition being requested as transition:{from,to}, the requester, assignedTo:{via:'USER'|'ROLE',...}, requestNote (the requester's submit-time prose, plain text), and — on the decided view — decision:{status,comment,decidedBy,decidedAt}. Use entityType+entityId with testplanit_cases_get / testplanit_test_runs_get / testplanit_sessions_get to inspect what is being reviewed. Requests from projects with the review workflow turned off are excluded, and `reviewFeatureEnabled:false` distinguishes 'the feature is off system-wide' from 'nothing is assigned to you'. Cursor pagination via the `cursor` returned in `nextCursor`. Pass a row's `id` to testplanit_reviews_decide to record a decision.",
      inputSchema: {
        view: z.enum(["pending", "decided"]).optional(),
        projectId: z.number().int().positive().optional(),
        entityType: z.enum(["CASE", "RUN", "SESSION"]).optional(),
        cursor: z.string().min(1).optional(),
        limit: z.number().int().positive().max(MAX_LIMIT).optional(),
      },
    },
    async (input) => {
      try {
        const limit = input.limit ?? DEFAULT_LIMIT;
        const view = input.view ?? "pending";

        // Call 1 — system kill switch. Off means every surviving PENDING
        // row is stale, so the queue is empty by definition.
        const reviewFeatureEnabled = await fetchReviewFeatureEnabled(deps.env);
        if (!reviewFeatureEnabled) {
          const empty = {
            items: [],
            hasNextPage: false,
            nextCursor: null,
            view,
            reviewFeatureEnabled: false,
          };
          return {
            content: [{ type: "text" as const, text: JSON.stringify(empty) }],
            structuredContent: empty as unknown as Record<string, unknown>,
          };
        }

        // Calls 2-3 — who the caller is and which roles reach them.
        const { userId, roleIds } = await resolveViewerScope(deps.env);

        // The two scopes are mutually exclusive by construction, so the
        // pending queue and the decided history never double-count a row.
        const conditions: ReviewRequestWhereInput[] =
          view === "pending"
            ? [
                { status: "PENDING" },
                { isDeleted: false },
                { project: { reviewWorkflowEnabled: true } },
                {
                  OR: [
                    { assigneeUserId: userId },
                    // Omitted entirely when the caller holds no roles —
                    // `{ in: [] }` would be dead weight in the query plan.
                    ...(roleIds.length > 0
                      ? [{ assigneeRoleId: { in: roleIds } }]
                      : []),
                  ],
                },
              ]
            : [
                { decidedByUserId: userId },
                { status: { in: [...DECIDED_STATUSES] } },
                { isDeleted: false },
                { project: { reviewWorkflowEnabled: true } },
              ];
        if (input.projectId !== undefined) {
          conditions.push({ projectId: input.projectId });
        }
        if (input.entityType !== undefined) {
          conditions.push({ entityType: input.entityType });
        }

        // Pending sorts oldest-first (most overdue at the top, matching the
        // inbox default); decided sorts most-recently-decided first. `id`
        // breaks ties so cursor pagination stays deterministic.
        const orderBy =
          view === "pending"
            ? [{ createdAt: "asc" }, { id: "asc" }]
            : [{ decidedAt: "desc" }, { id: "desc" }];

        const body: Record<string, unknown> = {
          where: { AND: conditions } satisfies ReviewRequestWhereInput,
          include: REVIEW_ROW_INCLUDE,
          orderBy,
          take: limit + 1,
        };
        if (input.cursor !== undefined) {
          body.cursor = { id: input.cursor };
          body.skip = 1;
        }

        // Call 4 — the page.
        const rows =
          (await zenstack<RawReviewRow[]>(
            "reviewRequest",
            "findMany",
            body,
            deps.env,
          )) ?? [];
        const hasNextPage = rows.length > limit;
        const trimmed = rows.slice(0, limit);

        // Calls 5-8 — batched hydration for the page.
        const entities = await hydrateEntities(trimmed, deps.env);
        const notes = await fetchRequestNotes(
          trimmed.map((r) => r.id),
          deps.env,
        );

        const items = trimmed.map((raw) =>
          mapReviewRow(raw, {
            entity: entities.get(entityKey(raw.entityType, raw.entityId)),
            requestNote: notes.get(raw.id) ?? null,
          }),
        );

        const nextCursor =
          hasNextPage && items.length > 0
            ? (items[items.length - 1] as { id: string }).id
            : null;

        const result = {
          items,
          hasNextPage,
          nextCursor,
          view,
          reviewFeatureEnabled: true,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}

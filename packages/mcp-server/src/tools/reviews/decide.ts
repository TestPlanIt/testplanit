import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { EnvConfig } from "../../env.js";
import { mapHttpErrorToToolResult } from "../../errors.js";
import { TestPlanItHttpError } from "../../http.js";
import {
  DECIDE_ERROR_MESSAGES,
  decideReview,
  type DecideInput,
} from "./shared.js";

export interface ReviewsDecideDeps {
  env: EnvConfig;
}

/**
 * `testplanit_reviews_decide` — record the caller's decision on a review
 * request assigned to them.
 *
 * The tool is a thin client of `POST /api/reviews/{id}/decide`; every rule
 * lives server-side and applies identically to an agent and to a human in
 * the app:
 *
 *   - Eligibility: assignee (direct or via an assigned role) AND
 *     `canApprove` on the entity's area — or system ADMIN.
 *   - Append-only: the PENDING-guarded atomic flip means a decision cannot
 *     be changed, retracted, or raced.
 *   - Approval IS the transition: an APPROVED decision moves the entity to
 *     the requested state, so this is not a bookkeeping call.
 *   - A `mode:read` token is refused at the same gate as any other write.
 *
 * The description leads with the irreversibility because the agent, not
 * the server, is the party that decides whether to ask its user first.
 */
export function registerReviewsDecide(
  server: McpServer,
  deps: ReviewsDecideDeps,
): void {
  server.registerTool(
    "testplanit_reviews_decide",
    {
      description:
        "Record a review decision on behalf of the authenticated user, for a review request assigned to them (find ids with testplanit_reviews_list). IRREVERSIBLE AND VISIBLE TO OTHERS: decisions are append-only — they cannot be changed or retracted, they notify the requester, and APPROVING APPLIES THE WORKFLOW TRANSITION, moving the test case / run / session into the requested state. Confirm the decision with your user before calling; do not approve on your own initiative. `decision` is APPROVED, CHANGES_REQUESTED, or REJECTED. `comment` is required for CHANGES_REQUESTED and REJECTED (the reviewer must say what is wrong) and optional for APPROVED; it is posted as a comment on the entity's thread, addressed to the requester. Fails with INELIGIBLE_REVIEWER if the caller is not the assignee (directly or through an assigned role) with approve permission for the entity's area, and with ALREADY_DECIDED if someone else got there first. Read-only (`mode:read`) tokens are refused.",
      inputSchema: {
        reviewRequestId: z.string().trim().min(1),
        decision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED"]),
        comment: z.string().optional(),
      },
    },
    async (input) => {
      try {
        // Checked here as well as server-side so the agent gets the reason
        // back without spending a round trip on a request that cannot
        // succeed.
        if (
          input.decision !== "APPROVED" &&
          (input.comment?.trim().length ?? 0) === 0
        ) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `A comment is required for a ${input.decision} decision — explain what needs to change or why the request is rejected.`,
              },
            ],
          };
        }

        const decided = await decideReview(input as DecideInput, deps.env);

        const result = {
          id: decided.id,
          status: decided.status,
          entityType: decided.entityType,
          entityId: decided.entityId,
          projectId: decided.projectId,
          decisionComment: decided.decisionComment,
          decidedAt:
            decided.decidedAt instanceof Date
              ? decided.decidedAt.toISOString()
              : decided.decidedAt,
          decidedByUserId: decided.decidedByUserId,
          // An approval moves the entity; anything else leaves it where it
          // was. Stated explicitly so the agent can report what happened
          // without inferring it from the status.
          transitionApplied: decided.status === "APPROVED",
          appliedStateId:
            decided.status === "APPROVED" ? decided.toStateId : null,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (err) {
        if (err instanceof TestPlanItHttpError) {
          if (err.code) {
            const friendly = DECIDE_ERROR_MESSAGES[err.code];
            if (friendly) {
              return {
                isError: true as const,
                content: [
                  { type: "text" as const, text: `${friendly} (${err.code})` },
                ],
              };
            }
          } else if (err.statusCode === 401) {
            // Every token-rejection path on this route answers with an
            // errorCode. A bare 401 means the host is old enough that the
            // route still accepts session cookies only, so no token can
            // ever satisfy it — say so instead of sending the agent off to
            // check its token.
            return {
              isError: true as const,
              content: [
                {
                  type: "text" as const,
                  text: "This TestPlanIt instance does not accept API-token review decisions — it predates that server change. Reading the inbox with testplanit_reviews_list still works; upgrade the instance to decide from an agent, or decide in the app.",
                },
              ],
            };
          }
        }
        return mapHttpErrorToToolResult(err);
      }
    },
  );
}

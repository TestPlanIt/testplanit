import type { ReviewRequest } from "@prisma/client";
import type { Session } from "next-auth";

import { prisma } from "~/lib/prisma";
import { IneligibleReviewerError } from "~/lib/utils/errors";

/**
 * Decision outcomes the requester or reviewer can take on a PENDING
 * ReviewRequest. Cancel is handled separately via the ZenStack auto-API
 * status-mutation path; the three values here all flow through
 * `decideReviewRequest` because they require the effective-role
 * eligibility check to fire BEFORE the row mutation.
 */
export type DecideOutcome = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

/**
 * Server-side decide path for a PENDING ReviewRequest.
 *
 * Contract:
 *
 *   1. Load the ReviewRequest with its project and the calling user's
 *      UserProjectPermission row. Missing rows surface as a Prisma
 *      `P2025` (callers translate to a 404).
 *
 *   2. Refuse to mutate an already-decided row. The append-only
 *      `@@deny('update', status != 'PENDING')` schema rule would catch
 *      this too, but the explicit pre-check keeps the call shape
 *      symmetric with the chokepoint helpers and produces a clean
 *      "already decided" error for the API route to translate to 409.
 *
 *   3. Effective-role eligibility check — defense-in-depth alongside the
 *      schema `@@allow('update', ...)` rule. A caller qualifies when any
 *      of the following holds:
 *
 *        (a) Direct user-assignee: `req.assigneeUserId === session.user.id`.
 *
 *        (b) Role-holder via SPECIFIC_ROLE permission on this project,
 *            where the assigned role matches the holder's permission
 *            role: `userPermission.accessType === 'SPECIFIC_ROLE' &&
 *            userPermission.roleId === req.assigneeRoleId`.
 *
 *        (c) Role-holder via GLOBAL_ROLE permission on this project,
 *            where the caller's global role matches the assigned role:
 *            `userPermission.accessType === 'GLOBAL_ROLE' &&
 *            session.user.roleId === req.assigneeRoleId`.
 *
 *        (d) System ADMIN override: `session.user.access === 'ADMIN'`.
 *
 *      The role-based branches close Phase 1 CR-02 at the app layer —
 *      even if the schema @@allow predicate behaves unexpectedly under a
 *      future ZenStack release, this check authoritatively gates the
 *      mutation.
 *
 *   4. On qualification, mutate via raw `prisma` (NOT the enhanced
 *      client). Raw is required because the schema-layer
 *      `@@deny('update', status != 'PENDING')` rule denies any update
 *      where the post-state differs from PENDING — flipping status to
 *      APPROVED / CHANGES_REQUESTED / REJECTED is exactly that change.
 *      This is the documented exception to the
 *      `feedback_default_to_enhanced_db` memory rule, mirroring the
 *      `reviewGate.ts` raw-client carve-out for the `consumedAt` stamp.
 *
 *   5. Return the updated ReviewRequest row. Phase 3 wraps the success
 *      path with audit emission + outbound webhook dispatch; Phase 2
 *      callers see only the new row shape.
 *
 * @throws  `IneligibleReviewerError` when none of the eligibility
 *          branches matched. Thrown BEFORE any mutation.
 * @throws  `Error('Review request already decided')` when the loaded
 *          row's status is not PENDING.
 * @throws  Prisma `P2025` (NotFoundError) when no row matches the id.
 */
export async function decideReviewRequest(
  session: Session,
  reviewRequestId: string,
  decision: DecideOutcome,
  comment?: string,
): Promise<ReviewRequest> {
  const userId = session.user.id;

  // Load the request + project + caller's UserProjectPermission row. The
  // permission is needed to evaluate the SPECIFIC_ROLE / GLOBAL_ROLE
  // branches without making a second query.
  const req = await prisma.reviewRequest.findUniqueOrThrow({
    where: { id: reviewRequestId },
    include: {
      project: {
        select: {
          id: true,
          userPermissions: {
            where: { userId },
            select: { accessType: true, roleId: true },
          },
        },
      },
    },
  });

  if (req.status !== "PENDING") {
    throw new Error("Review request already decided");
  }

  const isDirectAssignee =
    req.assigneeUserId !== null && req.assigneeUserId === userId;

  const userPermission = req.project.userPermissions[0];

  // Pull the caller's global roleId from the User row. Only needed for the
  // GLOBAL_ROLE branch; small extra read is cheaper than always preloading
  // it through getEnhancedDb-style plumbing for this single service.
  let callerGlobalRoleId: number | null = null;
  if (
    req.assigneeRoleId !== null &&
    userPermission?.accessType === "GLOBAL_ROLE"
  ) {
    const callerUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { roleId: true },
    });
    callerGlobalRoleId = callerUser?.roleId ?? null;
  }

  const isRoleHolderViaSpecific =
    req.assigneeRoleId !== null &&
    userPermission?.accessType === "SPECIFIC_ROLE" &&
    userPermission.roleId === req.assigneeRoleId;

  const isRoleHolderViaGlobal =
    req.assigneeRoleId !== null &&
    userPermission?.accessType === "GLOBAL_ROLE" &&
    callerGlobalRoleId === req.assigneeRoleId;

  const isAdmin = session.user.access === "ADMIN";

  const eligible =
    isDirectAssignee ||
    isRoleHolderViaSpecific ||
    isRoleHolderViaGlobal ||
    isAdmin;

  if (!eligible) {
    throw new IneligibleReviewerError(userId, reviewRequestId);
  }

  // Raw prisma (documented exception): the append-only @@deny rule denies
  // any update that flips status away from PENDING; raw bypasses ZenStack
  // policy enforcement, which is appropriate here because the eligibility
  // gate above is the authoritative check for this transition.
  return prisma.reviewRequest.update({
    where: { id: reviewRequestId },
    data: {
      status: decision,
      decisionComment: comment ?? null,
      decidedByUserId: userId,
      decidedAt: new Date(),
    },
  });
}

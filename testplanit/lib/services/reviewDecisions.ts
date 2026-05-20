import { Prisma, type ReviewRequest } from "@prisma/client";
import type { JSONContent } from "@tiptap/core";
import type { Session } from "next-auth";

import { prisma } from "~/lib/prisma";
import { CommentService } from "~/lib/services/commentService";
import { IneligibleReviewerError } from "~/lib/utils/errors";
import { extractMentionedUserIds } from "~/lib/utils/tiptapMentions";

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
 *   4. On qualification, mutate atomically via raw `prisma.updateMany`
 *      scoped to `status: 'PENDING'`. The combined WHERE + UPDATE is a
 *      single statement at the database, so two concurrent decide calls
 *      cannot both pass the load-time PENDING check and both commit —
 *      the loser gets `count === 0` and we throw "already decided".
 *      Raw prisma is still required here because the schema-layer
 *      `@@deny('update', status != 'PENDING')` rule denies any update
 *      where the post-state differs from PENDING; raw bypasses ZenStack
 *      policy enforcement, which is appropriate because the eligibility
 *      gate above plus the WHERE-scoped update are the authoritative
 *      checks. This is the documented exception to the
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
  comment?: string
): Promise<ReviewRequest> {
  const userId = session.user.id;

  // Load the request + project + caller's UserProjectPermission row. The
  // permission is needed to evaluate the SPECIFIC_ROLE / GLOBAL_ROLE
  // branches without making a second query. `project.name` and
  // `requester.name` are pulled here so the paired-Comment fan-out below
  // doesn't need a second round-trip.
  const req = await prisma.reviewRequest.findUniqueOrThrow({
    where: { id: reviewRequestId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          userPermissions: {
            where: { userId },
            select: { accessType: true, roleId: true },
          },
        },
      },
      requestedBy: { select: { id: true, name: true } },
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

  // Build the TipTap doc for the paired Comment. The decision-type comment
  // always mentions the original requester so the existing `@mention`
  // notification path delivers a "your review was decided" notification
  // back to them. If the reviewer supplied prose it follows the mention
  // node on the same paragraph.
  const requesterName = req.requestedBy.name ?? "user";
  const trimmedComment = (comment ?? "").trim();
  const paragraphChildren: JSONContent[] = [
    {
      type: "mention",
      attrs: { id: req.requestedBy.id, label: requesterName },
    },
    { type: "text", text: " " },
  ];
  if (trimmedComment.length > 0) {
    paragraphChildren.push({ type: "text", text: trimmedComment });
  }
  const decisionCommentContent: JSONContent = {
    type: "doc",
    content: [{ type: "paragraph", content: paragraphChildren }],
  };

  const entityFkField: "repositoryCaseId" | "testRunId" | "sessionId" =
    req.entityType === "CASE"
      ? "repositoryCaseId"
      : req.entityType === "RUN"
        ? "testRunId"
        : "sessionId";

  // Combined status flip + paired Comment create in a single transaction
  // so a decision never commits without its conversation-thread record
  // (hybrid-comments D-21 follow-up). Raw prisma is still used inside the
  // tx for the same documented-exception reason as before — the schema
  // `@@deny('update', status != 'PENDING')` rule would block the
  // PENDING→APPROVED/etc. flip via ZenStack policy, but the eligibility
  // gate above plus the WHERE-scoped status check below are the
  // authoritative atomic-update checks.
  //
  // CR-01 invariant preserved: `updateMany({ where: { id, status: 'PENDING' }})`
  // remains a single atomic statement at the DB. Two concurrent decides
  // racing on the same PENDING row cannot both pass — the loser returns
  // `count === 0` and surfaces as "already decided" before the Comment
  // ever lands.
  const { commentId } = await prisma.$transaction(async (tx) => {
    const result = await tx.reviewRequest.updateMany({
      where: { id: reviewRequestId, status: "PENDING" },
      data: {
        status: decision,
        decisionComment: comment ?? null,
        decidedByUserId: userId,
        decidedAt: new Date(),
      },
    });

    if (result.count === 0) {
      // Either the row no longer exists, or another concurrent decide won
      // the race. Re-fetch to distinguish: a missing row surfaces as P2025
      // (callers translate to 404), an extant non-PENDING row surfaces as
      // "already decided" (callers translate to 409).
      const after = await tx.reviewRequest.findUnique({
        where: { id: reviewRequestId },
        select: { id: true },
      });
      if (!after) {
        throw new Prisma.PrismaClientKnownRequestError(
          "No ReviewRequest found",
          { code: "P2025", clientVersion: Prisma.prismaVersion.client }
        );
      }
      throw new Error("Review request already decided");
    }

    const created = await tx.comment.create({
      data: {
        projectId: req.project.id,
        type: "REVIEW_DECISION",
        reviewRequestId,
        content: decisionCommentContent as any,
        creatorId: userId,
        [entityFkField]: req.entityId,
      },
      select: { id: true },
    });

    return { commentId: created.id };
  });

  // Fan out mention notification(s) to the requester outside the tx —
  // mirrors the requestReview action's contract: notification failures do
  // NOT roll back the decision. The user can still see the decision in
  // the UI even if the bell-icon notification never lands.
  try {
    const mentionedUserIds = extractMentionedUserIds(decisionCommentContent);
    if (mentionedUserIds.length > 0) {
      await CommentService.createCommentMentions(commentId, mentionedUserIds);
      const projectAndEntity = await loadProjectAndEntity(
        req.project.id,
        req.project.name,
        req.entityType,
        req.entityId
      );
      if (projectAndEntity) {
        await CommentService.processMentions(
          commentId,
          decisionCommentContent,
          userId,
          session.user.name ?? "Unknown User",
          projectAndEntity.project.id,
          projectAndEntity.project.name,
          projectAndEntity.entityType,
          projectAndEntity.entityName,
          projectAndEntity.entityId
        );
      }
    }
  } catch (mentionErr) {
    console.error(
      "decideReviewRequest: paired-comment mention processing failed",
      mentionErr
    );
  }

  return prisma.reviewRequest.findUniqueOrThrow({
    where: { id: reviewRequestId },
  });
}

async function loadProjectAndEntity(
  projectId: number,
  projectName: string,
  entityType: "CASE" | "RUN" | "SESSION",
  entityId: number
): Promise<{
  project: { id: number; name: string };
  entityType: "RepositoryCase" | "TestRun" | "Session";
  entityName: string;
  entityId: string;
} | null> {
  if (entityType === "CASE") {
    const row = await prisma.repositoryCases.findUnique({
      where: { id: entityId },
      select: { id: true, name: true },
    });
    return row
      ? {
          project: { id: projectId, name: projectName },
          entityType: "RepositoryCase",
          entityName: row.name,
          entityId: String(row.id),
        }
      : null;
  }
  if (entityType === "RUN") {
    const row = await prisma.testRuns.findUnique({
      where: { id: entityId },
      select: { id: true, name: true },
    });
    return row
      ? {
          project: { id: projectId, name: projectName },
          entityType: "TestRun",
          entityName: row.name,
          entityId: String(row.id),
        }
      : null;
  }
  const row = await prisma.sessions.findUnique({
    where: { id: entityId },
    select: { id: true, name: true },
  });
  return row
    ? {
        project: { id: projectId, name: projectName },
        entityType: "Session",
        entityName: row.name,
        entityId: String(row.id),
      }
    : null;
}

import type { AuditAction, ReviewRequest } from "~/zenstack/models";
import { ORMError, ORMErrorReason } from "@zenstackhq/orm";
import type { JSONContent } from "@tiptap/core";
import type { Session } from "next-auth";

import { prisma } from "~/lib/prisma";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { CommentService } from "~/lib/services/commentService";
import { resolveEffectiveProjectRoleId } from "~/lib/services/effectiveRole";
import { NotificationService } from "~/lib/services/notificationService";
import { isReviewFeatureSystemEnabled } from "~/lib/services/reviewFeatureFlag";
import {
  FeatureDisabledError,
  IneligibleReviewerError,
} from "~/lib/utils/errors";
import { areaForEntityType } from "~/lib/utils/reviewAreas";
import { extractMentionedUserIds } from "~/lib/utils/tiptapMentions";
import { emitReviewCompletedEvent } from "~/lib/webhooks/event-emitters/reviewEvents";

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
 *        (b) Role-holder via SPECIFIC_ROLE UserProjectPermission on this
 *            project where the assigned role matches the holder's
 *            permission role.
 *
 *        (c) Role-holder via GLOBAL_ROLE UserProjectPermission on this
 *            project where the caller's global role matches the assigned
 *            role.
 *
 *        (d) Role-holder via SPECIFIC_ROLE GroupProjectPermission — the
 *            caller is a member of a group that has the assigned role
 *            on this project. Treated identically to (b); this is the
 *            common provisioning shape under SAML/SCIM where roles are
 *            attached to groups, not users directly.
 *
 *        (e) Role-holder via GLOBAL_ROLE GroupProjectPermission — the
 *            caller is a member of a group with GLOBAL_ROLE access on
 *            this project AND the caller's global role matches the
 *            assigned role. Mirrors (c) for the group-provisioned case.
 *
 *        (f) System ADMIN override: `session.user.access === 'ADMIN'`.
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

  // Feature-flag guard. System flag is checked first because it costs the
  // same round-trip whether the request exists or not; project flag is
  // checked alongside the main load below to keep the request-lookup
  // single-statement.
  const systemEnabled = await isReviewFeatureSystemEnabled(prisma);
  if (!systemEnabled) {
    throw new FeatureDisabledError();
  }

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
          reviewWorkflowEnabled: true,
          userPermissions: {
            where: { userId },
            select: { accessType: true, roleId: true },
          },
          // Group-based project access (indirect role assignment via group
          // membership — the common pattern when SAML/SCIM provisions role
          // membership at the group level rather than per-user). Scoped to
          // groups the caller actually belongs to so the load is bounded.
          groupPermissions: {
            where: { group: { assignedUsers: { some: { userId } } } },
            select: { accessType: true, roleId: true },
          },
        },
      },
      requestedBy: { select: { id: true, name: true } },
      fromState: { select: { name: true } },
      toState: {
        select: { name: true, color: { select: { value: true } } },
      },
    },
  });

  if (req.project.reviewWorkflowEnabled !== true) {
    throw new FeatureDisabledError();
  }

  if (req.status !== "PENDING") {
    throw new Error("Review request already decided");
  }

  const isDirectAssignee =
    req.assigneeUserId !== null && req.assigneeUserId === userId;

  const userPermission = req.project.userPermissions[0];
  const groupPermissions = req.project.groupPermissions;

  // Pull the caller's global roleId from the User row. Needed for any
  // GLOBAL_ROLE branch (direct or via group). Small extra read is cheaper
  // than always preloading it through getEnhancedDb-style plumbing for
  // this single service.
  const hasAnyGlobalRolePermission =
    userPermission?.accessType === "GLOBAL_ROLE" ||
    groupPermissions.some((g) => g.accessType === "GLOBAL_ROLE");
  let callerGlobalRoleId: number | null = null;
  if (req.assigneeRoleId !== null && hasAnyGlobalRolePermission) {
    const callerUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { roleId: true },
    });
    callerGlobalRoleId = callerUser?.roleId ?? null;
  }

  const isRoleHolderViaUserSpecific =
    req.assigneeRoleId !== null &&
    userPermission?.accessType === "SPECIFIC_ROLE" &&
    userPermission.roleId === req.assigneeRoleId;

  const isRoleHolderViaUserGlobal =
    req.assigneeRoleId !== null &&
    userPermission?.accessType === "GLOBAL_ROLE" &&
    callerGlobalRoleId === req.assigneeRoleId;

  // Indirect role eligibility — caller holds the role via group membership.
  // SCIM/SAML deployments often provision roles at the group level, so a
  // user with no direct UserProjectPermission row still legitimately holds
  // the assigned role and must be able to decide.
  const isRoleHolderViaGroupSpecific =
    req.assigneeRoleId !== null &&
    groupPermissions.some(
      (g) => g.accessType === "SPECIFIC_ROLE" && g.roleId === req.assigneeRoleId
    );

  const isRoleHolderViaGroupGlobal =
    req.assigneeRoleId !== null &&
    callerGlobalRoleId === req.assigneeRoleId &&
    groupPermissions.some((g) => g.accessType === "GLOBAL_ROLE");

  const isAdmin = session.user.access === "ADMIN";

  // canApprove gate — every non-admin eligibility branch is AND-joined with
  // the caller's canApprove permission on the entity's area. The system
  // ADMIN override stays unconditional (admins can decide regardless of
  // their project role's permission grid). The check is short-circuited
  // for the admin path so we never spend a round-trip resolving the
  // effective role for them.
  let callerCanApprove = false;
  if (!isAdmin) {
    const area = areaForEntityType(
      req.entityType as "CASE" | "RUN" | "SESSION"
    );
    const callerEffectiveRoleId = await resolveEffectiveProjectRoleId(
      userId,
      req.projectId,
      prisma
    );
    if (callerEffectiveRoleId !== null) {
      const perm = await prisma.rolePermission.findUnique({
        where: { roleId_area: { roleId: callerEffectiveRoleId, area } },
        select: { canApprove: true },
      });
      callerCanApprove = perm?.canApprove === true;
    }
  }

  const eligible =
    isAdmin ||
    (callerCanApprove &&
      (isDirectAssignee ||
        isRoleHolderViaUserSpecific ||
        isRoleHolderViaUserGlobal ||
        isRoleHolderViaGroupSpecific ||
        isRoleHolderViaGroupGlobal));

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
        // Was Prisma P2025; v3 uses ORMError with reason NOT_FOUND.
        // Phase 6: ensure lib/utils/errors.ts isNotFoundError() detects this.
        throw new ORMError(ORMErrorReason.NOT_FOUND, "No ReviewRequest found");
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

  // Persist mention rows (so the decision comment renders its in-thread
  // @mention highlight) and dispatch the dedicated REVIEW_APPROVED /
  // REVIEW_CHANGES_REQUESTED / REVIEW_REJECTED notification back to the
  // requester. Runs outside the tx — notification failures do NOT roll
  // back the decision. The user can still see the decision in the UI
  // even if the bell-icon notification never lands.
  try {
    const mentionedUserIds = extractMentionedUserIds(decisionCommentContent);
    if (mentionedUserIds.length > 0) {
      await CommentService.createCommentMentions(commentId, mentionedUserIds);
    }
    const entityName = await loadEntityName(req.entityType, req.entityId);
    if (entityName !== null) {
      await NotificationService.createReviewDecisionNotification({
        requesterUserId: req.requestedBy.id,
        deciderUserId: userId,
        deciderName: session.user.name ?? "Unknown User",
        decision,
        projectId: req.project.id,
        projectName: req.project.name,
        entityType: req.entityType,
        entityId: req.entityId,
        entityName,
        fromStateName: req.fromState.name,
        toStateName: req.toState.name,
        reviewRequestId,
        decisionComment: trimmedComment,
      });

      if (mentionedUserIds.length > 0) {
        const commentEntityType: "RepositoryCase" | "TestRun" | "Session" =
          req.entityType === "CASE"
            ? "RepositoryCase"
            : req.entityType === "RUN"
              ? "TestRun"
              : "Session";
        await CommentService.processMentions(
          commentId,
          decisionCommentContent,
          userId,
          session.user.name ?? "Unknown User",
          req.project.id,
          req.project.name,
          commentEntityType,
          entityName,
          String(req.entityId)
        );
      }
    }
  } catch (notifyErr) {
    console.error(
      "decideReviewRequest: decision-notification dispatch failed",
      notifyErr
    );
  }

  try {
    const entityName = await loadEntityName(req.entityType, req.entityId);
    if (entityName !== null) {
      await emitReviewCompletedEvent(
        {
          reviewRequestId,
          projectId: req.project.id,
          entityType: req.entityType,
          entityId: req.entityId,
          entityName,
          fromStateId: req.fromStateId,
          toStateId: req.toStateId,
          toStateName: req.toState.name,
          toStateColor: req.toState.color?.value ?? null,
          decision,
          decidedByUserId: userId,
          deciderName: session.user.name ?? "Unknown User",
          decisionComment: trimmedComment.length > 0 ? trimmedComment : null,
          requestedByUserId: req.requestedBy.id,
          requesterName: req.requestedBy.name ?? "Unknown User",
        },
        { actorUserId: userId }
      );
    }
  } catch (webhookErr) {
    console.error(
      "decideReviewRequest: review-completed webhook emit failed",
      webhookErr
    );
  }

  try {
    const auditAction: AuditAction =
      decision === "APPROVED"
        ? "REVIEW_APPROVED"
        : decision === "CHANGES_REQUESTED"
          ? "REVIEW_CHANGES_REQUESTED"
          : "REVIEW_REJECTED";
    await captureAuditEvent({
      action: auditAction,
      entityType: "ReviewRequest",
      entityId: reviewRequestId,
      projectId: req.project.id,
      metadata: {
        decision,
        fromStateId: req.fromStateId,
        toStateId: req.toStateId,
        decidedByUserId: userId,
        requestedByUserId: req.requestedBy.id,
        entityType: req.entityType,
        entityId: req.entityId,
        decisionComment: trimmedComment.slice(0, 4096),
      },
    });
  } catch (auditErr) {
    console.error("decideReviewRequest: audit emission failed", auditErr);
  }

  return prisma.reviewRequest.findUniqueOrThrow({
    where: { id: reviewRequestId },
  });
}

async function loadEntityName(
  entityType: "CASE" | "RUN" | "SESSION",
  entityId: number
): Promise<string | null> {
  if (entityType === "CASE") {
    const row = await prisma.repositoryCases.findUnique({
      where: { id: entityId },
      select: { name: true },
    });
    return row?.name ?? null;
  }
  if (entityType === "RUN") {
    const row = await prisma.testRuns.findUnique({
      where: { id: entityId },
      select: { name: true },
    });
    return row?.name ?? null;
  }
  const row = await prisma.sessions.findUnique({
    where: { id: entityId },
    select: { name: true },
  });
  return row?.name ?? null;
}

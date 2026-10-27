import type { AuditAction, ReviewRequest } from "~/zenstack/models";
import type { TxClient } from "~/lib/zenstack";
import { ORMError, ORMErrorReason } from "@zenstackhq/orm";
import type { JSONContent } from "@tiptap/core";
import type { Session } from "next-auth";

import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { baseDb } from "~/lib/db";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { CommentService } from "~/lib/services/commentService";
import { NotificationService } from "~/lib/services/notificationService";
import { isReviewFeatureSystemEnabled } from "~/lib/services/reviewFeatureFlag";
import {
  isWithinRevertWindow,
  readRevertDecisionDurationSeconds,
  resolveRevertWindowSeconds,
} from "~/lib/services/reviewRevertWindow";
import {
  FeatureDisabledError,
  IneligibleReverterError,
  isAlreadyPendingError,
  ReviewEntityMovedError,
  ReviewSupersededError,
  RevertWindowExpiredError,
} from "~/lib/utils/errors";
import { extractMentionedUserIds } from "~/lib/utils/tiptapMentions";
import { emitReviewRevertedEvent } from "~/lib/webhooks/event-emitters/reviewEvents";

/**
 * Decisions this service can undo — every outcome a reviewer can record.
 *
 * The three are not equal in cost. `CHANGES_REQUESTED` / `REJECTED` touch no
 * entity, so undoing them is a bare status flip. `APPROVED` is different:
 * approval IS the transition, so `applyApprovedReviewTransition` has usually
 * already moved the entity and stamped `consumedAt`, and undoing it has to
 * roll the entity back too. See {@link revertReviewDecision} step 6.
 */
export type RevertableDecision = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

const REVERTABLE_DECISIONS: readonly string[] = [
  "APPROVED",
  "CHANGES_REQUESTED",
  "REJECTED",
];

/**
 * Undo a review decision, returning the request to PENDING so the same
 * reviewer can decide it again.
 *
 * Contract:
 *
 *   1. Feature flags first — system kill switch, then the project's
 *      `reviewWorkflowEnabled`, matching `decideReviewRequest`.
 *
 *   2. Only a decided row is revertable. A PENDING row was never decided and
 *      a CANCELLED one was withdrawn rather than judged.
 *
 *   3. Eligibility: the user who recorded the decision, or a system admin.
 *      NOT the requester — a requester who could reopen their own rejection
 *      has effectively defeated the review gate.
 *
 *   4. Window: bounded from `decidedAt` by the resolved revert window
 *      (AppConfig ceiling + project override, defaulting to 24h). **System
 *      admins bypass the window**, inheriting the
 *      `assertResultEditWindowOpen` precedent — they can revert a decision
 *      of any age. Everyone else is bound. Admins remain subject to every
 *      other guard here, because those protect consistency, not freshness.
 *
 *   5. Supersession: refused when a newer PENDING request exists for the
 *      same entity. The partial unique index
 *      `review_request_one_pending_per_entity` (installed by
 *      db/setup-extensions.ts) enforces one PENDING row per entity, so this
 *      pre-check reports the collision cleanly instead of letting the index
 *      reject the write.
 *
 *   6. APPROVED only — undoing the transition the approval performed:
 *
 *        (a) `consumedAt == null`: the approval was never spent (an earlier
 *            gate still blocked the path, or the entity already sat at the
 *            target), so the entity never moved and there is nothing to roll
 *            back.
 *
 *        (b) `consumedAt != null` and the entity still sits exactly at
 *            `toStateId`: the entity is moved back to `fromStateId`.
 *            Backward transitions are ungated — see `assertReviewGatePasses`
 *            step (3) — so this needs no approval of its own.
 *
 *        (c) `consumedAt != null` and the entity has moved elsewhere since:
 *            refused with `ReviewEntityMovedError`. Forcing it back would
 *            regress whatever someone else did after the approval.
 *
 *      In case (b) every approval spent on the SAME crossing is un-consumed,
 *      not just this one. A crossing under strict-transitive semantics can
 *      spend several approvals at once, and `applyApprovedReviewTransition`
 *      stamps them all in a single `updateMany`, so they share one exact
 *      `consumedAt` instant — which is the grouping key used here. Without
 *      this, reverting a multi-gate crossing would silently burn the other
 *      gates' approvals and force the requester to raise them again.
 *
 *      One side effect is deliberately NOT undone: a run that auto-locked its
 *      composition on entering an IN_PROGRESS state keeps that lock, because
 *      the lock is independently reversible in-app and may since have been
 *      set or kept on purpose.
 *
 *   6. The flip and its paired Comment land in one transaction, via raw
 *      `baseDb` for the same documented reason `decideReviewRequest` uses it:
 *      the schema's append-only `@@deny('update', status != 'PENDING')` rule
 *      would block any post-decision write, and the guards above plus the
 *      WHERE-scoped update are the authoritative checks. The `updateMany`
 *      scoped to the prior status is a single statement at the database, so
 *      two concurrent reverts cannot both commit — the loser sees
 *      `count === 0`.
 *
 *   7. Notification, webhook and audit fan out afterwards, best-effort. A
 *      failed side channel must never roll back the revert.
 *
 * @throws `FeatureDisabledError`    — system or project review flag is off.
 * @throws `IneligibleReverterError` — caller is not the decider or an admin.
 * @throws `RevertWindowExpiredError`— window elapsed, or reverting disabled.
 * @throws `ReviewSupersededError`   — a newer PENDING request exists.
 * @throws `Error('Review decision is not revertable')` — wrong status.
 * @throws `ORMError(NOT_FOUND)`     — no row matches the id.
 */
export async function revertReviewDecision(
  session: Session,
  reviewRequestId: string
): Promise<ReviewRequest> {
  const userId = session.user.id;

  const systemEnabled = await isReviewFeatureSystemEnabled(baseDb);
  if (!systemEnabled) {
    throw new FeatureDisabledError();
  }

  const req = await baseDb.reviewRequest.findUniqueOrThrow({
    where: { id: reviewRequestId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          reviewWorkflowEnabled: true,
          revertDecisionDurationSeconds: true,
        },
      },
      requestedBy: { select: { id: true, name: true } },
      decidedBy: { select: { id: true, name: true } },
      fromState: { select: { name: true } },
      toState: {
        select: { name: true, color: { select: { value: true } } },
      },
    },
  });

  if (req.project.reviewWorkflowEnabled !== true) {
    throw new FeatureDisabledError();
  }

  if (!REVERTABLE_DECISIONS.includes(req.status)) {
    throw new Error("Review decision is not revertable");
  }

  const isAdmin = session.user.access === "ADMIN";
  const isDecider =
    req.decidedByUserId !== null && req.decidedByUserId === userId;
  if (!isAdmin && !isDecider) {
    throw new IneligibleReverterError(userId, reviewRequestId);
  }

  // `decidedAt` is always set on a decided row; the null branch is a
  // defensive guard rather than an expected state.
  if (!isAdmin) {
    if (req.decidedAt === null) {
      throw new RevertWindowExpiredError();
    }
    const systemSeconds = await readRevertDecisionDurationSeconds(baseDb);
    const windowSeconds = resolveRevertWindowSeconds(
      systemSeconds,
      req.project.revertDecisionDurationSeconds
    );
    if (windowSeconds === 0) {
      throw new RevertWindowExpiredError("Reverting decisions is disabled");
    }
    if (!isWithinRevertWindow(new Date(req.decidedAt), windowSeconds)) {
      throw new RevertWindowExpiredError();
    }
  }

  // Supersession guard — a newer PENDING request for the same entity means
  // this decision is no longer the live one.
  const superseding = await baseDb.reviewRequest.findFirst({
    where: {
      entityType: req.entityType,
      entityId: req.entityId,
      status: "PENDING",
      isDeleted: false,
      id: { not: reviewRequestId },
    },
    select: { id: true },
  });
  if (superseding) {
    throw new ReviewSupersededError(reviewRequestId, superseding.id);
  }

  const revertedDecision = req.status as RevertableDecision;
  const revertedComment = req.decisionComment;

  // Thread comment announcing the reversal. Without it the entity page would
  // still show the original decision with no trace it was undone, which is
  // actively misleading. Mentions the requester so the existing mention path
  // delivers it alongside the dedicated notification below.
  const requesterName = req.requestedBy.name ?? "user";
  const reverterName = session.user.name ?? "Unknown User";
  // An admin may revert somebody else's decision, so the sentence can't assume
  // the reverter is the decider.
  const priorDeciderId = req.decidedByUserId;
  const deciderName = req.decidedBy?.name ?? "the reviewer";
  const revertedByDecider = priorDeciderId === userId;
  const revertedLabel =
    revertedDecision === "APPROVED"
      ? "approval"
      : revertedDecision === "REJECTED"
        ? "rejection"
        : "change request";
  const revertCommentContent: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "mention",
            attrs: { id: req.requestedBy.id, label: requesterName },
          },
          {
            type: "text",
            text: revertedByDecider
              ? ` ${reverterName} reverted their ${revertedLabel} — this is awaiting review again.`
              : ` ${reverterName} reverted ${deciderName}'s ${revertedLabel} — this is awaiting review again.`,
          },
        ],
      },
    ],
  };

  const entityFkField: "repositoryCaseId" | "testRunId" | "sessionId" =
    req.entityType === "CASE"
      ? "repositoryCaseId"
      : req.entityType === "RUN"
        ? "testRunId"
        : "sessionId";

  // Computed rather than incremented in SQL: the status-scoped WHERE below
  // lets exactly one concurrent revert through, so there is no race for this
  // value to lose.
  const revertCount = req.revertCount + 1;

  // Captured before the flip below nulls it; it is the grouping key for
  // every approval the same crossing consumed.
  const priorConsumedAt = req.consumedAt;

  // The supersession SELECT above narrows the window but cannot close it: a
  // request created between that read and this write still collides with the
  // partial unique index `review_request_one_pending_per_entity` (installed
  // by db/setup-extensions.ts, since Prisma cannot express a partial unique
  // index). The database is the authority on "one PENDING per entity", so the
  // violation is translated back into the same typed error the pre-check
  // raises rather than surfacing as an opaque 500.
  const runRevert = async () =>
    auditedTransaction(async (tx) => {
      const result = await tx.reviewRequest.updateMany({
        where: { id: reviewRequestId, status: revertedDecision },
        data: {
          status: "PENDING",
          decisionComment: null,
          decidedByUserId: null,
          decidedAt: null,
          consumedAt: null,
          revertedAt: new Date(),
          revertedByUserId: userId,
          revertCount,
        },
      });

      if (result.count === 0) {
        // Either the row is gone, or a concurrent revert won the race.
        const after = await tx.reviewRequest.findUnique({
          where: { id: reviewRequestId },
          select: { id: true },
        });
        if (!after) {
          throw new ORMError(
            ORMErrorReason.NOT_FOUND,
            "No ReviewRequest found"
          );
        }
        throw new Error("Review decision is not revertable");
      }

      // APPROVED only — undo the move the approval performed. Read the
      // entity's state INSIDE the transaction so a concurrent transition
      // cannot slip between the check and the rollback. Any throw here rolls
      // the status flip back too, which is what we want: if the entity cannot
      // be returned, the decision should stand.
      if (revertedDecision === "APPROVED" && priorConsumedAt !== null) {
        const currentStateId = await loadEntityStateId(
          tx,
          req.entityType,
          req.entityId
        );
        if (currentStateId !== req.toStateId) {
          throw new ReviewEntityMovedError(
            reviewRequestId,
            req.toStateId,
            currentStateId
          );
        }

        await updateEntityStateId(
          tx,
          req.entityType,
          req.entityId,
          req.fromStateId
        );

        // Every approval the same crossing spent shares one exact `consumedAt`
        // instant, because `applyApprovedReviewTransition` stamps them in a
        // single updateMany. Releasing the whole group keeps a multi-gate
        // crossing from silently burning the other gates' approvals. This row
        // was already cleared by the flip above, hence the id exclusion.
        await tx.reviewRequest.updateMany({
          where: {
            entityType: req.entityType,
            entityId: req.entityId,
            consumedAt: priorConsumedAt,
            id: { not: reviewRequestId },
          },
          data: { consumedAt: null },
        });
      }

      const created = await tx.comment.create({
        data: {
          projectId: req.project.id,
          type: "REVIEW_DECISION",
          reviewRequestId,
          content: revertCommentContent as any,
          creatorId: userId,
          [entityFkField]: req.entityId,
        },
        select: { id: true },
      });

      return { commentId: created.id };
    });

  let commentId: string;
  try {
    ({ commentId } = await runRevert());
  } catch (err) {
    if (isAlreadyPendingError(err)) {
      throw new ReviewSupersededError(reviewRequestId, "unknown");
    }
    throw err;
  }

  try {
    const mentionedUserIds = extractMentionedUserIds(revertCommentContent);
    if (mentionedUserIds.length > 0) {
      await CommentService.createCommentMentions(commentId, mentionedUserIds);
    }
    const entityName = await loadEntityName(req.entityType, req.entityId);
    if (entityName !== null) {
      await NotificationService.createReviewDecisionRevertedNotification({
        requesterUserId: req.requestedBy.id,
        reverterUserId: userId,
        reverterName,
        deciderUserId: priorDeciderId,
        deciderName,
        revertedDecision,
        projectId: req.project.id,
        projectName: req.project.name,
        entityType: req.entityType,
        entityId: req.entityId,
        entityName,
        fromStateName: req.fromState.name,
        toStateName: req.toState.name,
        reviewRequestId,
      });
    }
  } catch (notifyErr) {
    console.error(
      "revertReviewDecision: revert-notification dispatch failed",
      notifyErr
    );
  }

  try {
    const entityName = await loadEntityName(req.entityType, req.entityId);
    if (entityName !== null) {
      await emitReviewRevertedEvent(
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
          revertedDecision,
          revertedDecisionComment: revertedComment,
          revertedByUserId: userId,
          reverterName,
          revertCount,
          requestedByUserId: req.requestedBy.id,
          requesterName: req.requestedBy.name ?? "Unknown User",
        },
        { actorUserId: userId }
      );
    }
  } catch (webhookErr) {
    console.error(
      "revertReviewDecision: review-reverted webhook emit failed",
      webhookErr
    );
  }

  try {
    const auditAction: AuditAction = "REVIEW_DECISION_REVERTED";
    await captureAuditEvent({
      action: auditAction,
      entityType: "ReviewRequest",
      entityId: reviewRequestId,
      projectId: req.project.id,
      userId,
      metadata: {
        // The reverted decision and its comment are cleared from the row, so
        // the audit entry has to carry them to stand on its own.
        revertedDecision,
        revertedDecisionComment: (revertedComment ?? "").slice(0, 4096),
        // Cleared from the row by the revert, so without it the entry cannot
        // say whose decision was undone.
        decidedByUserId: priorDeciderId,
        revertedByUserId: userId,
        revertCount,
        fromStateId: req.fromStateId,
        toStateId: req.toStateId,
        requestedByUserId: req.requestedBy.id,
        entityType: req.entityType,
        entityId: req.entityId,
      },
    });
  } catch (auditErr) {
    console.error("revertReviewDecision: audit emission failed", auditErr);
  }

  return baseDb.reviewRequest.findUniqueOrThrow({
    where: { id: reviewRequestId },
  });
}

/**
 * Current workflow state of a review's subject, read through the transaction
 * client so the value is consistent with the rollback that follows it.
 */
async function loadEntityStateId(
  tx: TxClient,
  entityType: "CASE" | "RUN" | "SESSION",
  entityId: number
): Promise<number | null> {
  if (entityType === "CASE") {
    const row = await tx.repositoryCases.findUnique({
      where: { id: entityId },
      select: { stateId: true },
    });
    return row?.stateId ?? null;
  }
  if (entityType === "RUN") {
    const row = await tx.testRuns.findUnique({
      where: { id: entityId },
      select: { stateId: true },
    });
    return row?.stateId ?? null;
  }
  const row = await tx.sessions.findUnique({
    where: { id: entityId },
    select: { stateId: true },
  });
  return row?.stateId ?? null;
}

/**
 * Move a review's subject to `stateId`. Goes through the hooked transaction
 * client (not raw SQL) so the backward move fires Elasticsearch sync, the
 * outbound webhooks and the CDC audit trail exactly as a manual state change
 * would — `applyApprovedReviewTransition` writes the forward move the same way.
 */
async function updateEntityStateId(
  tx: TxClient,
  entityType: "CASE" | "RUN" | "SESSION",
  entityId: number,
  stateId: number
): Promise<void> {
  if (entityType === "CASE") {
    await tx.repositoryCases.update({
      where: { id: entityId },
      data: { stateId },
    });
    return;
  }
  if (entityType === "RUN") {
    await tx.testRuns.update({ where: { id: entityId }, data: { stateId } });
    return;
  }
  await tx.sessions.update({ where: { id: entityId }, data: { stateId } });
}

async function loadEntityName(
  entityType: "CASE" | "RUN" | "SESSION",
  entityId: number
): Promise<string | null> {
  if (entityType === "CASE") {
    const row = await baseDb.repositoryCases.findUnique({
      where: { id: entityId },
      select: { name: true },
    });
    return row?.name ?? null;
  }
  if (entityType === "RUN") {
    const row = await baseDb.testRuns.findUnique({
      where: { id: entityId },
      select: { name: true },
    });
    return row?.name ?? null;
  }
  const row = await baseDb.sessions.findUnique({
    where: { id: entityId },
    select: { name: true },
  });
  return row?.name ?? null;
}

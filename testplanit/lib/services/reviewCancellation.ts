/**
 * Cancel review requests whose subject has just been soft-deleted.
 *
 * The status flip runs inside the deleting transaction so the inbox and every
 * status-derived badge settle with the delete, and a rollback leaves the
 * reviews untouched. Notification, webhook, and audit are dispatched
 * afterwards, best-effort — a failed side channel must not fail the delete.
 *
 * Only PENDING rows are touched; a decided review keeps its outcome.
 */
import type { TxClient } from "~/lib/zenstack";

// Declared locally, as app/actions/reviews.ts does — there is no shared
// definition of this union yet and introducing one is a wider refactor.
type ReviewableEntityType = "CASE" | "RUN" | "SESSION";

/** Row shape the post-commit dispatch needs; loaded before the status flip. */
interface CancelledReview {
  id: string;
  projectId: number;
  projectName: string;
  entityType: ReviewableEntityType;
  entityId: number;
  requestedByUserId: string;
  assigneeUserId: string | null;
  assigneeRoleId: number | null;
  fromStateId: number;
  fromStateName: string;
  toStateId: number;
  toStateName: string;
  toStateColor: string | null;
}

/**
 * Flip every PENDING review request for the given entities to CANCELLED.
 *
 * Returns the rows it cancelled so the caller can announce them; an empty
 * array means there was nothing in flight and no announcement is due.
 */
export async function cancelReviewsForDeletedEntities(
  tx: TxClient,
  entityType: ReviewableEntityType,
  entityIds: number[]
): Promise<CancelledReview[]> {
  if (entityIds.length === 0) return [];

  const pending = await tx.reviewRequest.findMany({
    where: {
      entityType,
      entityId: { in: entityIds },
      status: "PENDING",
      isDeleted: false,
    },
    select: {
      id: true,
      entityId: true,
      requestedByUserId: true,
      assigneeUserId: true,
      assigneeRoleId: true,
      fromStateId: true,
      toStateId: true,
      project: { select: { id: true, name: true } },
      fromState: { select: { name: true } },
      toState: { select: { name: true, color: { select: { value: true } } } },
    },
  });

  if (pending.length === 0) return [];

  // Scoped to PENDING so a concurrently-landing decide wins instead of racing.
  await tx.reviewRequest.updateMany({
    where: { id: { in: pending.map((r) => r.id) }, status: "PENDING" },
    data: { status: "CANCELLED" },
  });

  return pending.map((r) => ({
    id: r.id,
    projectId: r.project.id,
    projectName: r.project.name,
    entityType,
    entityId: r.entityId,
    requestedByUserId: r.requestedByUserId,
    assigneeUserId: r.assigneeUserId,
    assigneeRoleId: r.assigneeRoleId,
    fromStateId: r.fromStateId,
    fromStateName: r.fromState.name,
    toStateId: r.toStateId,
    toStateName: r.toState.name,
    toStateColor: r.toState.color?.value ?? null,
  }));
}

/**
 * Notify the assigned reviewers, fire the webhook, and record the audit entry.
 * Never throws — it runs detached from the delete that triggered it.
 * `entityNames` is passed in because the rows are already deleted by now.
 */
export async function announceDeletionCancelledReviews(
  cancelled: CancelledReview[],
  entityNames: Map<number, string>,
  actor: { userId: string | null; userName: string | null }
): Promise<void> {
  if (cancelled.length === 0) return;

  // Imported lazily: this module is reached from `sideEffectsPlugin`, which the
  // ORM client builds at module load. NotificationService and the webhook
  // emitters pull in that same client, so a static import here would close the
  // cycle and leave one of the two half-initialised.
  const [
    { NotificationService },
    { emitReviewCompletedEvent },
    { captureAuditEvent },
  ] = await Promise.all([
    import("~/lib/services/notificationService"),
    import("~/lib/webhooks/event-emitters/reviewEvents"),
    import("~/lib/services/auditLog"),
  ]);

  const actorName = actor.userName ?? "Unknown User";

  for (const review of cancelled) {
    const entityName = entityNames.get(review.entityId);
    if (!entityName) continue;

    try {
      // Role-assigned requests fan out to every holder, minus the actor.
      const targetUserIds =
        review.assigneeUserId !== null && review.assigneeUserId !== actor.userId
          ? [review.assigneeUserId]
          : review.assigneeRoleId !== null
            ? await NotificationService.resolveRoleHolderUserIds(
                review.projectId,
                review.assigneeRoleId,
                // No actor (worker/system delete) means nobody to exclude.
                actor.userId ?? ""
              )
            : [];

      if (targetUserIds.length > 0 && actor.userId) {
        await NotificationService.createReviewCancelledNotification({
          targetUserIds,
          cancelerUserId: actor.userId,
          cancelerName: actorName,
          projectId: review.projectId,
          projectName: review.projectName,
          entityType: review.entityType,
          entityId: review.entityId,
          entityName,
          fromStateName: review.fromStateName,
          toStateName: review.toStateName,
          reviewRequestId: review.id,
        });
      }
    } catch (err) {
      console.error(
        `cancelReviewsForDeletedEntities: notification failed for review ${review.id}`,
        err
      );
    }

    try {
      await emitReviewCompletedEvent(
        {
          reviewRequestId: review.id,
          projectId: review.projectId,
          entityType: review.entityType,
          entityId: review.entityId,
          entityName,
          fromStateId: review.fromStateId,
          toStateId: review.toStateId,
          toStateName: review.toStateName,
          toStateColor: review.toStateColor,
          decision: "CANCELLED",
          decidedByUserId: actor.userId ?? "",
          deciderName: actorName,
          decisionComment: null,
          requestedByUserId: review.requestedByUserId,
          requesterName: actorName,
        },
        actor.userId ? { actorUserId: actor.userId } : undefined
      );
    } catch (err) {
      console.error(
        `cancelReviewsForDeletedEntities: webhook emit failed for review ${review.id}`,
        err
      );
    }

    try {
      await captureAuditEvent({
        action: "REVIEW_CANCELLED",
        entityType: "ReviewRequest",
        entityId: review.id,
        projectId: review.projectId,
        userId: actor.userId ?? undefined,
        metadata: {
          fromStateId: review.fromStateId,
          toStateId: review.toStateId,
          entityType: review.entityType,
          entityId: review.entityId,
          // Distinguishes this from a requester-driven cancel.
          cancelledBy: "ENTITY_DELETED",
        },
      });
    } catch (err) {
      console.error(
        `cancelReviewsForDeletedEntities: audit capture failed for review ${review.id}`,
        err
      );
    }
  }
}

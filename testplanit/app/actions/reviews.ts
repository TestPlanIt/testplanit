"use server";

import type { JSONContent } from "@tiptap/core";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { withActionAuditContext } from "~/lib/auditContextWrappers";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { CommentService } from "~/lib/services/commentService";
import { NotificationService } from "~/lib/services/notificationService";
import { isReviewFeatureSystemEnabled } from "~/lib/services/reviewFeatureFlag";
import { prisma } from "~/lib/prisma";
import { extractMentionedUserIds } from "~/lib/utils/tiptapMentions";
import { AlreadyPendingError } from "~/lib/utils/errors";
import {
  emitReviewCompletedEvent,
  emitReviewRequestedEvent,
} from "~/lib/webhooks/event-emitters/reviewEvents";
import { getServerAuthSession } from "~/server/auth";

type ReviewableEntityType = "CASE" | "RUN" | "SESSION";

interface RequestReviewInput {
  projectId: number;
  entityType: ReviewableEntityType;
  entityId: number;
  fromStateId: number;
  toStateId: number;
  assigneeUserId: string | null;
  assigneeRoleId: number | null;
  /**
   * Plain text from the Sheet's Comment textarea. Wrapped into a TipTap doc
   * server-side. Optional — common usage is a one-liner ("Please review
   * this.") that the requester shouldn't be forced to type every time. When
   * empty, the paired Comment still carries the @mention so the assignee is
   * notified; the prose is additive context, not a precondition.
   */
  commentText: string;
}

interface RequestReviewSuccess {
  success: true;
  reviewRequestId: string;
  commentId: string;
}

interface RequestReviewFailure {
  success: false;
  error:
    | "INVALID_INPUT"
    | "ALREADY_PENDING"
    | "UNAUTHORIZED"
    | "FEATURE_DISABLED"
    | "INTERNAL_ERROR";
  message?: string;
}

export type RequestReviewResult = RequestReviewSuccess | RequestReviewFailure;

/**
 * Submit a new ReviewRequest plus the paired Comment that holds the
 * requester's prose (Phase 2 hybrid design — D-21 follow-up).
 *
 * The pair lands inside a single Prisma `$transaction` so a request never
 * commits without its accompanying conversation thread message. After the tx
 * commits the action calls `CommentService.processMentions` to fan out the
 * existing `@mention` notifications — that step is intentionally outside the
 * tx because notification creation references the committed Comment.id and
 * because mention processing also fetches each mentioned user's project
 * access for the notification copy.
 *
 * The Sheet historically wrote the requester comment into ReviewRequest's
 * `decisionComment` column, which was a misuse — `decisionComment` is meant
 * for the reviewer's response and was getting overwritten on decide. This
 * action stops writing the requester prose to ReviewRequest entirely; it
 * lives on the paired Comment row.
 *
 * For role-assigned reviews (`assigneeRoleId != null`), the auto-comment
 * does NOT inject a TipTap mention node — the existing `@mention`
 * notification path can't address a role. Role-targeted notifications fan
 * out via the bespoke role-aware pathway Phase 3 will build.
 */
export const requestReview = withActionAuditContext(
  async (input: RequestReviewInput): Promise<RequestReviewResult> => {
    const session = await getServerAuthSession();
    if (!session?.user?.id) {
      return { success: false, error: "UNAUTHORIZED" };
    }
    const requestedByUserId = session.user.id;

    // Defense-in-depth: the schema-layer @@deny rules no longer reference the
    // project / system feature flags, so the app preflight is the only seam
    // that short-circuits a request when the feature is off. Mirror the
    // chokepoint helpers (`assertReviewGatePasses`, `decideReviewRequest`)
    // by failing fast here with a typed FEATURE_DISABLED before we touch the
    // database. Project flag is loaded via the same query so a single
    // round-trip answers both checks.
    const systemEnabled = await isReviewFeatureSystemEnabled(prisma);
    if (!systemEnabled) {
      return { success: false, error: "FEATURE_DISABLED" };
    }
    const project = await prisma.projects.findUnique({
      where: { id: input.projectId },
      select: { reviewWorkflowEnabled: true },
    });
    if (!project || project.reviewWorkflowEnabled !== true) {
      return { success: false, error: "FEATURE_DISABLED" };
    }

    const trimmed = input.commentText.trim();

    // Build the TipTap doc that will become the Comment.content. For direct
    // user-assignees, prepend a mention node so the existing comment-mention
    // notification fires for the assignee without extra wiring. Role assignees
    // fall through with no mention node (see method docstring).
    let assigneeMentionNode: JSONContent | null = null;
    if (input.assigneeUserId !== null) {
      const assigneeUser = await prisma.user.findUnique({
        where: { id: input.assigneeUserId },
        select: { id: true, name: true },
      });
      if (assigneeUser) {
        assigneeMentionNode = {
          type: "mention",
          attrs: { id: assigneeUser.id, label: assigneeUser.name ?? "user" },
        };
      }
    }

    // Default-text fallback: when the requester leaves the comment blank we
    // still want a useful body on the persisted Comment row — both for the
    // assignee's context and for the comment thread to show something other
    // than an empty bubble. Build a "Please review the transition from
    // {from} → {to}" string with the role name appended when role-assigned.
    // Skip the round-trip when the requester actually typed something.
    //
    // The text is localized to the requester's session locale via
    // `getTranslations()` — the locale comes from the same next-intl
    // request scope the layout uses. The persisted Comment.content carries
    // whichever language the requester saw at submit time; the comment
    // thread renders it verbatim so a French reviewer reading an English
    // requester's default comment sees the English version (consistent
    // with how user-typed comments work).
    let defaultCommentText: string | null = null;
    if (trimmed.length === 0) {
      const [fromState, toState, assigneeRole, t] = await Promise.all([
        prisma.workflows.findUnique({
          where: { id: input.fromStateId },
          select: { name: true },
        }),
        prisma.workflows.findUnique({
          where: { id: input.toStateId },
          select: { name: true },
        }),
        input.assigneeRoleId !== null
          ? prisma.roles.findUnique({
              where: { id: input.assigneeRoleId },
              select: { name: true },
            })
          : Promise.resolve(null),
        getTranslations("reviews.requester"),
      ]);
      const fromName = fromState?.name ?? "";
      const toName = toState?.name ?? "";
      defaultCommentText = assigneeRole
        ? t("defaultCommentRole", {
            fromState: fromName,
            toState: toName,
            roleName: assigneeRole.name,
          })
        : t("defaultComment", { fromState: fromName, toState: toName });
    }

    const bodyText = trimmed.length > 0 ? trimmed : (defaultCommentText ?? "");

    const paragraphChildren: JSONContent[] = [];
    if (assigneeMentionNode) {
      paragraphChildren.push(assigneeMentionNode);
      if (bodyText.length > 0) {
        paragraphChildren.push({ type: "text", text: " " });
      }
    }
    if (bodyText.length > 0) {
      paragraphChildren.push({ type: "text", text: bodyText });
    }

    const commentContent: JSONContent = {
      type: "doc",
      content: [{ type: "paragraph", content: paragraphChildren }],
    };

    const entityFkField: "repositoryCaseId" | "testRunId" | "sessionId" =
      input.entityType === "CASE"
        ? "repositoryCaseId"
        : input.entityType === "RUN"
          ? "testRunId"
          : "sessionId";

    try {
      const { reviewRequestId, commentId } = await prisma.$transaction(
        async (tx) => {
          const reviewRequest = await tx.reviewRequest.create({
            data: {
              projectId: input.projectId,
              entityType: input.entityType,
              entityId: input.entityId,
              fromStateId: input.fromStateId,
              toStateId: input.toStateId,
              requestedByUserId,
              assigneeUserId: input.assigneeUserId,
              assigneeRoleId: input.assigneeRoleId,
              status: "PENDING",
            },
            select: { id: true },
          });

          const comment = await tx.comment.create({
            data: {
              projectId: input.projectId,
              type: "REVIEW_REQUEST",
              reviewRequestId: reviewRequest.id,
              content: commentContent as any,
              creatorId: requestedByUserId,
              [entityFkField]: input.entityId,
            },
            select: { id: true },
          });

          return {
            reviewRequestId: reviewRequest.id,
            commentId: comment.id,
          };
        }
      );

      // Persist mention rows (used by the comment renderer to highlight @mentions
      // in-thread) and dispatch the dedicated REVIEW_REQUESTED notification(s) to
      // every reviewer the request targets — direct user assignee OR the full
      // set of role holders on the project. Runs outside the tx because
      // notification creation depends on the committed Comment.id and queries
      // role membership. Failures here do NOT roll back the review request —
      // we'd rather have an unannounced review than a lost one.
      try {
        const mentionedUserIds = extractMentionedUserIds(commentContent);
        if (mentionedUserIds.length > 0) {
          await CommentService.createCommentMentions(
            commentId,
            mentionedUserIds
          );
        }

        const targetUserIds: string[] =
          input.assigneeUserId !== null
            ? [input.assigneeUserId]
            : input.assigneeRoleId !== null
              ? await NotificationService.resolveRoleHolderUserIds(
                  input.projectId,
                  input.assigneeRoleId,
                  requestedByUserId
                )
              : [];

        const context = await loadReviewContext(
          input.projectId,
          input.entityType,
          input.entityId,
          input.fromStateId,
          input.toStateId
        );

        if (targetUserIds.length > 0 && context) {
          await NotificationService.createReviewRequestNotification({
            targetUserIds,
            requesterUserId: requestedByUserId,
            requesterName: session.user.name ?? "Unknown User",
            projectId: context.projectId,
            projectName: context.projectName,
            entityType: input.entityType,
            entityId: input.entityId,
            entityName: context.entityName,
            fromStateName: context.fromStateName,
            toStateName: context.toStateName,
            reviewRequestId,
            commentText: trimmed,
          });
        }

        if (mentionedUserIds.length > 0 && context) {
          const commentEntityType: "RepositoryCase" | "TestRun" | "Session" =
            input.entityType === "CASE"
              ? "RepositoryCase"
              : input.entityType === "RUN"
                ? "TestRun"
                : "Session";
          await CommentService.processMentions(
            commentId,
            commentContent,
            requestedByUserId,
            session.user.name ?? "Unknown User",
            context.projectId,
            context.projectName,
            commentEntityType,
            context.entityName,
            String(input.entityId)
          );
        }
      } catch (notifyErr) {
        console.error(
          "requestReview: review-request notification dispatch failed",
          notifyErr
        );
      }

      try {
        const context = await loadReviewContext(
          input.projectId,
          input.entityType,
          input.entityId,
          input.fromStateId,
          input.toStateId
        );
        if (context) {
          const [assigneeUser, assigneeRole] = await Promise.all([
            input.assigneeUserId !== null
              ? prisma.user.findUnique({
                  where: { id: input.assigneeUserId },
                  select: { name: true },
                })
              : Promise.resolve(null),
            input.assigneeRoleId !== null
              ? prisma.roles.findUnique({
                  where: { id: input.assigneeRoleId },
                  select: { name: true },
                })
              : Promise.resolve(null),
          ]);
          await emitReviewRequestedEvent(
            {
              reviewRequestId,
              projectId: input.projectId,
              entityType: input.entityType,
              entityId: input.entityId,
              entityName: context.entityName,
              fromStateId: input.fromStateId,
              fromStateName: context.fromStateName,
              toStateId: input.toStateId,
              toStateName: context.toStateName,
              toStateColor: context.toStateColor,
              requestedByUserId,
              requesterName: session.user.name ?? "Unknown User",
              assigneeUserId: input.assigneeUserId,
              assigneeUserName: assigneeUser?.name ?? null,
              assigneeRoleId: input.assigneeRoleId,
              assigneeRoleName: assigneeRole?.name ?? null,
              commentText: trimmed.length > 0 ? trimmed : null,
            },
            { actorUserId: requestedByUserId }
          );
        }
      } catch (webhookErr) {
        console.error(
          "requestReview: review-request webhook emit failed",
          webhookErr
        );
      }

      try {
        await captureAuditEvent({
          action: "REVIEW_REQUESTED",
          entityType: "ReviewRequest",
          entityId: reviewRequestId,
          projectId: input.projectId,
          userId: requestedByUserId,
          metadata: {
            fromStateId: input.fromStateId,
            toStateId: input.toStateId,
            assigneeUserId: input.assigneeUserId,
            assigneeRoleId: input.assigneeRoleId,
            requestedByUserId,
            entityType: input.entityType,
            entityId: input.entityId,
            commentText: trimmed.slice(0, 4096),
          },
        });
      } catch (auditErr) {
        console.error("requestReview: audit emission failed", auditErr);
      }

      revalidatePath("/");
      return { success: true, reviewRequestId, commentId };
    } catch (err) {
      if (err instanceof AlreadyPendingError) {
        return { success: false, error: "ALREADY_PENDING" };
      }
      if (
        err instanceof Error &&
        err.message
          .toLowerCase()
          .includes("a pending review request already exists")
      ) {
        return { success: false, error: "ALREADY_PENDING" };
      }
      console.error("requestReview failed", err);
      return { success: false, error: "INTERNAL_ERROR" };
    }
  }
);

async function loadReviewContext(
  projectId: number,
  entityType: ReviewableEntityType,
  entityId: number,
  fromStateId: number,
  toStateId: number
): Promise<{
  projectId: number;
  projectName: string;
  entityName: string;
  fromStateName: string;
  toStateName: string;
  toStateColor: string | null;
} | null> {
  const [project, fromState, toState] = await Promise.all([
    prisma.projects.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    prisma.workflows.findUnique({
      where: { id: fromStateId },
      select: { name: true },
    }),
    prisma.workflows.findUnique({
      where: { id: toStateId },
      select: { name: true, color: { select: { value: true } } },
    }),
  ]);
  if (!project) return null;

  let entityName: string | null = null;
  if (entityType === "CASE") {
    const row = await prisma.repositoryCases.findUnique({
      where: { id: entityId },
      select: { name: true },
    });
    entityName = row?.name ?? null;
  } else if (entityType === "RUN") {
    const row = await prisma.testRuns.findUnique({
      where: { id: entityId },
      select: { name: true },
    });
    entityName = row?.name ?? null;
  } else {
    const row = await prisma.sessions.findUnique({
      where: { id: entityId },
      select: { name: true },
    });
    entityName = row?.name ?? null;
  }
  if (entityName === null) return null;

  return {
    projectId: project.id,
    projectName: project.name,
    entityName,
    fromStateName: fromState?.name ?? "",
    toStateName: toState?.name ?? "",
    toStateColor: toState?.color?.value ?? null,
  };
}

interface CancelReviewSuccess {
  success: true;
  reviewRequestId: string;
}

interface CancelReviewFailure {
  success: false;
  error:
    | "UNAUTHORIZED"
    | "NOT_FOUND"
    | "ALREADY_DECIDED"
    | "FORBIDDEN"
    | "FEATURE_DISABLED"
    | "INTERNAL_ERROR";
  message?: string;
}

export type CancelReviewResult = CancelReviewSuccess | CancelReviewFailure;

/**
 * Cancel a PENDING ReviewRequest. Mirrors `decideReviewRequest`'s shape: the
 * status flip lands inside a tx, then notification + webhook + audit fan out
 * outside the tx so transient downstream failures don't roll back the row
 * change.
 *
 * Permission model: only the original requester or a system admin can
 * cancel. (Phase 1 the cancel affordance is gated on the same predicate
 * client-side; the server-side check is the authoritative one.)
 *
 * Soft-delete invariant: this is a STATUS flip, not a row deletion.
 */
export const cancelReviewRequest = withActionAuditContext(
  async (reviewRequestId: string): Promise<CancelReviewResult> => {
    const session = await getServerAuthSession();
    if (!session?.user?.id) {
      return { success: false, error: "UNAUTHORIZED" };
    }
    const userId = session.user.id;

    const systemEnabled = await isReviewFeatureSystemEnabled(prisma);
    if (!systemEnabled) {
      return { success: false, error: "FEATURE_DISABLED" };
    }

    const req = await prisma.reviewRequest.findUnique({
      where: { id: reviewRequestId },
      include: {
        project: {
          select: { id: true, name: true, reviewWorkflowEnabled: true },
        },
        fromState: { select: { id: true, name: true } },
        toState: {
          select: {
            id: true,
            name: true,
            color: { select: { value: true } },
          },
        },
      },
    });
    if (!req) {
      return { success: false, error: "NOT_FOUND" };
    }
    if (req.project.reviewWorkflowEnabled !== true) {
      return { success: false, error: "FEATURE_DISABLED" };
    }
    if (req.status !== "PENDING") {
      return { success: false, error: "ALREADY_DECIDED" };
    }

    const isAdmin = session.user.access === "ADMIN";
    const isRequester = req.requestedByUserId === userId;
    if (!isAdmin && !isRequester) {
      return { success: false, error: "FORBIDDEN" };
    }

    try {
      // Atomic flip — `updateMany` scoped to status=PENDING so a concurrent
      // decide on the same row can't co-commit. Loser sees count === 0 and
      // surfaces as ALREADY_DECIDED.
      const result = await prisma.reviewRequest.updateMany({
        where: { id: reviewRequestId, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      if (result.count === 0) {
        return { success: false, error: "ALREADY_DECIDED" };
      }
    } catch (err) {
      console.error("cancelReviewRequest: status flip failed", err);
      return { success: false, error: "INTERNAL_ERROR" };
    }

    // Resolve recipients: direct user-assignee or every role holder, minus
    // the canceler themselves.
    let targetUserIds: string[] = [];
    try {
      if (req.assigneeUserId !== null && req.assigneeUserId !== userId) {
        targetUserIds = [req.assigneeUserId];
      } else if (req.assigneeRoleId !== null) {
        targetUserIds = await NotificationService.resolveRoleHolderUserIds(
          req.project.id,
          req.assigneeRoleId,
          userId
        );
      }
    } catch (resolveErr) {
      console.error(
        "cancelReviewRequest: role-holder resolution failed",
        resolveErr
      );
    }

    try {
      const entityName = await loadEntityName(req.entityType, req.entityId);
      if (entityName !== null && targetUserIds.length > 0) {
        await NotificationService.createReviewCancelledNotification({
          targetUserIds,
          cancelerUserId: userId,
          cancelerName: session.user.name ?? "Unknown User",
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
        "cancelReviewRequest: cancel-notification dispatch failed",
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
            decision: "CANCELLED",
            decidedByUserId: userId,
            deciderName: session.user.name ?? "Unknown User",
            decisionComment: null,
            requestedByUserId: req.requestedByUserId,
            requesterName: session.user.name ?? "Unknown User",
          },
          { actorUserId: userId }
        );
      }
    } catch (webhookErr) {
      console.error(
        "cancelReviewRequest: review-cancelled webhook emit failed",
        webhookErr
      );
    }

    try {
      await captureAuditEvent({
        action: "REVIEW_CANCELLED",
        entityType: "ReviewRequest",
        entityId: reviewRequestId,
        projectId: req.project.id,
        userId,
        metadata: {
          fromStateId: req.fromStateId,
          toStateId: req.toStateId,
          cancelerUserId: userId,
          requestedByUserId: req.requestedByUserId,
          entityType: req.entityType,
          entityId: req.entityId,
        },
      });
    } catch (auditErr) {
      console.error("cancelReviewRequest: audit emission failed", auditErr);
    }

    revalidatePath("/");
    return { success: true, reviewRequestId };
  }
);

async function loadEntityName(
  entityType: ReviewableEntityType,
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

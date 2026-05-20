"use server";

import type { JSONContent } from "@tiptap/core";
import { revalidatePath } from "next/cache";

import { CommentService } from "~/lib/services/commentService";
import { prisma } from "~/lib/prisma";
import { extractMentionedUserIds } from "~/lib/utils/tiptapMentions";
import { AlreadyPendingError } from "~/lib/utils/errors";
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
export async function requestReview(
  input: RequestReviewInput
): Promise<RequestReviewResult> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return { success: false, error: "UNAUTHORIZED" };
  }
  const requestedByUserId = session.user.id;

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

  const paragraphChildren: JSONContent[] = [];
  if (assigneeMentionNode) {
    paragraphChildren.push(assigneeMentionNode);
    if (trimmed.length > 0) {
      paragraphChildren.push({ type: "text", text: " " });
    }
  }
  if (trimmed.length > 0) {
    paragraphChildren.push({ type: "text", text: trimmed });
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

    // Notify the mentioned assignee outside the transaction. The mention
    // pathway looks up the project + project access for each mentioned user
    // and writes Notification rows, so it deliberately runs after the
    // Comment commit. Errors here do NOT roll back the review request —
    // we'd rather have an unannounced review than a lost one.
    try {
      const mentionedUserIds = extractMentionedUserIds(commentContent);
      if (mentionedUserIds.length > 0) {
        await CommentService.createCommentMentions(commentId, mentionedUserIds);
        const projectAndEntity = await loadProjectAndEntity(
          input.projectId,
          input.entityType,
          input.entityId
        );
        if (projectAndEntity) {
          await CommentService.processMentions(
            commentId,
            commentContent,
            requestedByUserId,
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
        "requestReview: paired-comment mention processing failed",
        mentionErr
      );
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

async function loadProjectAndEntity(
  projectId: number,
  entityType: ReviewableEntityType,
  entityId: number
): Promise<{
  project: { id: number; name: string };
  entityType: "RepositoryCase" | "TestRun" | "Session";
  entityName: string;
  entityId: string;
} | null> {
  const project = await prisma.projects.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) return null;

  if (entityType === "CASE") {
    const row = await prisma.repositoryCases.findUnique({
      where: { id: entityId },
      select: { id: true, name: true },
    });
    return row
      ? {
          project,
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
          project,
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
        project,
        entityType: "Session",
        entityName: row.name,
        entityId: String(row.id),
      }
    : null;
}

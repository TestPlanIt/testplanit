"use server";

import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";
import { revalidatePath } from "next/cache";
import { CommentService } from "~/lib/services/commentService";
import { JSONContent } from "@tiptap/core";
import {
  extractMentionedUserIds,
  isValidTipTapContent,
} from "~/lib/utils/tiptapMentions";

interface CreateCommentInput {
  content: JSONContent;
  projectId: number;
  repositoryCaseId?: number;
  testRunId?: number;
  sessionId?: number;
  milestoneId?: number;
}

interface UpdateCommentInput {
  commentId: string;
  content: JSONContent;
}

export async function createComment(input: CreateCommentInput) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  // Validate input
  if (!isValidTipTapContent(input.content)) {
    return { success: false, error: "Invalid comment content format" };
  }

  // Ensure exactly one entity is specified
  const entityCount = [
    input.repositoryCaseId,
    input.testRunId,
    input.sessionId,
    input.milestoneId,
  ].filter((id) => id !== undefined).length;

  if (entityCount !== 1) {
    return {
      success: false,
      error: "Comment must be associated with exactly one entity",
    };
  }

  try {
    // Create the comment
    const comment = await db.comment.create({
      data: {
        content: input.content as any,
        projectId: input.projectId,
        creatorId: session.user.id,
        repositoryCaseId: input.repositoryCaseId,
        testRunId: input.testRunId,
        sessionId: input.sessionId,
        milestoneId: input.milestoneId,
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        repositoryCase: {
          select: {
            id: true,
            name: true,
          },
        },
        testRun: {
          select: {
            id: true,
            name: true,
          },
        },
        session: {
          select: {
            id: true,
            name: true,
          },
        },
        milestone: {
          select: {
            id: true,
            name: true,
            milestoneType: {
              select: {
                icon: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Extract mentioned user IDs
    const mentionedUserIds = extractMentionedUserIds(input.content);

    // Create CommentMention records
    if (mentionedUserIds.length > 0) {
      await CommentService.createCommentMentions(comment.id, mentionedUserIds);
    }

    // Determine entity details for notifications
    let entityType: "RepositoryCase" | "TestRun" | "Session" | "Milestone";
    let entityName: string;
    let entityId: string;
    let milestoneTypeIconName: string | undefined;

    if (comment.repositoryCase) {
      entityType = "RepositoryCase";
      entityName = comment.repositoryCase.name;
      entityId = comment.repositoryCase.id.toString();
    } else if (comment.testRun) {
      entityType = "TestRun";
      entityName = comment.testRun.name;
      entityId = comment.testRun.id.toString();
    } else if (comment.session) {
      entityType = "Session";
      entityName = comment.session.name;
      entityId = comment.session.id.toString();
    } else if (comment.milestone) {
      entityType = "Milestone";
      entityName = comment.milestone.name;
      entityId = comment.milestone.id.toString();
      milestoneTypeIconName = comment.milestone.milestoneType?.icon?.name;
    } else {
      throw new Error("Comment entity not found");
    }

    // Process mentions and send notifications
    if (mentionedUserIds.length > 0) {
      await CommentService.processMentions(
        comment.id,
        input.content,
        session.user.id,
        comment.creator.name ?? "Unknown User",
        comment.project.id,
        comment.project.name,
        entityType,
        entityName,
        entityId,
        milestoneTypeIconName
      );
    }

    revalidatePath("/");
    return { success: true, comment };
  } catch (error) {
    console.error("Failed to create comment:", error);
    return { success: false, error: "Failed to create comment" };
  }
}

export async function updateComment(input: UpdateCommentInput) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  // Validate input
  if (!isValidTipTapContent(input.content)) {
    return { success: false, error: "Invalid comment content format" };
  }

  try {
    // Get existing comment to verify ownership
    const existingComment = await db.comment.findUnique({
      where: { id: input.commentId },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        repositoryCase: {
          select: {
            id: true,
            name: true,
          },
        },
        testRun: {
          select: {
            id: true,
            name: true,
          },
        },
        session: {
          select: {
            id: true,
            name: true,
          },
        },
        milestone: {
          select: {
            id: true,
            name: true,
            milestoneType: {
              select: {
                icon: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!existingComment) {
      return { success: false, error: "Comment not found" };
    }

    // Check if user is the creator
    if (existingComment.creatorId !== session.user.id) {
      return { success: false, error: "Unauthorized to edit this comment" };
    }

    // Check if comment is deleted
    if (existingComment.isDeleted) {
      return { success: false, error: "Cannot edit deleted comment" };
    }

    // Update the comment
    const updatedComment = await db.comment.update({
      where: { id: input.commentId },
      data: {
        content: input.content as any,
        isEdited: true,
      },
    });

    // Extract new mentioned user IDs
    const newMentionedUserIds = extractMentionedUserIds(input.content);

    // Update CommentMention records
    // Remove old mentions that are no longer in the content
    await CommentService.removeOldMentions(
      input.commentId,
      newMentionedUserIds
    );

    // Add new mentions
    if (newMentionedUserIds.length > 0) {
      await CommentService.createCommentMentions(
        input.commentId,
        newMentionedUserIds
      );
    }

    // Determine entity details for notifications
    let entityType: "RepositoryCase" | "TestRun" | "Session" | "Milestone";
    let entityName: string;
    let entityId: string;
    let milestoneTypeIconName: string | undefined;

    if (existingComment.repositoryCase) {
      entityType = "RepositoryCase";
      entityName = existingComment.repositoryCase.name;
      entityId = existingComment.repositoryCase.id.toString();
    } else if (existingComment.testRun) {
      entityType = "TestRun";
      entityName = existingComment.testRun.name;
      entityId = existingComment.testRun.id.toString();
    } else if (existingComment.session) {
      entityType = "Session";
      entityName = existingComment.session.name;
      entityId = existingComment.session.id.toString();
    } else if (existingComment.milestone) {
      entityType = "Milestone";
      entityName = existingComment.milestone.name;
      entityId = existingComment.milestone.id.toString();
      milestoneTypeIconName = existingComment.milestone.milestoneType?.icon?.name;
    } else {
      throw new Error("Comment entity not found");
    }

    // Process new mentions and send notifications
    if (newMentionedUserIds.length > 0) {
      await CommentService.processMentions(
        input.commentId,
        input.content,
        session.user.id,
        existingComment.creator.name ?? "Unknown User",
        existingComment.project.id,
        existingComment.project.name,
        entityType,
        entityName,
        entityId,
        milestoneTypeIconName
      );
    }

    revalidatePath("/");
    return { success: true, comment: updatedComment };
  } catch (error) {
    console.error("Failed to update comment:", error);
    return { success: false, error: "Failed to update comment" };
  }
}

export async function deleteComment(commentId: string) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  try {
    // Get existing comment to verify ownership
    const existingComment = await db.comment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        creatorId: true,
        isDeleted: true,
      },
    });

    if (!existingComment) {
      return { success: false, error: "Comment not found" };
    }

    // Check if user is the creator or admin
    const isCreator = existingComment.creatorId === session.user.id;
    const isAdmin = session.user.access === "ADMIN";

    if (!isCreator && !isAdmin) {
      return { success: false, error: "Unauthorized to delete this comment" };
    }

    // Check if already deleted
    if (existingComment.isDeleted) {
      return { success: false, error: "Comment already deleted" };
    }

    // Soft delete the comment
    const deletedComment = await db.comment.update({
      where: { id: commentId },
      data: {
        isDeleted: true,
      },
    });

    revalidatePath("/");
    return { success: true, comment: deletedComment };
  } catch (error) {
    console.error("Failed to delete comment:", error);
    return { success: false, error: "Failed to delete comment" };
  }
}

export async function getCommentsForEntity(
  entityType: "repositoryCase" | "testRun" | "session" | "milestone",
  entityId: number
) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const whereClause: any = {
      isDeleted: false,
    };

    if (entityType === "repositoryCase") {
      whereClause.repositoryCaseId = entityId;
    } else if (entityType === "testRun") {
      whereClause.testRunId = entityId;
    } else if (entityType === "session") {
      whereClause.sessionId = entityId;
    } else if (entityType === "milestone") {
      whereClause.milestoneId = entityId;
    }

    const comments = await db.comment.findMany({
      where: whereClause,
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            isActive: true,
            isDeleted: true,
          },
        },
        mentionedUsers: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                isActive: true,
                isDeleted: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return { success: true, comments };
  } catch (error) {
    console.error("Failed to get comments:", error);
    return { success: false, error: "Failed to get comments" };
  }
}

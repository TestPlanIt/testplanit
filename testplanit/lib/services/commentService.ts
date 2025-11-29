import { JSONContent } from "@tiptap/core";
import { extractMentionedUserIds } from "../utils/tiptapMentions";
import { NotificationType } from "@prisma/client";
import { NotificationService } from "./notificationService";

export interface CreateCommentParams {
  content: JSONContent;
  projectId: number;
  creatorId: string;
  repositoryCaseId?: number;
  testRunId?: number;
  sessionId?: number;
}

export interface UpdateCommentParams {
  commentId: string;
  content: JSONContent;
  userId: string;
}

export class CommentService {
  /**
   * Process mentions in a comment and create notifications
   * @param commentId Comment ID
   * @param content TipTap JSON content
   * @param creatorId User who created the comment
   * @param creatorName Name of the user who created the comment
   * @param projectId Project ID where the comment was made
   * @param projectName Name of the project
   * @param entityType Type of entity (RepositoryCase, TestRun, Session)
   * @param entityName Name of the entity
   * @param entityId ID of the entity (for building link)
   * @returns Array of user IDs that were mentioned
   */
  static async processMentions(
    commentId: string,
    content: JSONContent,
    creatorId: string,
    creatorName: string,
    projectId: number,
    projectName: string,
    entityType: "RepositoryCase" | "TestRun" | "Session",
    entityName: string,
    entityId: string
  ): Promise<string[]> {
    const mentionedUserIds = extractMentionedUserIds(content);

    // Don't notify the comment creator if they mentioned themselves
    const usersToNotify = mentionedUserIds.filter((id) => id !== creatorId);

    if (usersToNotify.length === 0) {
      return [];
    }

    // Import db to check user access
    const { prisma } = await import("~/lib/prisma");

    // Get user details - basic info only for now
    // TODO: Implement proper project access checking with ZenStack
    const mentionedUsers = await prisma.user.findMany({
      where: {
        id: { in: usersToNotify },
        isActive: true,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    // For now, assume all mentioned users have access
    // In production, you would check project permissions here
    // Create notification for each mentioned user
    const notificationPromises = mentionedUsers.map((user) => {
      // Simplified access check - assume has access for now
      // TODO: Implement proper project access logic using ZenStack
      const hasProjectAccess = true;

      const entityTypeLabel =
        entityType === "RepositoryCase"
          ? "test case"
          : entityType === "TestRun"
            ? "test run"
            : "session";

      let message: string;
      let relatedEntityId: string | undefined;
      let relatedEntityType: string | undefined;

      if (hasProjectAccess) {
        message = `${creatorName} mentioned you in a comment on ${entityTypeLabel} "${entityName}" in project "${projectName}"`;
        relatedEntityId = commentId;
        relatedEntityType = "Comment";
      } else {
        message = `${creatorName} mentioned you in a comment on a ${entityTypeLabel} in project "${projectName}", but you do not have access to this project`;
        // No relatedEntityId/Type when user doesn't have access
      }

      // Build the appropriate data structure for links
      const notificationData: any = {
        commentId,
        creatorId,
        creatorName,
        projectId,
        projectName,
        entityType,
        entityName,
        hasProjectAccess,
      };

      // Add entity-specific ID for link building
      if (entityType === "RepositoryCase") {
        notificationData.repositoryCaseId = parseInt(entityId);
        notificationData.testCaseName = entityName;
      } else if (entityType === "TestRun") {
        notificationData.testRunId = parseInt(entityId);
        notificationData.testRunName = entityName;
      } else if (entityType === "Session") {
        notificationData.sessionId = parseInt(entityId);
        notificationData.sessionName = entityName;
      }

      return NotificationService.createNotification({
        userId: user.id,
        type: NotificationType.COMMENT_MENTION,
        title: "You were mentioned in a comment",
        message,
        relatedEntityId,
        relatedEntityType,
        data: notificationData,
      });
    });

    await Promise.all(notificationPromises);
    return usersToNotify;
  }

  /**
   * Create CommentMention records for mentioned users
   * @param commentId Comment ID
   * @param userIds Array of user IDs to create mentions for
   */
  static async createCommentMentions(
    commentId: string,
    userIds: string[]
  ): Promise<void> {
    if (userIds.length === 0) return;

    const { db } = await import("~/server/db");

    // Use createMany for better performance
    await db.commentMention.createMany({
      data: userIds.map((userId) => ({
        commentId,
        userId,
      })),
      skipDuplicates: true, // In case of race conditions
    });
  }

  /**
   * Remove old mentions that are no longer in the updated content
   * @param commentId Comment ID
   * @param currentUserIds Array of user IDs currently in the content
   */
  static async removeOldMentions(
    commentId: string,
    currentUserIds: string[]
  ): Promise<void> {
    const { db } = await import("~/server/db");

    await db.commentMention.deleteMany({
      where: {
        commentId,
        userId: {
          notIn: currentUserIds.length > 0 ? currentUserIds : undefined,
        },
      },
    });
  }
}

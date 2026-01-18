import { getNotificationQueue } from "../queues";
import { JOB_CREATE_NOTIFICATION } from "../../workers/notificationWorker";
import { NotificationType } from "@prisma/client";
import { getCurrentTenantId } from "../multiTenantPrisma";

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntityId?: string;
  relatedEntityType?: string;
  data?: any;
}

export class NotificationService {
  /**
   * Create a notification for a user
   */
  static async createNotification(params: CreateNotificationParams) {
    const notificationQueue = getNotificationQueue();
    if (!notificationQueue) {
      console.warn("Notification queue not available, notification not created");
      return;
    }

    try {
      const jobData = {
        ...params,
        tenantId: getCurrentTenantId(),
      };

      const job = await notificationQueue.add(JOB_CREATE_NOTIFICATION, jobData, {
        removeOnComplete: true,
        removeOnFail: false,
      });

      console.log(`Queued notification job ${job.id} for user ${params.userId}`);
      return job.id;
    } catch (error) {
      console.error("Failed to queue notification:", error);
      throw error;
    }
  }

  /**
   * Create a work assignment notification
   */
  static async createWorkAssignmentNotification(
    assignedToId: string,
    entityType: "TestRunCase" | "Session",
    entityName: string,
    projectName: string,
    assignedById: string,
    assignedByName: string,
    entityId: string
  ) {
    const title = `New ${entityType === "TestRunCase" ? "Test Case" : "Session"} Assignment`;
    const message = `${assignedByName} assigned you to ${entityType === "TestRunCase" ? "test case" : "session"} "${entityName}" in project "${projectName}"`;

    return this.createNotification({
      userId: assignedToId,
      type: entityType === "TestRunCase" ? NotificationType.WORK_ASSIGNED : NotificationType.SESSION_ASSIGNED,
      title,
      message,
      relatedEntityId: entityId,
      relatedEntityType: entityType,
      data: {
        assignedById,
        assignedByName,
        projectName,
        entityName,
      },
    });
  }

  /**
   * Mark notifications as read
   */
  static async markNotificationsAsRead(notificationIds: string[], userId: string) {
    // This will be handled by the API endpoint using ZenStack hooks
    // The service method is here for consistency
    return notificationIds;
  }

  /**
   * Get unread notification count for a user
   */
  static async getUnreadCount(userId: string): Promise<number> {
    // This will be handled by the API endpoint using ZenStack hooks
    // The service method is here for consistency
    return 0;
  }

  /**
   * Create a milestone due reminder notification
   */
  static async createMilestoneDueNotification(
    userId: string,
    milestoneName: string,
    projectName: string,
    dueDate: Date,
    milestoneId: number,
    projectId: number,
    isOverdue: boolean
  ) {
    const title = isOverdue ? "Milestone Overdue" : "Milestone Due Soon";
    const message = isOverdue
      ? `Milestone "${milestoneName}" in project "${projectName}" was due on ${dueDate.toLocaleDateString()}`
      : `Milestone "${milestoneName}" in project "${projectName}" is due on ${dueDate.toLocaleDateString()}`;

    return this.createNotification({
      userId,
      type: NotificationType.MILESTONE_DUE_REMINDER,
      title,
      message,
      relatedEntityId: milestoneId.toString(),
      relatedEntityType: "Milestone",
      data: {
        milestoneName,
        projectName,
        projectId,
        milestoneId,
        dueDate: dueDate.toISOString(),
        isOverdue,
      },
    });
  }

  /**
   * Create a user registration notification for all System Admins
   */
  static async createUserRegistrationNotification(
    newUserName: string,
    newUserEmail: string,
    newUserId: string,
    registrationMethod: "form" | "sso"
  ) {
    // Import db directly to avoid circular dependencies
    const { db } = await import("~/server/db");
    
    try {
      // Find all users with ADMIN access
      const systemAdmins = await db.user.findMany({
        where: {
          access: "ADMIN",
          isActive: true,
          isDeleted: false,
        },
        select: {
          id: true,
        },
      });

      if (systemAdmins.length === 0) {
        console.warn("No system administrators found to notify");
        return;
      }

      const title = "New User Registration";
      const method = registrationMethod === "sso" ? "SSO" : "registration form";
      const message = `${newUserName} (${newUserEmail}) has registered via ${method}`;

      // Create notifications for each system admin
      const notificationPromises = systemAdmins.map((admin) =>
        this.createNotification({
          userId: admin.id,
          type: NotificationType.USER_REGISTERED,
          title,
          message,
          relatedEntityId: newUserId,
          relatedEntityType: "User",
          data: {
            newUserName,
            newUserEmail,
            newUserId,
            registrationMethod,
          },
        })
      );

      await Promise.all(notificationPromises);
      console.log(`Created user registration notifications for ${systemAdmins.length} system administrators`);
    } catch (error) {
      console.error("Failed to create user registration notifications:", error);
      // Don't throw error as this is a non-critical operation
    }
  }

  /**
   * Create a share link accessed notification
   */
  static async createShareLinkAccessedNotification(
    shareLinkOwnerId: string,
    shareTitle: string,
    viewerName: string | null,
    viewerEmail: string | null,
    shareLinkId: string,
    projectId?: number
  ) {
    const title = "Share Link Accessed";
    const viewer = viewerName || viewerEmail || "An anonymous user";
    const message = `${viewer} viewed your shared link: "${shareTitle}"`;

    return this.createNotification({
      userId: shareLinkOwnerId,
      type: NotificationType.SHARE_LINK_ACCESSED,
      title,
      message,
      relatedEntityId: shareLinkId,
      relatedEntityType: "ShareLink",
      data: {
        shareLinkId,
        ...(projectId !== undefined && { projectId }),
        viewerName,
        viewerEmail,
        viewedAt: new Date().toISOString(),
      },
    });
  }
}
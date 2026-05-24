import { NotificationType } from "@prisma/client";
import { JOB_CREATE_NOTIFICATION } from "../../workers/notificationWorker";
import { getCurrentTenantId } from "../multiTenantPrisma";
import { getNotificationQueue } from "../queues";

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntityId?: string;
  relatedEntityType?: string;
  data?: any;
  tenantId?: string;
}

export class NotificationService {
  /**
   * Create a notification for a user
   */
  static async createNotification(params: CreateNotificationParams) {
    const notificationQueue = getNotificationQueue();
    if (!notificationQueue) {
      console.warn(
        "Notification queue not available, notification not created"
      );
      return;
    }

    try {
      const jobData = {
        ...params,
        tenantId: params.tenantId ?? getCurrentTenantId(),
      };

      const job = await notificationQueue.add(
        JOB_CREATE_NOTIFICATION,
        jobData,
        {
          removeOnComplete: true,
          removeOnFail: false,
        }
      );

      console.log(
        `Queued notification job ${job.id} for user ${params.userId}`
      );
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
      type:
        entityType === "TestRunCase"
          ? NotificationType.WORK_ASSIGNED
          : NotificationType.SESSION_ASSIGNED,
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
  static async markNotificationsAsRead(
    notificationIds: string[],
    _userId: string
  ) {
    // This will be handled by the API endpoint using ZenStack hooks
    // The service method is here for consistency
    return notificationIds;
  }

  /**
   * Get unread notification count for a user
   */
  static async getUnreadCount(_userId: string): Promise<number> {
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
    isOverdue: boolean,
    tenantId?: string
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
      tenantId,
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
      console.log(
        `Created user registration notifications for ${systemAdmins.length} system administrators`
      );
    } catch (error) {
      console.error("Failed to create user registration notifications:", error);
      // Don't throw error as this is a non-critical operation
    }
  }

  /**
   * Resolve the user IDs that hold a role on a project, mirroring every
   * eligibility branch in `decideReviewRequest` — direct UserProjectPermission
   * AND indirect via group membership. SCIM/SAML deployments commonly
   * provision role access at the group level, so fanout MUST include
   * group-derived holders or those users see no notification for a review
   * they are perfectly eligible to act on.
   *
   * Branches:
   *   - SPECIFIC_ROLE via UserProjectPermission where `roleId === assigneeRoleId`
   *   - GLOBAL_ROLE via UserProjectPermission where the user's global `roleId`
   *     matches `assigneeRoleId`
   *   - SPECIFIC_ROLE via GroupProjectPermission where `roleId === assigneeRoleId`
   *     and the user is in the group
   *   - GLOBAL_ROLE via GroupProjectPermission where the user's global
   *     `roleId` matches `assigneeRoleId` and the user is in the group
   *
   * The requester is excluded — assigning a review to a role you hold
   * yourself shouldn't ping you about your own request. ADMIN users are
   * NOT pre-fanned here: the schema admin-override applies at decide time,
   * but blasting every system admin on every role-assigned review would be
   * spam. If a non-role-holder admin wants to act, they can do so from the
   * review inbox.
   */
  static async resolveRoleHolderUserIds(
    projectId: number,
    roleId: number,
    requesterUserId: string
  ): Promise<string[]> {
    const { prisma } = await import("~/lib/prisma");

    const specificRoleRows = await prisma.userProjectPermission.findMany({
      where: {
        projectId,
        accessType: "SPECIFIC_ROLE",
        roleId,
        user: { isActive: true, isDeleted: false },
      },
      select: { userId: true },
    });

    const globalRoleRows = await prisma.userProjectPermission.findMany({
      where: {
        projectId,
        accessType: "GLOBAL_ROLE",
        user: { isActive: true, isDeleted: false, roleId },
      },
      select: { userId: true },
    });

    // Group-based SPECIFIC_ROLE: every active user in a group that has this
    // role on the project. The per-relation `assignedUsers.where` keeps the
    // returned member list filtered to active users only.
    const groupSpecificRoleRows = await prisma.groupProjectPermission.findMany({
      where: { projectId, accessType: "SPECIFIC_ROLE", roleId },
      select: {
        group: {
          select: {
            assignedUsers: {
              where: { user: { isActive: true, isDeleted: false } },
              select: { userId: true },
            },
          },
        },
      },
    });

    // Group-based GLOBAL_ROLE: every active user in a group with GLOBAL_ROLE
    // access on the project whose `User.roleId` matches the assigned role.
    const groupGlobalRoleRows = await prisma.groupProjectPermission.findMany({
      where: { projectId, accessType: "GLOBAL_ROLE" },
      select: {
        group: {
          select: {
            assignedUsers: {
              where: { user: { isActive: true, isDeleted: false, roleId } },
              select: { userId: true },
            },
          },
        },
      },
    });

    const ids = new Set<string>();
    for (const row of specificRoleRows) ids.add(row.userId);
    for (const row of globalRoleRows) ids.add(row.userId);
    for (const row of groupSpecificRoleRows) {
      for (const a of row.group.assignedUsers) ids.add(a.userId);
    }
    for (const row of groupGlobalRoleRows) {
      for (const a of row.group.assignedUsers) ids.add(a.userId);
    }
    ids.delete(requesterUserId);
    return Array.from(ids);
  }

  /**
   * Dispatch a REVIEW_REQUESTED notification to each target reviewer.
   *
   * The persisted `title` and `message` columns hold an English fallback
   * for older clients and for environments where `getServerTranslation`
   * can't resolve a locale; the bell-icon (NotificationContent.tsx) and
   * the email worker re-render localized copy at display time from the
   * `data` payload. Mirrors the `feedback_localize_new_notifications`
   * contract for any new NotificationType.
   */
  static async createReviewRequestNotification(params: {
    targetUserIds: string[];
    requesterUserId: string;
    requesterName: string;
    projectId: number;
    projectName: string;
    entityType: "CASE" | "RUN" | "SESSION";
    entityId: number;
    entityName: string;
    fromStateName: string;
    toStateName: string;
    reviewRequestId: string;
    commentText: string;
  }) {
    if (params.targetUserIds.length === 0) return;

    const entityLabel =
      params.entityType === "CASE"
        ? "test case"
        : params.entityType === "RUN"
          ? "test run"
          : "session";

    const title = "Review requested";
    const message = `${params.requesterName} requested your review of ${entityLabel} "${params.entityName}" in project "${params.projectName}"`;

    await Promise.all(
      params.targetUserIds.map((userId) =>
        this.createNotification({
          userId,
          type: NotificationType.REVIEW_REQUESTED,
          title,
          message,
          relatedEntityId: params.reviewRequestId,
          relatedEntityType: "ReviewRequest",
          data: {
            reviewRequestId: params.reviewRequestId,
            requesterUserId: params.requesterUserId,
            requesterName: params.requesterName,
            projectId: params.projectId,
            projectName: params.projectName,
            entityType: params.entityType,
            entityId: params.entityId,
            entityName: params.entityName,
            fromStateName: params.fromStateName,
            toStateName: params.toStateName,
            commentText: params.commentText,
          },
        })
      )
    );
  }

  /**
   * Dispatch a REVIEW_APPROVED / REVIEW_CHANGES_REQUESTED / REVIEW_REJECTED
   * notification to the original requester after a decision lands. Decision
   * outcomes share a single dispatch surface because they all target the
   * same recipient and carry the same payload shape; the
   * NotificationType discriminator drives renderer/email copy.
   */
  static async createReviewDecisionNotification(params: {
    requesterUserId: string;
    deciderUserId: string;
    deciderName: string;
    decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";
    projectId: number;
    projectName: string;
    entityType: "CASE" | "RUN" | "SESSION";
    entityId: number;
    entityName: string;
    fromStateName: string;
    toStateName: string;
    reviewRequestId: string;
    decisionComment: string;
  }) {
    // Don't notify the decider if they decided their own request (admin
    // self-approval edge case).
    if (params.requesterUserId === params.deciderUserId) return;

    const entityLabel =
      params.entityType === "CASE"
        ? "test case"
        : params.entityType === "RUN"
          ? "test run"
          : "session";

    let type: NotificationType;
    let title: string;
    let message: string;
    if (params.decision === "APPROVED") {
      type = NotificationType.REVIEW_APPROVED;
      title = "Review approved";
      message = `${params.deciderName} approved your review request on ${entityLabel} "${params.entityName}" in project "${params.projectName}"`;
    } else if (params.decision === "CHANGES_REQUESTED") {
      type = NotificationType.REVIEW_CHANGES_REQUESTED;
      title = "Changes requested";
      message = `${params.deciderName} requested changes on your review request for ${entityLabel} "${params.entityName}" in project "${params.projectName}"`;
    } else {
      type = NotificationType.REVIEW_REJECTED;
      title = "Review rejected";
      message = `${params.deciderName} rejected your review request on ${entityLabel} "${params.entityName}" in project "${params.projectName}"`;
    }

    await this.createNotification({
      userId: params.requesterUserId,
      type,
      title,
      message,
      relatedEntityId: params.reviewRequestId,
      relatedEntityType: "ReviewRequest",
      data: {
        reviewRequestId: params.reviewRequestId,
        deciderUserId: params.deciderUserId,
        deciderName: params.deciderName,
        decision: params.decision,
        projectId: params.projectId,
        projectName: params.projectName,
        entityType: params.entityType,
        entityId: params.entityId,
        entityName: params.entityName,
        fromStateName: params.fromStateName,
        toStateName: params.toStateName,
        decisionComment: params.decisionComment,
      },
    });
  }

  /**
   * Dispatch a REVIEW_CANCELLED notification to each prospective reviewer of
   * a request that was just cancelled by the requester (or an admin). Direct
   * user-assignee receives one notification; role-assigned requests fan out
   * to every active role holder on the project. The requester themselves is
   * excluded — they took the action and don't need to be told about it.
   *
   * Persisted `title` / `message` are English fallback only; bell + email
   * worker re-render localized copy at display time per the
   * `feedback_localize_new_notifications` contract.
   */
  static async createReviewCancelledNotification(params: {
    targetUserIds: string[];
    cancelerUserId: string;
    cancelerName: string;
    projectId: number;
    projectName: string;
    entityType: "CASE" | "RUN" | "SESSION";
    entityId: number;
    entityName: string;
    fromStateName: string;
    toStateName: string;
    reviewRequestId: string;
  }) {
    if (params.targetUserIds.length === 0) return;

    const entityLabel =
      params.entityType === "CASE"
        ? "test case"
        : params.entityType === "RUN"
          ? "test run"
          : "session";

    const title = "Review request cancelled";
    const message = `${params.cancelerName} cancelled the review request on ${entityLabel} "${params.entityName}" in project "${params.projectName}"`;

    await Promise.all(
      params.targetUserIds.map((userId) =>
        this.createNotification({
          userId,
          type: NotificationType.REVIEW_CANCELLED,
          title,
          message,
          relatedEntityId: params.reviewRequestId,
          relatedEntityType: "ReviewRequest",
          data: {
            reviewRequestId: params.reviewRequestId,
            cancelerUserId: params.cancelerUserId,
            cancelerName: params.cancelerName,
            projectId: params.projectId,
            projectName: params.projectName,
            entityType: params.entityType,
            entityId: params.entityId,
            entityName: params.entityName,
            fromStateName: params.fromStateName,
            toStateName: params.toStateName,
          },
        })
      )
    );
  }

  /**
   * Dispatch a REVIEW_REMINDER notification to each target reviewer after a
   * pending review request has been waiting longer than the configured
   * threshold. Recipients are pre-resolved by the caller (the review-reminder
   * worker case in `workers/forecastWorker.ts`) — requester exclusion is
   * enforced upstream by `resolveRoleHolderUserIds` for role assignments and
   * by a defense-in-depth filter for direct assignments.
   *
   * Persisted `title` / `message` are English fallback only; the bell-icon
   * UI (`components/NotificationContent.tsx`) and email worker
   * (`workers/emailWorker.ts`, both immediate and digest paths) re-render
   * localized copy from the `data` payload at display time per the
   * `feedback_localize_new_notifications` contract.
   */
  static async createReviewReminderNotification(params: {
    targetUserIds: string[];
    requesterUserId: string;
    requesterName: string;
    projectId: number;
    projectName: string;
    entityType: "CASE" | "RUN" | "SESSION";
    entityId: number;
    entityName: string;
    fromStateName: string;
    toStateName: string;
    reviewRequestId: string;
    hoursPending: number;
  }) {
    if (params.targetUserIds.length === 0) return;

    const entityLabel =
      params.entityType === "CASE"
        ? "test case"
        : params.entityType === "RUN"
          ? "test run"
          : "session";

    const title = "Review still pending";
    const message = `Reminder: ${params.requesterName}'s review request on ${entityLabel} "${params.entityName}" in project "${params.projectName}" is still waiting on you (${params.hoursPending}h pending).`;

    await Promise.all(
      params.targetUserIds.map((userId) =>
        this.createNotification({
          userId,
          type: NotificationType.REVIEW_REMINDER,
          title,
          message,
          relatedEntityId: params.reviewRequestId,
          relatedEntityType: "ReviewRequest",
          data: {
            reviewRequestId: params.reviewRequestId,
            requesterUserId: params.requesterUserId,
            requesterName: params.requesterName,
            projectId: params.projectId,
            projectName: params.projectName,
            entityType: params.entityType,
            entityId: params.entityId,
            entityName: params.entityName,
            fromStateName: params.fromStateName,
            toStateName: params.toStateName,
            hoursPending: params.hoursPending,
          },
        })
      )
    );
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
    const title = "Shared Report Viewed";
    const viewer = viewerName || viewerEmail || "Someone";
    const message = `${viewer} viewed your shared report: "${shareTitle}"`;

    return this.createNotification({
      userId: shareLinkOwnerId,
      type: NotificationType.SHARE_LINK_ACCESSED,
      title,
      message,
      relatedEntityId: shareLinkId,
      relatedEntityType: "ShareLink",
      data: {
        shareLinkId,
        // Persisted in the data payload so the bell-icon UI and the
        // email worker can compose the localized "X viewed your shared
        // report: '<title>'" message at render time without falling
        // back to the English `message` column.
        shareTitle,
        ...(projectId !== undefined && { projectId }),
        viewerName,
        viewerEmail,
        viewedAt: new Date().toISOString(),
      },
    });
  }
}

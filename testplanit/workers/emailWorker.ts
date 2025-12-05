import { Worker, Job } from "bullmq";
import valkeyConnection from "../lib/valkey";
import { EMAIL_QUEUE_NAME } from "../lib/queues";
import {
  sendNotificationEmail,
  sendDigestEmail,
} from "../lib/email/notificationTemplates";
import { pathToFileURL } from "node:url";
import {
  getServerTranslation,
  getServerTranslations,
  formatLocaleForUrl,
} from "../lib/server-translations";
import { tiptapToHtml, isTipTapContent } from "../utils/tiptapToHtml";
import {
  getPrismaClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  disconnectAllTenantClients,
  validateMultiTenantJobData,
  getTenantConfig,
} from "../lib/multiTenantPrisma";

interface SendNotificationEmailJobData extends MultiTenantJobData {
  notificationId: string;
  userId: string;
  immediate: boolean;
}

interface SendDigestEmailJobData extends MultiTenantJobData {
  userId: string;
  notifications: Array<{
    id: string;
    title: string;
    message: string;
    createdAt: Date;
    url?: string;
  }>;
}

const processor = async (job: Job) => {
  console.log(`Processing email job ${job.id} of type ${job.name}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`);

  // Validate multi-tenant job data if in multi-tenant mode
  validateMultiTenantJobData(job.data);

  // Get the appropriate Prisma client (tenant-specific or default)
  const prisma = getPrismaClientForJob(job.data);

  switch (job.name) {
    case "send-notification-email":
      const notificationData = job.data as SendNotificationEmailJobData;

      try {
        // Get notification details with user preferences
        const notification = await prisma.notification.findUnique({
          where: { id: notificationData.notificationId },
          include: {
            user: {
              include: {
                userPreferences: true,
              },
            },
          },
        });

        if (!notification || !notification.user.email) {
          console.log("Notification or user email not found");
          return;
        }

        // Build notification URL based on type and data
        let notificationUrl: string | undefined;
        // In multi-tenant mode, use the tenant's baseUrl from config; otherwise fall back to NEXTAUTH_URL
        const tenantConfig = notificationData.tenantId ? getTenantConfig(notificationData.tenantId) : undefined;
        const baseUrl = tenantConfig?.baseUrl || process.env.NEXTAUTH_URL || "http://localhost:3000";
        const userLocale = notification.user.userPreferences?.locale || "en_US";
        const urlLocale = formatLocaleForUrl(userLocale);

        // Parse notification data if it exists
        const data = (notification.data as any) || {};

        if (notification.type === "WORK_ASSIGNED" && !data.isBulkAssignment) {
          // Test run case assignment
          if (data.projectId && data.testRunId && data.testCaseId) {
            notificationUrl = `${baseUrl}/${urlLocale}/projects/runs/${data.projectId}/${data.testRunId}?selectedCase=${data.testCaseId}`;
          }
        } else if (notification.type === "SESSION_ASSIGNED") {
          // Session assignment
          if (data.projectId && data.sessionId) {
            notificationUrl = `${baseUrl}/${urlLocale}/projects/sessions/${data.projectId}/${data.sessionId}`;
          }
        } else if (notification.type === "MILESTONE_DUE_REMINDER") {
          // Milestone due reminder
          if (data.projectId && data.milestoneId) {
            notificationUrl = `${baseUrl}/${urlLocale}/projects/milestones/${data.projectId}/${data.milestoneId}`;
          }
        }

        // Get translated title and message
        let translatedTitle = notification.title;
        let translatedMessage = notification.message;
        let htmlMessage: string | undefined;

        if (notification.type === "WORK_ASSIGNED" && !data.isBulkAssignment) {
          translatedTitle = await getServerTranslation(
            userLocale,
            "components.notifications.content.testCaseAssignmentTitle"
          );
          translatedMessage = `${data.assignedByName} ${await getServerTranslation(userLocale, "components.notifications.content.assignedTestCase")} "${data.testCaseName}" ${await getServerTranslation(userLocale, "components.notifications.content.inProject")} "${data.projectName}"`;
        } else if (
          notification.type === "WORK_ASSIGNED" &&
          data.isBulkAssignment
        ) {
          translatedTitle = await getServerTranslation(
            userLocale,
            "components.notifications.content.multipleTestCaseAssignmentTitle"
          );
          translatedMessage = `${data.assignedByName} ${await getServerTranslation(userLocale, "components.notifications.content.assignedMultipleTestCases", { count: data.count })}`;
        } else if (notification.type === "SESSION_ASSIGNED") {
          translatedTitle = await getServerTranslation(
            userLocale,
            "components.notifications.content.sessionAssignmentTitle"
          );
          translatedMessage = `${data.assignedByName} ${await getServerTranslation(userLocale, "components.notifications.content.assignedSession")} "${data.sessionName || data.entityName}" ${await getServerTranslation(userLocale, "components.notifications.content.inProject")} "${data.projectName}"`;
        } else if (notification.type === "COMMENT_MENTION") {
          translatedTitle = await getServerTranslation(
            userLocale,
            "components.notifications.content.commentMentionTitle"
          );
          translatedMessage = `${data.creatorName} ${await getServerTranslation(userLocale, "components.notifications.content.mentionedYouInComment")} "${data.entityName}" ${await getServerTranslation(userLocale, "components.notifications.content.inProject")} "${data.projectName}"`;

          // Build notification URL based on entity type
          if (data.projectId && data.hasProjectAccess) {
            if (data.entityType === "RepositoryCase" && data.repositoryCaseId) {
              notificationUrl = `${baseUrl}/${urlLocale}/projects/repository/${data.projectId}/${data.repositoryCaseId}`;
            } else if (data.entityType === "TestRun" && data.testRunId) {
              notificationUrl = `${baseUrl}/${urlLocale}/projects/runs/${data.projectId}/${data.testRunId}`;
            } else if (data.entityType === "Session" && data.sessionId) {
              notificationUrl = `${baseUrl}/${urlLocale}/projects/sessions/${data.projectId}/${data.sessionId}`;
            } else if (data.entityType === "Milestone" && data.milestoneId) {
              notificationUrl = `${baseUrl}/${urlLocale}/projects/milestones/${data.projectId}/${data.milestoneId}`;
            }
          }
        } else if (notification.type === "SYSTEM_ANNOUNCEMENT") {
          // For system announcements, check if we have rich content
          if (data.richContent && isTipTapContent(data.richContent)) {
            htmlMessage = tiptapToHtml(data.richContent);
          }
          // Add sender info to the message if not using HTML
          if (!htmlMessage && data.sentByName) {
            translatedMessage += `\n\n${await getServerTranslation(userLocale, "components.notifications.content.sentBy", { name: data.sentByName })}`;
          }
        } else if (notification.type === "MILESTONE_DUE_REMINDER") {
          // Milestone due reminder
          const isOverdue = data.isOverdue === true;
          translatedTitle = await getServerTranslation(
            userLocale,
            isOverdue
              ? "components.notifications.content.milestoneOverdueTitle"
              : "components.notifications.content.milestoneDueSoonTitle"
          );
          const formattedDueDate = data.dueDate
            ? new Date(data.dueDate).toLocaleDateString(userLocale.replace("_", "-"))
            : "";
          translatedMessage = await getServerTranslation(
            userLocale,
            isOverdue
              ? "components.notifications.content.milestoneOverdue"
              : "components.notifications.content.milestoneDueSoon",
            { milestoneName: data.milestoneName, projectName: data.projectName, dueDate: formattedDueDate }
          );
        }

        // Get email template translations
        const emailTranslations = await getServerTranslations(userLocale, [
          "email.greeting",
          "email.greetingWithName",
          "email.notification.intro",
          "email.notification.viewDetails",
          "email.notification.viewAll",
          "email.footer.sentBy",
          "email.footer.unsubscribe",
          "email.footer.managePreferences",
          "email.footer.allRightsReserved",
        ]);

        // Build additional info for milestone notifications
        let additionalInfo: string | undefined;
        if (notification.type === "MILESTONE_DUE_REMINDER") {
          const reasonMessage = await getServerTranslation(
            userLocale,
            "components.notifications.content.milestoneNotificationReason"
          );
          const continueMessage = await getServerTranslation(
            userLocale,
            "components.notifications.content.milestoneNotificationContinue"
          );
          additionalInfo = `${reasonMessage} ${continueMessage}`;
        }

        await sendNotificationEmail({
          to: notification.user.email,
          userId: notification.userId,
          userName: notification.user.name,
          notificationTitle: translatedTitle,
          notificationMessage: translatedMessage,
          notificationUrl,
          locale: urlLocale,
          translations: emailTranslations,
          htmlMessage,
          baseUrl,
          additionalInfo,
        });

        console.log(`Sent notification email to ${notification.user.email}`);
      } catch (error) {
        console.error(`Failed to send notification email:`, error);
        throw error;
      }
      break;

    case "send-digest-email":
      const digestData = job.data as SendDigestEmailJobData;

      try {
        // Get user details with preferences
        const user = await prisma.user.findUnique({
          where: { id: digestData.userId },
          include: {
            userPreferences: true,
          },
        });

        if (!user || !user.email) {
          console.log("User or email not found");
          return;
        }

        // Fetch full notification data to build URLs
        const fullNotifications = await prisma.notification.findMany({
          where: {
            id: { in: digestData.notifications.map((n) => n.id) },
          },
        });

        // Build URLs and translate content for each notification
        // In multi-tenant mode, use the tenant's baseUrl from config
        const digestTenantConfig = digestData.tenantId ? getTenantConfig(digestData.tenantId) : undefined;
        const digestBaseUrl = digestTenantConfig?.baseUrl || process.env.NEXTAUTH_URL || "http://localhost:3000";
        const notificationsWithUrls = await Promise.all(
          fullNotifications.map(async (notification: any) => {
            const baseUrl = digestBaseUrl;
            const userLocale = user.userPreferences?.locale || "en_US";
            const urlLocale = formatLocaleForUrl(userLocale);
            const data = (notification.data as any) || {};
            let url: string | undefined;

            if (
              notification.type === "WORK_ASSIGNED" &&
              !data.isBulkAssignment
            ) {
              if (data.projectId && data.testRunId && data.testCaseId) {
                url = `${baseUrl}/${urlLocale}/projects/runs/${data.projectId}/${data.testRunId}?selectedCase=${data.testCaseId}`;
              }
            } else if (notification.type === "SESSION_ASSIGNED") {
              if (data.projectId && data.sessionId) {
                url = `${baseUrl}/${urlLocale}/projects/sessions/${data.projectId}/${data.sessionId}`;
              }
            } else if (notification.type === "COMMENT_MENTION") {
              // Build URL based on entity type
              if (data.projectId && data.hasProjectAccess) {
                if (data.entityType === "RepositoryCase" && data.repositoryCaseId) {
                  url = `${baseUrl}/${urlLocale}/projects/repository/${data.projectId}/${data.repositoryCaseId}`;
                } else if (data.entityType === "TestRun" && data.testRunId) {
                  url = `${baseUrl}/${urlLocale}/projects/runs/${data.projectId}/${data.testRunId}`;
                } else if (data.entityType === "Session" && data.sessionId) {
                  url = `${baseUrl}/${urlLocale}/projects/sessions/${data.projectId}/${data.sessionId}`;
                } else if (data.entityType === "Milestone" && data.milestoneId) {
                  url = `${baseUrl}/${urlLocale}/projects/milestones/${data.projectId}/${data.milestoneId}`;
                }
              }
            } else if (notification.type === "MILESTONE_DUE_REMINDER") {
              // Milestone due reminder
              if (data.projectId && data.milestoneId) {
                url = `${baseUrl}/${urlLocale}/projects/milestones/${data.projectId}/${data.milestoneId}`;
              }
            }

            // Get translated title and message
            let translatedTitle = notification.title;
            let translatedMessage = notification.message;

            if (
              notification.type === "WORK_ASSIGNED" &&
              !data.isBulkAssignment
            ) {
              translatedTitle = await getServerTranslation(
                userLocale,
                "components.notifications.content.testCaseAssignmentTitle"
              );
              translatedMessage = `${data.assignedByName} ${await getServerTranslation(userLocale, "components.notifications.content.assignedTestCase")} "${data.testCaseName}" ${await getServerTranslation(userLocale, "components.notifications.content.inProject")} "${data.projectName}"`;
            } else if (
              notification.type === "WORK_ASSIGNED" &&
              data.isBulkAssignment
            ) {
              translatedTitle = await getServerTranslation(
                userLocale,
                "components.notifications.content.multipleTestCaseAssignmentTitle"
              );
              translatedMessage = `${data.assignedByName} ${await getServerTranslation(userLocale, "components.notifications.content.assignedMultipleTestCases", { count: data.count })}`;
            } else if (notification.type === "SESSION_ASSIGNED") {
              translatedTitle = await getServerTranslation(
                userLocale,
                "components.notifications.content.sessionAssignmentTitle"
              );
              translatedMessage = `${data.assignedByName} ${await getServerTranslation(userLocale, "components.notifications.content.assignedSession")} "${data.sessionName || data.entityName}" ${await getServerTranslation(userLocale, "components.notifications.content.inProject")} "${data.projectName}"`;
            } else if (notification.type === "COMMENT_MENTION") {
              translatedTitle = await getServerTranslation(
                userLocale,
                "components.notifications.content.commentMentionTitle"
              );
              translatedMessage = `${data.creatorName} ${await getServerTranslation(userLocale, "components.notifications.content.mentionedYouInComment")} "${data.entityName}" ${await getServerTranslation(userLocale, "components.notifications.content.inProject")} "${data.projectName}"`;
            } else if (notification.type === "MILESTONE_DUE_REMINDER") {
              const isOverdue = data.isOverdue === true;
              translatedTitle = await getServerTranslation(
                userLocale,
                isOverdue
                  ? "components.notifications.content.milestoneOverdueTitle"
                  : "components.notifications.content.milestoneDueSoonTitle"
              );
              const formattedDueDate = data.dueDate
                ? new Date(data.dueDate).toLocaleDateString(userLocale.replace("_", "-"))
                : "";
              translatedMessage = await getServerTranslation(
                userLocale,
                isOverdue
                  ? "components.notifications.content.milestoneOverdue"
                  : "components.notifications.content.milestoneDueSoon",
                { milestoneName: data.milestoneName, projectName: data.projectName, dueDate: formattedDueDate }
              );
            }

            return {
              id: notification.id,
              title: translatedTitle,
              message: translatedMessage,
              createdAt: notification.createdAt,
              url,
            };
          })
        );

        // Get email template translations
        const digestUserLocale = user.userPreferences?.locale || "en_US";
        const digestTranslations = await getServerTranslations(
          digestUserLocale,
          [
            "email.greeting",
            "email.greetingWithName",
            "email.digest.intro",
            "email.digest.viewDetails",
            "email.digest.viewAll",
            "email.digest.noNotifications",
            "email.digest.footer",
            "email.digest.profileSettings",
            "email.footer.sentBy",
            "email.footer.unsubscribe",
            "email.footer.managePreferences",
            "email.footer.allRightsReserved",
          ]
        );

        await sendDigestEmail({
          to: user.email,
          userId: user.id,
          userName: user.name,
          notifications: notificationsWithUrls,
          locale: formatLocaleForUrl(user.userPreferences?.locale || "en_US"),
          translations: digestTranslations,
          baseUrl: digestBaseUrl,
        });

        // Mark notifications as read after sending digest
        await prisma.notification.updateMany({
          where: {
            id: { in: digestData.notifications.map((n) => n.id) },
          },
          data: { isRead: true },
        });

        console.log(
          `Sent digest email to ${user.email} with ${digestData.notifications.length} notifications`
        );
      } catch (error) {
        console.error(`Failed to send digest email:`, error);
        throw error;
      }
      break;

    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
};

let worker: Worker | null = null;

// Function to start the worker
const startWorker = async () => {
  // Log multi-tenant mode status
  if (isMultiTenantMode()) {
    console.log("Email worker starting in MULTI-TENANT mode");
  } else {
    console.log("Email worker starting in SINGLE-TENANT mode");
  }

  if (valkeyConnection) {
    worker = new Worker(EMAIL_QUEUE_NAME, processor, {
      connection: valkeyConnection,
      concurrency: 3,
    });

    worker.on("completed", (job) => {
      console.log(`Email job ${job.id} completed successfully.`);
    });

    worker.on("failed", (job, err) => {
      console.error(`Email job ${job?.id} failed:`, err);
    });

    worker.on("error", (err) => {
      console.error("Email worker error:", err);
    });

    console.log(`Email worker started for queue "${EMAIL_QUEUE_NAME}".`);
  } else {
    console.warn("Valkey connection not available. Email worker not started.");
  }

  // Allow graceful shutdown
  process.on("SIGINT", async () => {
    console.log("Shutting down email worker...");
    if (worker) {
      await worker.close();
    }
    // Disconnect all tenant Prisma clients in multi-tenant mode
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });
};

// Run the worker if this file is executed directly (works with both ESM and CommonJS)
if (
  (typeof import.meta !== "undefined" &&
    import.meta.url === pathToFileURL(process.argv[1]).href) ||
  (typeof import.meta === "undefined" ||
    (import.meta as any).url === undefined)
) {
  console.log("Email worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start email worker:", err);
    process.exit(1);
  });
}

export default worker;

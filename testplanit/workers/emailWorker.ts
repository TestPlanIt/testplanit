import { Job, Worker } from "bullmq";
import {
  sendDigestEmail,
  sendNotificationEmail,
} from "../lib/email/notificationTemplates";
import {
  disconnectAllTenantClients,
  getDbClientForJob,
  getTenantConfig,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantDb";
import { EMAIL_QUEUE_NAME } from "../lib/queues";
import {
  formatLocaleForUrl,
  getServerTranslation,
  getServerTranslations,
} from "../lib/server-translations";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";
import { isTipTapContent, tiptapToHtml } from "../utils/tiptapToHtml";

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
  console.log(
    `Processing email job ${job.id} of type ${job.name}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`
  );

  // Validate multi-tenant job data if in multi-tenant mode
  validateMultiTenantJobData(job.data);

  // Get the appropriate Prisma client (tenant-specific or default)
  const db = getDbClientForJob(job.data);

  switch (job.name) {
    case "send-notification-email":
      const notificationData = job.data as SendNotificationEmailJobData;

      try {
        // Get notification details with user preferences
        const notification = await db.notification.findUnique({
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
        const tenantConfig = notificationData.tenantId
          ? getTenantConfig(notificationData.tenantId)
          : undefined;
        const baseUrl =
          tenantConfig?.baseUrl ||
          process.env.NEXTAUTH_URL ||
          "http://localhost:3000";
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
        } else if (notification.type === "GENERATE_FROM_URL_COMPLETE") {
          if (data.projectId && data.jobId && !data.error) {
            notificationUrl = `${baseUrl}/${urlLocale}/projects/repository/${data.projectId}?urlJobId=${data.jobId}`;
          }
        } else if (notification.type === "USER_REGISTERED") {
          // Surface the admin user list so the recipient can find the
          // newly-registered user without an extra search step.
          notificationUrl = `${baseUrl}/${urlLocale}/admin/users`;
        } else if (notification.type === "LLM_BUDGET_ALERT") {
          // Same destination as the bell-icon link (`data.link`) — admin LLM page.
          notificationUrl = `${baseUrl}/${urlLocale}${data.link ?? "/admin/llm"}`;
        } else if (
          notification.type === "REVIEW_REQUESTED" ||
          notification.type === "REVIEW_APPROVED" ||
          notification.type === "REVIEW_CHANGES_REQUESTED" ||
          notification.type === "REVIEW_REJECTED" ||
          notification.type === "REVIEW_CANCELLED" ||
          notification.type === "REVIEW_REMINDER"
        ) {
          if (data.projectId && data.entityType && data.entityId) {
            const entityPath =
              data.entityType === "CASE"
                ? `repository/${data.projectId}/${data.entityId}`
                : data.entityType === "RUN"
                  ? `runs/${data.projectId}/${data.entityId}`
                  : `sessions/${data.projectId}/${data.entityId}`;
            notificationUrl = `${baseUrl}/${urlLocale}/projects/${entityPath}`;
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
          // For system announcements, check if we have rich content or raw HTML
          if (data.htmlContent) {
            // Use raw HTML content (e.g., from upgrade notifications)
            htmlMessage = data.htmlContent;
          } else if (data.richContent && isTipTapContent(data.richContent)) {
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
            ? new Date(data.dueDate).toLocaleDateString(
                userLocale.replace("_", "-")
              )
            : "";
          translatedMessage = await getServerTranslation(
            userLocale,
            isOverdue
              ? "components.notifications.content.milestoneOverdue"
              : "components.notifications.content.milestoneDueSoon",
            {
              milestoneName: data.milestoneName,
              projectName: data.projectName,
              dueDate: formattedDueDate,
            }
          );
        } else if (notification.type === "GENERATE_FROM_URL_COMPLETE") {
          if (data.error) {
            translatedTitle = await getServerTranslation(
              userLocale,
              "components.notifications.content.generateFromUrlFailedTitle"
            );
            translatedMessage = notification.message;
          } else {
            translatedTitle = await getServerTranslation(
              userLocale,
              "components.notifications.content.generateFromUrlCompleteTitle"
            );
            translatedMessage = await getServerTranslation(
              userLocale,
              "components.notifications.content.generateFromUrlCompleteMessage",
              {
                pages: data.pagesProcessed ?? 0,
                url: data.url ?? "",
                projectName: data.projectName ?? "",
              }
            );
          }
        } else if (notification.type === "USER_REGISTERED") {
          translatedTitle = await getServerTranslation(
            userLocale,
            "components.notifications.content.userRegisteredTitle"
          );
          translatedMessage = await getServerTranslation(
            userLocale,
            data.registrationMethod === "sso"
              ? "components.notifications.content.userRegisteredMessageSso"
              : "components.notifications.content.userRegisteredMessageForm",
            {
              userName: data.newUserName ?? "",
              userEmail: data.newUserEmail ?? "",
            }
          );
        } else if (notification.type === "SHARE_LINK_ACCESSED") {
          const viewer =
            data.viewerName ||
            data.viewerEmail ||
            (await getServerTranslation(
              userLocale,
              "components.notifications.content.shareLinkAccessedAnonymousViewer"
            ));
          translatedTitle = await getServerTranslation(
            userLocale,
            "components.notifications.content.shareLinkAccessedTitle"
          );
          translatedMessage = await getServerTranslation(
            userLocale,
            "components.notifications.content.shareLinkAccessedMessage",
            {
              viewer,
              shareTitle: data.shareTitle ?? "",
            }
          );
        } else if (notification.type === "LLM_BUDGET_ALERT") {
          // LLM providers bill in USD; currency code is hardcoded
          // intentionally — see the matching note in NotificationContent.tsx.
          // Use the recipient's locale for grouping/decimal separators
          // (`Intl.NumberFormat` accepts BCP-47, so swap the
          // `en_US` underscore form to `en-US`).
          const intlLocale = userLocale.replace("_", "-");
          const formatAmount = (n: unknown): string => {
            if (typeof n !== "number") return String(n ?? "");
            return new Intl.NumberFormat(intlLocale, {
              style: "currency",
              currency: "USD",
            }).format(n);
          };
          const threshold = data.threshold;
          const isExceeded = typeof threshold === "number" && threshold >= 100;
          const spend = formatAmount(data.currentSpend);
          const budget = formatAmount(data.budgetLimit);
          translatedTitle = isExceeded
            ? await getServerTranslation(
                userLocale,
                "components.notifications.content.llmBudgetExceededTitle"
              )
            : await getServerTranslation(
                userLocale,
                "components.notifications.content.llmBudgetThresholdTitle",
                { threshold }
              );
          translatedMessage = isExceeded
            ? await getServerTranslation(
                userLocale,
                "components.notifications.content.llmBudgetExceededMessage",
                {
                  providerName: data.providerName ?? "",
                  spend,
                  budget,
                }
              )
            : await getServerTranslation(
                userLocale,
                "components.notifications.content.llmBudgetThresholdMessage",
                {
                  providerName: data.providerName ?? "",
                  threshold,
                  spend,
                  budget,
                }
              );
        } else if (
          notification.type === "REVIEW_REQUESTED" ||
          notification.type === "REVIEW_APPROVED" ||
          notification.type === "REVIEW_CHANGES_REQUESTED" ||
          notification.type === "REVIEW_REJECTED" ||
          notification.type === "REVIEW_CANCELLED" ||
          notification.type === "REVIEW_REMINDER"
        ) {
          const titleKeyByType = {
            REVIEW_REQUESTED: "reviewRequestedTitle",
            REVIEW_APPROVED: "reviewApprovedTitle",
            REVIEW_CHANGES_REQUESTED: "reviewChangesRequestedTitle",
            REVIEW_REJECTED: "reviewRejectedTitle",
            REVIEW_CANCELLED: "reviewCancelledTitle",
            REVIEW_REMINDER: "reviewReminderTitle",
          } as const;
          const emailMessageKeyByType = {
            REVIEW_REQUESTED: "reviewRequestedEmailMessage",
            REVIEW_APPROVED: "reviewApprovedEmailMessage",
            REVIEW_CHANGES_REQUESTED: "reviewChangesRequestedEmailMessage",
            REVIEW_REJECTED: "reviewRejectedEmailMessage",
            REVIEW_CANCELLED: "reviewCancelledEmailMessage",
            REVIEW_REMINDER: "reviewReminderEmailMessage",
          } as const;
          const entityLabelKey =
            data.entityType === "CASE"
              ? "reviewEntityLabelCase"
              : data.entityType === "RUN"
                ? "reviewEntityLabelRun"
                : "reviewEntityLabelSession";
          const entityLabel = await getServerTranslation(
            userLocale,
            `components.notifications.content.${entityLabelKey}`
          );
          translatedTitle = await getServerTranslation(
            userLocale,
            `components.notifications.content.${titleKeyByType[notification.type as keyof typeof titleKeyByType]}`
          );
          translatedMessage = await getServerTranslation(
            userLocale,
            `components.notifications.content.${emailMessageKeyByType[notification.type as keyof typeof emailMessageKeyByType]}`,
            {
              actorName:
                (notification.type === "REVIEW_REQUESTED"
                  ? data.requesterName
                  : notification.type === "REVIEW_REMINDER"
                    ? data.requesterName
                    : notification.type === "REVIEW_CANCELLED"
                      ? data.cancelerName
                      : data.deciderName) ?? "",
              entityLabel,
              entityName: data.entityName ?? "",
              projectName: data.projectName ?? "",
              hoursPending: data.hoursPending ?? 0,
            }
          );
          if (data.fromStateName && data.toStateName) {
            const transitionLine = await getServerTranslation(
              userLocale,
              "components.notifications.content.reviewTransition",
              { from: data.fromStateName, to: data.toStateName }
            );
            translatedMessage += `\n\n${transitionLine}`;
          }
          const reviewCommentText =
            notification.type === "REVIEW_REQUESTED"
              ? data.commentText
              : notification.type === "REVIEW_CANCELLED" ||
                  notification.type === "REVIEW_REMINDER"
                ? undefined
                : data.decisionComment;
          if (
            typeof reviewCommentText === "string" &&
            reviewCommentText.length > 0
          ) {
            const commentLine = await getServerTranslation(
              userLocale,
              "components.notifications.content.reviewCommentPreview",
              { comment: reviewCommentText }
            );
            translatedMessage += `\n\n${commentLine}`;
          }
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
        const user = await db.user.findUnique({
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
        const fullNotifications = await db.notification.findMany({
          where: {
            id: { in: digestData.notifications.map((n) => n.id) },
          },
        });

        // Build URLs and translate content for each notification
        // In multi-tenant mode, use the tenant's baseUrl from config
        const digestTenantConfig = digestData.tenantId
          ? getTenantConfig(digestData.tenantId)
          : undefined;
        const digestBaseUrl =
          digestTenantConfig?.baseUrl ||
          process.env.NEXTAUTH_URL ||
          "http://localhost:3000";
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
                if (
                  data.entityType === "RepositoryCase" &&
                  data.repositoryCaseId
                ) {
                  url = `${baseUrl}/${urlLocale}/projects/repository/${data.projectId}/${data.repositoryCaseId}`;
                } else if (data.entityType === "TestRun" && data.testRunId) {
                  url = `${baseUrl}/${urlLocale}/projects/runs/${data.projectId}/${data.testRunId}`;
                } else if (data.entityType === "Session" && data.sessionId) {
                  url = `${baseUrl}/${urlLocale}/projects/sessions/${data.projectId}/${data.sessionId}`;
                } else if (
                  data.entityType === "Milestone" &&
                  data.milestoneId
                ) {
                  url = `${baseUrl}/${urlLocale}/projects/milestones/${data.projectId}/${data.milestoneId}`;
                }
              }
            } else if (notification.type === "MILESTONE_DUE_REMINDER") {
              // Milestone due reminder
              if (data.projectId && data.milestoneId) {
                url = `${baseUrl}/${urlLocale}/projects/milestones/${data.projectId}/${data.milestoneId}`;
              }
            } else if (notification.type === "GENERATE_FROM_URL_COMPLETE") {
              if (data.projectId && data.jobId && !data.error) {
                url = `${baseUrl}/${urlLocale}/projects/repository/${data.projectId}?urlJobId=${data.jobId}`;
              }
            } else if (
              notification.type === "REVIEW_REQUESTED" ||
              notification.type === "REVIEW_APPROVED" ||
              notification.type === "REVIEW_CHANGES_REQUESTED" ||
              notification.type === "REVIEW_REJECTED" ||
              notification.type === "REVIEW_CANCELLED" ||
              notification.type === "REVIEW_REMINDER"
            ) {
              if (data.projectId && data.entityType && data.entityId) {
                const entityPath =
                  data.entityType === "CASE"
                    ? `repository/${data.projectId}/${data.entityId}`
                    : data.entityType === "RUN"
                      ? `runs/${data.projectId}/${data.entityId}`
                      : `sessions/${data.projectId}/${data.entityId}`;
                url = `${baseUrl}/${urlLocale}/projects/${entityPath}`;
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
                ? new Date(data.dueDate).toLocaleDateString(
                    userLocale.replace("_", "-")
                  )
                : "";
              translatedMessage = await getServerTranslation(
                userLocale,
                isOverdue
                  ? "components.notifications.content.milestoneOverdue"
                  : "components.notifications.content.milestoneDueSoon",
                {
                  milestoneName: data.milestoneName,
                  projectName: data.projectName,
                  dueDate: formattedDueDate,
                }
              );
            } else if (notification.type === "GENERATE_FROM_URL_COMPLETE") {
              if (data.error) {
                translatedTitle = await getServerTranslation(
                  userLocale,
                  "components.notifications.content.generateFromUrlFailedTitle"
                );
              } else {
                translatedTitle = await getServerTranslation(
                  userLocale,
                  "components.notifications.content.generateFromUrlCompleteTitle"
                );
                translatedMessage = await getServerTranslation(
                  userLocale,
                  "components.notifications.content.generateFromUrlCompleteMessage",
                  {
                    pages: data.pagesProcessed ?? 0,
                    url: data.url ?? "",
                    projectName: data.projectName ?? "",
                  }
                );
              }
            } else if (
              notification.type === "REVIEW_REQUESTED" ||
              notification.type === "REVIEW_APPROVED" ||
              notification.type === "REVIEW_CHANGES_REQUESTED" ||
              notification.type === "REVIEW_REJECTED" ||
              notification.type === "REVIEW_CANCELLED" ||
              notification.type === "REVIEW_REMINDER"
            ) {
              const titleKeyByType = {
                REVIEW_REQUESTED: "reviewRequestedTitle",
                REVIEW_APPROVED: "reviewApprovedTitle",
                REVIEW_CHANGES_REQUESTED: "reviewChangesRequestedTitle",
                REVIEW_REJECTED: "reviewRejectedTitle",
                REVIEW_CANCELLED: "reviewCancelledTitle",
                REVIEW_REMINDER: "reviewReminderTitle",
              } as const;
              const emailMessageKeyByType = {
                REVIEW_REQUESTED: "reviewRequestedEmailMessage",
                REVIEW_APPROVED: "reviewApprovedEmailMessage",
                REVIEW_CHANGES_REQUESTED: "reviewChangesRequestedEmailMessage",
                REVIEW_REJECTED: "reviewRejectedEmailMessage",
                REVIEW_CANCELLED: "reviewCancelledEmailMessage",
                REVIEW_REMINDER: "reviewReminderEmailMessage",
              } as const;
              const entityLabelKey =
                data.entityType === "CASE"
                  ? "reviewEntityLabelCase"
                  : data.entityType === "RUN"
                    ? "reviewEntityLabelRun"
                    : "reviewEntityLabelSession";
              const entityLabel = await getServerTranslation(
                userLocale,
                `components.notifications.content.${entityLabelKey}`
              );
              translatedTitle = await getServerTranslation(
                userLocale,
                `components.notifications.content.${titleKeyByType[notification.type as keyof typeof titleKeyByType]}`
              );
              translatedMessage = await getServerTranslation(
                userLocale,
                `components.notifications.content.${emailMessageKeyByType[notification.type as keyof typeof emailMessageKeyByType]}`,
                {
                  actorName:
                    (notification.type === "REVIEW_REQUESTED"
                      ? data.requesterName
                      : notification.type === "REVIEW_REMINDER"
                        ? data.requesterName
                        : notification.type === "REVIEW_CANCELLED"
                          ? data.cancelerName
                          : data.deciderName) ?? "",
                  entityLabel,
                  entityName: data.entityName ?? "",
                  projectName: data.projectName ?? "",
                  hoursPending: data.hoursPending ?? 0,
                }
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
        await db.notification.updateMany({
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
    worker = new Worker(EMAIL_QUEUE_NAME, withTenantContext(processor), {
      connection: valkeyConnection as any,
      prefix: BULLMQ_PREFIX,
      concurrency: parseInt(process.env.EMAIL_CONCURRENCY || "3", 10),
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
  const shutdown = async () => {
    console.log("Shutting down email worker...");
    if (worker) {
      await worker.close();
    }
    // Disconnect all tenant Prisma clients in multi-tenant mode
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

// Run the worker only when this file is executed directly (not on require)
if (require.main === module) {
  console.log("Email worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start email worker:", err);
    process.exit(1);
  });
}

export default worker;
export { processor, startWorker };

"use client";

import { MilestoneNameDisplay } from "@/components/MilestoneNameDisplay";
import { SessionNameDisplay } from "@/components/SessionNameDisplay";
import { ProjectNameCell } from "@/components/tables/ProjectNameCell";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { TestCaseNameDisplay } from "@/components/TestCaseNameDisplay";
import { TestRunNameDisplay } from "@/components/TestRunNameDisplay";
import TextFromJson from "@/components/TextFromJson";
import { ExternalLink, Megaphone } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "~/lib/navigation";

interface NotificationContentProps {
  notification: any;
}

export function NotificationContent({
  notification,
}: NotificationContentProps) {
  const locale = useLocale();
  const t = useTranslations("components.notifications.content");
  const tMilestones = useTranslations("milestones.notifications");

  // Get notification data (Prisma automatically deserializes JSON fields)
  const data = notification.data || {};

  // Handle test run case assignments
  if (notification.type === "WORK_ASSIGNED" && !data.isBulkAssignment) {
    // Check if we have the new data structure with all IDs
    if (data.testRunId && data.projectId && data.testCaseId) {
      const testRunLink = `/projects/runs/${data.projectId}/${data.testRunId}?selectedCase=${data.testCaseId}`;

      return (
        <div className="space-y-2">
          <h4 className="font-medium text-sm">
            {t("testCaseAssignmentTitle")}
          </h4>
          <div className="text-sm text-muted-foreground space-y-1">
            <div className="flex items-center gap-1 flex-wrap">
              <UserNameCell userId={data.assignedById} hideLink />
              <span>{t("assignedTestCase")}</span>
            </div>
            <div className="flex items-center gap-1">
              <Link
                href={testRunLink}
                className="font-medium text-primary hover:underline inline-flex items-center gap-1"
              >
                <TestCaseNameDisplay
                  testCase={{
                    id: data.testCaseId,
                    name: data.testCaseName || data.entityName,
                  }}
                  showIcon={true}
                />
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <span>{t("inProject")}</span>
              <ProjectNameCell
                projectId={data.projectId}
                value={data.projectName}
                size="sm"
              />
            </div>
          </div>
        </div>
      );
    }

    // Fallback for old notifications without full data
    return (
      <div className="space-y-1">
        <h4 className="font-medium text-sm">{notification.title}</h4>
        <p className="text-sm text-muted-foreground">{notification.message}</p>
      </div>
    );
  }

  // Handle bulk test case assignments
  if (notification.type === "WORK_ASSIGNED" && data.isBulkAssignment) {
    return (
      <div className="space-y-2">
        <h4 className="font-medium text-sm">
          {t("multipleTestCaseAssignmentTitle")}
        </h4>
        <div className="text-sm text-muted-foreground space-y-1">
          <div className="flex items-center gap-1 flex-wrap">
            <UserNameCell userId={data.assignedById} hideLink />
            <span>{t("assignedMultipleTestCases", { count: data.count })}</span>
          </div>
          {data.testRunGroups &&
            data.testRunGroups.map((group: any) => (
              <div
                key={group.testRunId}
                className="mt-2 pl-2 border-l-2 border-muted"
              >
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-xs">{t("testRun")}</span>
                  <Link
                    href={`/projects/runs/${group.projectId}/${group.testRunId}`}
                    className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
                  >
                    <TestRunNameDisplay
                      testRun={{
                        id: group.testRunId,
                        name: group.testRunName,
                      }}
                      showIcon={true}
                    />
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {t("casesInProject", { count: group.testCases.length })}
                  <ProjectNameCell
                    projectId={group.projectId}
                    value={group.projectName}
                    size="sm"
                  />
                </div>
              </div>
            ))}
        </div>
      </div>
    );
  }

  // Handle session assignments
  if (notification.type === "SESSION_ASSIGNED") {
    // Check if we have the new data structure with all IDs
    if (data.projectId && data.sessionId) {
      const sessionLink = `/projects/sessions/${data.projectId}/${data.sessionId}`;

      return (
        <div className="space-y-2">
          <h4 className="font-medium text-sm">{t("sessionAssignmentTitle")}</h4>
          <div className="text-sm text-muted-foreground space-y-1">
            <div className="flex items-center gap-1 flex-wrap">
              <UserNameCell userId={data.assignedById} hideLink />
              <span>{t("assignedSession")}</span>
            </div>
            <div className="flex items-center gap-1">
              <Link
                href={sessionLink}
                className="font-medium text-primary hover:underline inline-flex items-center gap-1"
              >
                <SessionNameDisplay
                  session={{
                    id: data.sessionId,
                    name: data.sessionName || data.entityName,
                  }}
                  showIcon={true}
                />
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <span>{t("inProject")}</span>
              <ProjectNameCell
                projectId={data.projectId}
                value={data.projectName}
                size="sm"
              />
            </div>
          </div>
        </div>
      );
    }

    // Fallback for old notifications without full data
    return (
      <div className="space-y-1">
        <h4 className="font-medium text-sm">{notification.title}</h4>
        <p className="text-sm text-muted-foreground">{notification.message}</p>
      </div>
    );
  }

  // Handle comment mentions
  if (notification.type === "COMMENT_MENTION") {
    // Check if we have the data structure with all IDs
    if (data.projectId && data.hasProjectAccess) {
      let entityLink = "";
      let entityNameDisplay = null;

      // Build link based on entity type
      if (data.entityType === "RepositoryCase" && data.repositoryCaseId) {
        entityLink = `/projects/repository/${data.projectId}/${data.repositoryCaseId}`;
        entityNameDisplay = (
          <TestCaseNameDisplay
            testCase={{
              id: data.repositoryCaseId,
              name: data.testCaseName || data.entityName,
            }}
            showIcon={true}
          />
        );
      } else if (data.entityType === "TestRun" && data.testRunId) {
        entityLink = `/projects/runs/${data.projectId}/${data.testRunId}`;
        entityNameDisplay = (
          <TestRunNameDisplay
            testRun={{
              id: data.testRunId,
              name: data.testRunName || data.entityName,
            }}
            showIcon={true}
          />
        );
      } else if (data.entityType === "Session" && data.sessionId) {
        entityLink = `/projects/sessions/${data.projectId}/${data.sessionId}`;
        entityNameDisplay = (
          <SessionNameDisplay
            session={{
              id: data.sessionId,
              name: data.sessionName || data.entityName,
            }}
            showIcon={true}
          />
        );
      } else if (data.entityType === "Milestone" && data.milestoneId) {
        entityLink = `/projects/milestones/${data.projectId}/${data.milestoneId}`;
        entityNameDisplay = (
          <MilestoneNameDisplay
            milestone={{
              id: data.milestoneId,
              name: data.milestoneName || data.entityName,
              milestoneTypeIconName: data.milestoneTypeIconName,
            }}
            showIcon={true}
          />
        );
      }

      return (
        <div className="space-y-2">
          <h4 className="font-medium text-sm">{t("commentMentionTitle")}</h4>
          <div className="text-sm text-muted-foreground space-y-1">
            <div className="flex items-center gap-1 flex-wrap">
              <UserNameCell userId={data.creatorId} hideLink />
              <span>{t("mentionedYouInComment")}</span>
            </div>
            {entityLink && (
              <div className="flex items-center gap-1">
                <Link
                  href={entityLink}
                  className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                >
                  {entityNameDisplay}
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            )}
            <div className="flex items-center gap-1 flex-wrap">
              <span>{t("inProject")}</span>
              <ProjectNameCell
                projectId={data.projectId}
                value={data.projectName}
                size="sm"
              />
            </div>
          </div>
        </div>
      );
    }

    // Fallback for notifications without access or old format
    return (
      <div className="space-y-1">
        <h4 className="font-medium text-sm">{notification.title}</h4>
        <p className="text-sm text-muted-foreground">{notification.message}</p>
      </div>
    );
  }

  // Handle milestone due reminders
  if (notification.type === "MILESTONE_DUE_REMINDER") {
    // Check if we have the data structure with all IDs
    if (data.projectId && data.milestoneId) {
      const milestoneLink = `/projects/milestones/${data.projectId}/${data.milestoneId}`;
      const isOverdue = data.isOverdue;
      const dueDate = data.dueDate
        ? new Date(data.dueDate).toLocaleDateString(locale)
        : "";

      return (
        <div className="space-y-2">
          <h4 className="font-medium text-sm">
            {isOverdue
              ? t("milestoneOverdueTitle")
              : t("milestoneDueSoonTitle")}
          </h4>
          <div className="text-sm text-muted-foreground space-y-1">
            <div className="flex items-center gap-1 flex-wrap">
              <Link
                href={milestoneLink}
                className="font-medium text-primary hover:underline inline-flex items-center gap-1"
              >
                <MilestoneNameDisplay
                  milestone={{
                    id: data.milestoneId,
                    name: data.milestoneName,
                    milestoneTypeIconName: data.milestoneTypeIconName,
                  }}
                  showIcon={true}
                />
                <ExternalLink className="h-3 w-3" />
              </Link>
              <span>{t("inProject")}</span>
              <ProjectNameCell
                projectId={data.projectId}
                value={data.projectName}
                size="sm"
              />
            </div>
            <div className="text-xs">
              {isOverdue
                ? tMilestones("overdue", { name: data.milestoneName, dueDate })
                : tMilestones("dueSoon", { name: data.milestoneName, dueDate })}
            </div>
          </div>
        </div>
      );
    }

    // Fallback for old notifications without full data
    return (
      <div className="space-y-1">
        <h4 className="font-medium text-sm">{notification.title}</h4>
        <p className="text-sm text-muted-foreground">{notification.message}</p>
      </div>
    );
  }

  // Handle share link accessed notifications
  if (notification.type === "SHARE_LINK_ACCESSED") {
    if (data.shareLinkId) {
      const viewedAt = data.viewedAt
        ? new Date(data.viewedAt).toLocaleDateString(locale, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : "";
      const viewer =
        data.viewerName ||
        data.viewerEmail ||
        t("shareLinkAccessedAnonymousViewer");

      return (
        <div className="space-y-2">
          <h4 className="font-medium text-sm">{t("shareLinkAccessedTitle")}</h4>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              {t("shareLinkAccessedMessage", {
                viewer,
                shareTitle: data.shareTitle ?? "",
              })}
            </p>
            {viewedAt && (
              <p className="text-xs">
                {t("viewedAt")}: {viewedAt}
              </p>
            )}
            {data.projectId && (
              <div className="flex items-center gap-1 flex-wrap">
                <span>{t("inProject")}:</span>
                <ProjectNameCell
                  projectId={data.projectId}
                  value=""
                  size="sm"
                />
              </div>
            )}
          </div>
        </div>
      );
    }

    // Fallback for notifications without complete data
    return (
      <div className="space-y-1">
        <h4 className="font-medium text-sm">{notification.title}</h4>
        <p className="text-sm text-muted-foreground">{notification.message}</p>
      </div>
    );
  }

  // Handle LLM budget alerts
  if (notification.type === "LLM_BUDGET_ALERT") {
    const threshold = data.threshold;
    const isExceeded = typeof threshold === "number" && threshold >= 100;
    // LLM providers (OpenAI/Anthropic/Google) bill in USD. The currency
    // code is hardcoded here intentionally; multi-currency support
    // would require tracking the provider's billing currency in the
    // LlmIntegration model.
    const fmt =
      typeof Intl !== "undefined"
        ? new Intl.NumberFormat(locale, {
            style: "currency",
            currency: "USD",
          })
        : null;
    const formatAmount = (n: unknown): string => {
      if (typeof n !== "number") {
        // Older notification rows may have stored the amount as a
        // pre-formatted string (e.g. "1234.56"). Render as-is so the
        // bell doesn't show "NaN" until the row ages out.
        return String(n ?? "");
      }
      return fmt ? fmt.format(n) : `$${n.toFixed(2)}`;
    };
    const spend = formatAmount(data.currentSpend);
    const budget = formatAmount(data.budgetLimit);
    const providerName = data.providerName ?? "";

    if (data.providerName == null || data.threshold == null) {
      // Old-shape fallback — render the persisted text rather than
      // attempt to compose from a partial payload.
      return (
        <div className="space-y-2">
          <h4 className="font-medium text-sm">{notification.title}</h4>
          <div className="text-sm text-muted-foreground">
            <p>{notification.message}</p>
            <p className="text-xs mt-2">{t("budgetDisclaimer")}</p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <h4 className="font-medium text-sm">
          {isExceeded
            ? t("llmBudgetExceededTitle")
            : t("llmBudgetThresholdTitle", { threshold })}
        </h4>
        <div className="text-sm text-muted-foreground">
          <p>
            {isExceeded
              ? t("llmBudgetExceededMessage", {
                  providerName,
                  spend,
                  budget,
                })
              : t("llmBudgetThresholdMessage", {
                  providerName,
                  threshold,
                  spend,
                  budget,
                })}
          </p>
          <p className="text-xs mt-2">{t("budgetDisclaimer")}</p>
        </div>
      </div>
    );
  }

  // Handle new-user-registration notifications (sent to system admins).
  if (notification.type === "USER_REGISTERED") {
    if (data.newUserName && data.newUserEmail) {
      const messageKey =
        data.registrationMethod === "sso"
          ? "userRegisteredMessageSso"
          : "userRegisteredMessageForm";
      return (
        <div className="space-y-2">
          <h4 className="font-medium text-sm">{t("userRegisteredTitle")}</h4>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              {t(messageKey, {
                userName: data.newUserName,
                userEmail: data.newUserEmail,
              })}
            </p>
            <div className="flex items-center gap-1">
              <Link
                href="/admin/users"
                className="font-medium text-primary hover:underline inline-flex items-center gap-1"
              >
                {t("viewUserList")}
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      );
    }
    // Fallback for older notifications without complete data.
    return (
      <div className="space-y-1">
        <h4 className="font-medium text-sm">{notification.title}</h4>
        <p className="text-sm text-muted-foreground">{notification.message}</p>
      </div>
    );
  }

  // Handle review request + review-decision notifications. All four types
  // share the same entity / project / transition rendering; the title and
  // subject phrasing differ per type. Persisted `title` and `message` are
  // fallback-only — the renderer composes localized copy from the data
  // payload at display time (see workers/emailWorker.ts for the matching
  // server-side composition).
  if (
    notification.type === "REVIEW_REQUESTED" ||
    notification.type === "REVIEW_APPROVED" ||
    notification.type === "REVIEW_CHANGES_REQUESTED" ||
    notification.type === "REVIEW_REJECTED"
  ) {
    if (data.projectId && data.entityType && data.entityId) {
      const entityLink =
        data.entityType === "CASE"
          ? `/projects/repository/${data.projectId}/${data.entityId}`
          : data.entityType === "RUN"
            ? `/projects/runs/${data.projectId}/${data.entityId}`
            : `/projects/sessions/${data.projectId}/${data.entityId}`;

      const entityNameDisplay =
        data.entityType === "CASE" ? (
          <TestCaseNameDisplay
            testCase={{ id: data.entityId, name: data.entityName }}
            showIcon={true}
          />
        ) : data.entityType === "RUN" ? (
          <TestRunNameDisplay
            testRun={{ id: data.entityId, name: data.entityName }}
            showIcon={true}
          />
        ) : (
          <SessionNameDisplay
            session={{ id: data.entityId, name: data.entityName }}
            showIcon={true}
          />
        );

      let title: string;
      let action: string;
      let actorUserId: string | undefined;
      if (notification.type === "REVIEW_REQUESTED") {
        title = t("reviewRequestedTitle");
        action = t("reviewRequestedAction");
        actorUserId = data.requesterUserId;
      } else if (notification.type === "REVIEW_APPROVED") {
        title = t("reviewApprovedTitle");
        action = t("reviewApprovedAction");
        actorUserId = data.deciderUserId;
      } else if (notification.type === "REVIEW_CHANGES_REQUESTED") {
        title = t("reviewChangesRequestedTitle");
        action = t("reviewChangesRequestedAction");
        actorUserId = data.deciderUserId;
      } else {
        title = t("reviewRejectedTitle");
        action = t("reviewRejectedAction");
        actorUserId = data.deciderUserId;
      }

      const commentText =
        notification.type === "REVIEW_REQUESTED"
          ? data.commentText
          : data.decisionComment;

      return (
        <div className="space-y-2">
          <h4 className="font-medium text-sm">{title}</h4>
          <div className="text-sm text-muted-foreground space-y-1">
            <div className="flex items-center gap-1 flex-wrap">
              {actorUserId && <UserNameCell userId={actorUserId} hideLink />}
              <span>{action}</span>
            </div>
            <div className="flex items-center gap-1">
              <Link
                href={entityLink}
                className="font-medium text-primary hover:underline inline-flex items-center gap-1"
              >
                {entityNameDisplay}
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <span>{t("inProject")}</span>
              <ProjectNameCell
                projectId={data.projectId}
                value={data.projectName}
                size="sm"
              />
            </div>
            {data.fromStateName && data.toStateName && (
              <div className="text-xs">
                {t("reviewTransition", {
                  from: data.fromStateName,
                  to: data.toStateName,
                })}
              </div>
            )}
            {typeof commentText === "string" && commentText.length > 0 && (
              <div className="text-xs italic line-clamp-2">
                {t("reviewCommentPreview", { comment: commentText })}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Fallback for notifications without complete data.
    return (
      <div className="space-y-1">
        <h4 className="font-medium text-sm">{notification.title}</h4>
        <p className="text-sm text-muted-foreground">{notification.message}</p>
      </div>
    );
  }

  // Handle system announcements
  if (notification.type === "SYSTEM_ANNOUNCEMENT") {
    const hasRichContent = notification.data?.richContent;
    const hasHtmlContent = notification.data?.htmlContent;

    return (
      <div className="space-y-2">
        <div className="flex items-start -mt-1 gap-2">
          <Megaphone className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <h4 className="font-medium text-sm">{notification.title}</h4>
        </div>
        <div className="space-y-1">
          {hasHtmlContent ? (
            <div
              className="text-sm text-muted-foreground prose prose-sm dark:prose-invert max-w-none prose-headings:text-foreground prose-strong:text-foreground prose-strong:font-semibold prose-a:text-primary prose-a:underline"
              dangerouslySetInnerHTML={{
                __html: notification.data.htmlContent,
              }}
            />
          ) : hasRichContent ? (
            <div className="text-sm text-muted-foreground">
              <TextFromJson
                jsonString={JSON.stringify(notification.data.richContent)}
                format="html"
                room="notification"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {notification.message}
            </p>
          )}
          {notification.data?.sentByName && (
            <p className="text-xs text-muted-foreground mt-2">
              {t("sentBy", { name: notification.data.sentByName })}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Handle URL generation completion
  if (notification.type === "GENERATE_FROM_URL_COMPLETE") {
    if (data.projectId && data.jobId) {
      const reviewLink = `/projects/repository/${data.projectId}?urlJobId=${data.jobId}`;
      const isFailure = data.error === true;

      return (
        <div className="space-y-2">
          <h4 className="font-medium text-sm">{notification.title}</h4>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>{notification.message}</p>
            {data.url && <p className="text-xs truncate">{data.url}</p>}
            {!isFailure && (
              <div className="flex items-center gap-1">
                <Link
                  href={reviewLink}
                  className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                >
                  {t("reviewGeneratedCases")}
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            )}
            {data.projectName && (
              <div className="flex items-center gap-1 flex-wrap">
                <span>{t("inProject")}</span>
                <ProjectNameCell
                  projectId={data.projectId}
                  value={data.projectName}
                  size="sm"
                />
              </div>
            )}
          </div>
        </div>
      );
    }

    // Fallback for notifications without complete data
    return (
      <div className="space-y-1">
        <h4 className="font-medium text-sm">{notification.title}</h4>
        <p className="text-sm text-muted-foreground">{notification.message}</p>
      </div>
    );
  }

  // Fallback for other notification types
  return (
    <div className="space-y-1">
      <h4 className="font-medium text-sm">{notification.title}</h4>
      <p className="text-sm text-muted-foreground">{notification.message}</p>
    </div>
  );
}

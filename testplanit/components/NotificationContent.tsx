"use client";

import React from "react";
import { Link } from "~/lib/navigation";
import { useLocale, useTranslations } from "next-intl";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { ProjectNameCell } from "@/components/tables/ProjectNameCell";
import { TestCaseNameDisplay } from "@/components/TestCaseNameDisplay";
import { SessionNameDisplay } from "@/components/SessionNameDisplay";
import { TestRunNameDisplay } from "@/components/TestRunNameDisplay";
import { MilestoneNameDisplay } from "@/components/MilestoneNameDisplay";
import { ExternalLink, Megaphone } from "lucide-react";
import TextFromJson from "@/components/TextFromJson";

interface NotificationContentProps {
  notification: any;
}

export function NotificationContent({
  notification,
}: NotificationContentProps) {
  const locale = useLocale();
  const t = useTranslations("components.notifications.content");

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

  // Handle system announcements
  if (notification.type === "SYSTEM_ANNOUNCEMENT") {
    const hasRichContent = notification.data?.richContent;
    const hasHtmlContent = notification.data?.htmlContent;

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-blue-500" />
          <h4 className="font-medium text-sm">{notification.title}</h4>
        </div>
        <div className="space-y-1">
          {hasHtmlContent ? (
            <div
              className="text-sm text-muted-foreground prose prose-sm dark:prose-invert max-w-none prose-strong:text-foreground prose-strong:font-semibold"
              dangerouslySetInnerHTML={{ __html: notification.data.htmlContent }}
            />
          ) : hasRichContent ? (
            <div className="text-sm text-muted-foreground">
              <TextFromJson
                jsonString={JSON.stringify(notification.data.richContent)}
                format="html"
                room="notification"
                expand={false}
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

  // Fallback for other notification types
  return (
    <div className="space-y-1">
      <h4 className="font-medium text-sm">{notification.title}</h4>
      <p className="text-sm text-muted-foreground">{notification.message}</p>
    </div>
  );
}

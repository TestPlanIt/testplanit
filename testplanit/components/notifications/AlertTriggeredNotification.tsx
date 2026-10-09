"use client";

import { BellRing, ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { MilestoneNameDisplay } from "@/components/MilestoneNameDisplay";
import { ProjectNameCell } from "@/components/tables/ProjectNameCell";
import { TestRunNameDisplay } from "@/components/TestRunNameDisplay";
import { Link } from "~/lib/navigation";
import {
  alertMetricMessage,
  alertSubjectPath,
  type AlertNotificationData,
} from "~/lib/alerts/notificationParams";

/**
 * Bell rendering of a ALERT_TRIGGERED notification: the rule, what was
 * observed, and a link to the subject in its project. Leaving the rule's
 * audience is done from the Notifications & Alerts page.
 */
export function AlertTriggeredNotification({
  data,
}: {
  data: AlertNotificationData;
}) {
  const t = useTranslations("components.notifications.content");
  const locale = useLocale();

  const message = alertMetricMessage(data, locale);
  const path = alertSubjectPath(data);

  const subject = (() => {
    if (!data.subjectId) return null;
    if (data.subjectType === "CASE") {
      return (
        <CaseDisplay
          testCase={{ id: data.subjectId, name: data.subjectName ?? "" }}
          showIcon={true}
        />
      );
    }
    if (data.subjectType === "RUN") {
      return (
        <TestRunNameDisplay
          testRun={{ id: data.subjectId, name: data.subjectName ?? "" }}
          showIcon={true}
        />
      );
    }
    if (data.subjectType === "MILESTONE") {
      return (
        <MilestoneNameDisplay
          milestone={{ id: data.subjectId, name: data.subjectName ?? "" }}
          showIcon={true}
        />
      );
    }
    return <span>{data.subjectName}</span>;
  })();

  return (
    <div className="space-y-2" data-testid="notification-alert-triggered">
      <h4 className="flex items-center gap-1.5 text-sm font-medium">
        <BellRing className="h-4 w-4 shrink-0 text-primary" />
        {data.ruleName ?? ""}
      </h4>
      <div className="text-sm text-muted-foreground space-y-1">
        <p data-testid="notification-alert-detail">
          {t(message.key as never, message.params as never)}
        </p>
        <div className="flex items-center gap-1 flex-wrap">
          {subject &&
            (path ? (
              <Link
                href={path}
                data-testid="notification-alert-subject-link"
                className="font-medium text-primary hover:underline inline-flex items-center gap-1"
              >
                {subject}
                <ExternalLink className="h-3 w-3" />
              </Link>
            ) : (
              subject
            ))}
          {data.projectId && (
            <>
              <span>{t("inProject")}</span>
              <ProjectNameCell
                projectId={data.projectId}
                value={data.projectName ?? ""}
                size="sm"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import {
  BellRing,
  ExternalLink,
  GitBranch,
  ListChecks,
  Plug,
  Server,
  Sparkles,
  Webhook,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { MilestoneNameDisplay } from "@/components/MilestoneNameDisplay";
import { SessionNameDisplay } from "@/components/SessionNameDisplay";
import { ProjectNameCell } from "@/components/tables/ProjectNameCell";
import { TestRunNameDisplay } from "@/components/TestRunNameDisplay";
import { Link } from "~/lib/navigation";
import {
  alertMetricMessage,
  alertSubjectPath,
  type AlertNotificationData,
} from "~/lib/alerts/notificationParams";
import { isSystemSubjectType } from "~/lib/alerts/subjectPath";
import { useQueueDisplayName } from "@/components/admin/useQueueDisplayName";

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
  const tSystem = useTranslations("alerts.systemSubjects");
  const queueLabel = useQueueDisplayName();
  const locale = useLocale();

  const message = alertMetricMessage(data, locale);
  const path = alertSubjectPath(data);

  const subject = (() => {
    // A webhook subject is keyed by its config id, not an integer, so it
    // carries subjectId 0 and is identified by its name instead.
    if (data.subjectType === "WEBHOOK") {
      return data.subjectName ? (
        <span className="inline-flex items-center gap-1">
          <Webhook className="h-4 w-4 shrink-0" />
          {data.subjectName}
        </span>
      ) : null;
    }
    // A system alert's subject: named, linked into Administration.
    if (isSystemSubjectType(data.subjectType)) {
      const Icon =
        data.subjectType === "LLM_INTEGRATION"
          ? Sparkles
          : data.subjectType === "CODE_REPOSITORY"
            ? GitBranch
            : data.subjectType === "INTEGRATION"
              ? Plug
              : data.subjectType === "QUEUE"
                ? ListChecks
                : Server;
      const ref = data.subjectRef ?? "";
      const label =
        data.subjectType === "SYSTEM" && ref && tSystem.has(ref as never)
          ? tSystem(ref as never)
          : data.subjectType === "QUEUE" && ref
            ? queueLabel(ref)
            : data.subjectName;
      return label ? (
        <span className="inline-flex items-center gap-1">
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </span>
      ) : null;
    }
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
    if (data.subjectType === "SESSION") {
      return (
        <SessionNameDisplay
          session={{ id: data.subjectId, name: data.subjectName ?? "" }}
          showIcon={true}
        />
      );
    }
    // A project-wide metric's subject is the project, which the card already
    // names below; nothing to repeat here.
    if (data.subjectType === "PROJECT") return null;
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

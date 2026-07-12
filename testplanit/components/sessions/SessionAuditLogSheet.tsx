"use client";

import { ScopedAuditLogSheet } from "@/components/audit/ScopedAuditLogSheet";
import { useTranslations } from "next-intl";

interface SessionAuditLogSheetProps {
  sessionId: number;
}

/**
 * Activity-history sheet for a single exploratory session. Thin wrapper over the
 * shared ScopedAuditLogSheet; visibility is enforced by the AuditLog read
 * policy, which grants session audit access to anyone who can read the session's
 * project.
 */
export function SessionAuditLogSheet({ sessionId }: SessionAuditLogSheetProps) {
  const t = useTranslations("sessions.auditLog");
  const tCommon = useTranslations("common");

  return (
    <ScopedAuditLogSheet
      entityType="Sessions"
      entityId={String(sessionId)}
      triggerLabel={t("trigger")}
      title={tCommon("fields.activityLog")}
      description={t("description")}
      triggerTestId="session-history-trigger"
      tableTestIdPrefix="session-audit-log-table"
      rowTestIdPrefix="session-audit-log-row"
    />
  );
}

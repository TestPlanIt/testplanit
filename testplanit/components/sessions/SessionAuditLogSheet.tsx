"use client";

import { ScopedAuditLogSheet } from "@/components/audit/ScopedAuditLogSheet";
import { useTranslations } from "next-intl";

interface SessionAuditLogSheetProps {
  sessionId: number;
  /** Hide the built-in trigger and drive the sheet from external `open` state. */
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Activity-history sheet for a single exploratory session. Thin wrapper over the
 * shared ScopedAuditLogSheet; visibility is enforced by the AuditLog read
 * policy, which grants session audit access to anyone who can read the session's
 * project.
 */
export function SessionAuditLogSheet({
  sessionId,
  hideTrigger,
  open,
  onOpenChange,
}: SessionAuditLogSheetProps) {
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
      hideTrigger={hideTrigger}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

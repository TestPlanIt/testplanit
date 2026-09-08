"use client";

import { ScopedAuditLogSheet } from "@/components/audit/ScopedAuditLogSheet";
import { useTranslations } from "next-intl";

interface RunAuditLogSheetProps {
  runId: number;
  /** Hide the built-in trigger and drive the sheet from external `open` state. */
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Activity-history sheet for a single test run. Thin wrapper over the shared
 * ScopedAuditLogSheet; visibility is enforced by the AuditLog read policy, which
 * grants run audit access to anyone who can read the run's project.
 */
export function RunAuditLogSheet({
  runId,
  hideTrigger,
  open,
  onOpenChange,
}: RunAuditLogSheetProps) {
  const t = useTranslations("runs.auditLog");
  const tCommon = useTranslations("common");

  return (
    <ScopedAuditLogSheet
      entityType="TestRuns"
      entityId={String(runId)}
      triggerLabel={t("trigger")}
      title={tCommon("fields.activityLog")}
      description={t("description")}
      triggerTestId="run-history-trigger"
      tableTestIdPrefix="run-audit-log-table"
      rowTestIdPrefix="run-audit-log-row"
      hideTrigger={hideTrigger}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

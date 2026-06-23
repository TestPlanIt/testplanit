"use client";

import { ScopedAuditLogSheet } from "@/components/audit/ScopedAuditLogSheet";
import { useTranslations } from "next-intl";

interface RunAuditLogSheetProps {
  runId: number;
}

/**
 * Activity-history sheet for a single test run. Thin wrapper over the shared
 * ScopedAuditLogSheet; visibility is enforced by the AuditLog read policy, which
 * grants run audit access to anyone who can read the run's project.
 */
export function RunAuditLogSheet({ runId }: RunAuditLogSheetProps) {
  const t = useTranslations("runs.auditLog");

  return (
    <ScopedAuditLogSheet
      entityType="TestRuns"
      entityId={String(runId)}
      triggerLabel={t("trigger")}
      title={t("title")}
      description={t("description")}
      triggerTestId="run-history-trigger"
      tableTestIdPrefix="run-audit-log-table"
      rowTestIdPrefix="run-audit-log-row"
    />
  );
}

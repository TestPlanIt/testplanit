"use client";

import { ScopedAuditLogSheet } from "@/components/audit/ScopedAuditLogSheet";
import { useTranslations } from "next-intl";

interface RepositoryCaseAuditLogSheetProps {
  caseId: number;
  /** Controlled open state (optional) — e.g. when opened from a menu item. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the built-in trigger button (opened externally instead). */
  hideTrigger?: boolean;
}

/**
 * Activity-history sheet for a single test case. Thin wrapper over the shared
 * ScopedAuditLogSheet; visibility is enforced by the AuditLog read policy, which
 * grants test-case audit access to anyone who can read the case.
 */
export function RepositoryCaseAuditLogSheet({
  caseId,
  open,
  onOpenChange,
  hideTrigger,
}: RepositoryCaseAuditLogSheetProps) {
  const t = useTranslations("repository.auditLog");
  const tCommon = useTranslations("common");

  return (
    <ScopedAuditLogSheet
      entityType="RepositoryCases"
      entityId={String(caseId)}
      triggerLabel={t("trigger")}
      title={tCommon("fields.activityLog")}
      description={t("description")}
      triggerTestId="case-history-trigger"
      tableTestIdPrefix="case-audit-log-table"
      rowTestIdPrefix="case-audit-log-row"
      open={open}
      onOpenChange={onOpenChange}
      hideTrigger={hideTrigger}
    />
  );
}

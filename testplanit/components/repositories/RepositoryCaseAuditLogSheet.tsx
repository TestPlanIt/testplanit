"use client";

import { ScopedAuditLogSheet } from "@/components/audit/ScopedAuditLogSheet";
import { useTranslations } from "next-intl";

interface RepositoryCaseAuditLogSheetProps {
  caseId: number;
}

/**
 * Activity-history sheet for a single test case. Thin wrapper over the shared
 * ScopedAuditLogSheet; visibility is enforced by the AuditLog read policy, which
 * grants test-case audit access to anyone who can read the case.
 */
export function RepositoryCaseAuditLogSheet({
  caseId,
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
    />
  );
}

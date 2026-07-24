"use client";

import { ScopedAuditLogSheet } from "@/components/audit/ScopedAuditLogSheet";
import { useTranslations } from "next-intl";

interface MilestoneAuditLogSheetProps {
  milestoneId: number;
  /** Hide the built-in trigger and drive the sheet from external `open` state. */
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Activity-history sheet for a single milestone. Thin wrapper over the shared
 * ScopedAuditLogSheet; visibility is enforced by the AuditLog read policy, which
 * grants milestone audit access to anyone who can read the milestone's project.
 */
export function MilestoneAuditLogSheet({
  milestoneId,
  hideTrigger,
  open,
  onOpenChange,
}: MilestoneAuditLogSheetProps) {
  const t = useTranslations("milestones.auditLog");
  const tCommon = useTranslations("common");

  return (
    <ScopedAuditLogSheet
      entityType="Milestones"
      entityId={String(milestoneId)}
      triggerLabel={tCommon("fields.activity")}
      title={tCommon("fields.activityLog")}
      description={t("description")}
      triggerTestId="milestone-history-trigger"
      tableTestIdPrefix="milestone-audit-log-table"
      rowTestIdPrefix="milestone-audit-log-row"
      hideTrigger={hideTrigger}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

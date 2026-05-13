"use client";

import { SkipForward, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export interface IterationBulkToolbarProps {
  selectedCount: number;
  onSkip: () => void;
  onCancel: () => void;
}

/**
 * Surface A.6 — Sticky toolbar that appears when at least one iteration row
 * is selected. Only one action button (`Mark Skipped`) — the locked CONTEXT
 * decision dropped `Mark N/A` because the seeded Status table exposes a
 * single Skipped row.
 */
export function IterationBulkToolbar({
  selectedCount,
  onSkip,
  onCancel,
}: IterationBulkToolbarProps) {
  const t = useTranslations("parameters");
  const visible = selectedCount > 0;

  return (
    <div
      data-testid="iteration-bulk-toolbar"
      className={`sticky top-[56px] z-10 bg-card border-b px-4 py-2 h-12 flex items-center justify-between gap-2 ${
        visible ? "" : "hidden"
      }`}
      aria-hidden={visible ? undefined : true}
    >
      <span className="text-xs font-medium">
        {t("iterationSelectedCount", { count: selectedCount })}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onSkip}
          data-testid="iteration-bulk-skip"
        >
          <SkipForward className="mr-1 h-4 w-4" />
          {t("iterationBulkSkip")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          data-testid="iteration-bulk-cancel"
        >
          <X className="mr-1 h-4 w-4" />
          {t("iterationBulkCancel")}
        </Button>
      </div>
    </div>
  );
}

export default IterationBulkToolbar;

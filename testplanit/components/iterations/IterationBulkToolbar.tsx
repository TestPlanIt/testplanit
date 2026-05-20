"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export interface IterationBulkToolbarProps {
  selectedCount: number;
  onSkip: () => void;
  onCancel: () => void;
}

/**
 * Surface A.6 — Sticky toolbar that appears when at least one iteration row
 * is selected. The action button label reads "Mark {count} with status…"
 * — the user picks the actual status in the bulk-confirm dialog (no status
 * is hardcoded in trigger labels per the project-status redesign).
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
      className={`sticky top-[56px] z-10 bg-card border-b px-2 py-2 h-12 flex items-center justify-between ${
        visible ? "" : "hidden"
      }`}
      aria-hidden={visible ? undefined : true}
    >
      <Button
        variant="outline"
        size="sm"
        onClick={onSkip}
        data-testid="iteration-bulk-skip"
      >
        <Plus className="w-4 h-4" />
        {t("iterationBulkSkip", { count: selectedCount })}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onCancel}
        data-testid="iteration-bulk-cancel"
        aria-label={t("iterationBulkCancel")}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default IterationBulkToolbar;

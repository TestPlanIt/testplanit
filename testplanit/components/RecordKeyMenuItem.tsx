"use client";

import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useRecordKey } from "~/hooks/useRecordKeyConfig";
import type { RecordType } from "~/lib/recordKey";

interface RecordKeyMenuItemProps {
  type: RecordType;
  id: number;
  projectKey?: string | null;
  projectId?: number;
}

/**
 * A dropdown-menu entry that copies a record's cosmetic key (e.g. `WEB-TR-1234`)
 * to the clipboard. Renders nothing when the feature is disabled or the project
 * has no code. Used to keep the key available in list rows without cluttering
 * them — it only resolves the key when the menu is opened.
 */
export function RecordKeyMenuItem({
  type,
  id,
  projectKey,
  projectId,
}: RecordKeyMenuItemProps) {
  const t = useTranslations();
  const display = useRecordKey({ type, id, projectKey, projectId });
  if (!display) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(display);
      toast.success(t("common.actions.copied"));
    } catch {
      toast.error(t("common.errors.failedToCopyToClipboard"));
    }
  };

  return (
    <DropdownMenuItem
      onSelect={() => {
        void handleCopy();
      }}
      data-testid={`record-key-copy-${id}`}
    >
      <Copy className="me-2 h-4 w-4" />
      <span className="font-mono">{display}</span>
    </DropdownMenuItem>
  );
}

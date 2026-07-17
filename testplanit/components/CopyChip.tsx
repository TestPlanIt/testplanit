"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "~/utils";

interface CopyChipProps {
  /** The exact text copied to the clipboard and shown in the chip. */
  value: string;
  className?: string;
  testId?: string;
}

/**
 * A small monospace chip that copies its value to the clipboard on click,
 * showing a copy icon (→ checkmark on success) and a tooltip. Used by
 * {@link RecordId} to render a record's id-or-key.
 */
export function CopyChip({ value, className, testId }: CopyChipProps) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("common.errors.failedToCopyToClipboard"));
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          onClick={handleCopy}
          aria-label={`${t("common.actions.copy")} ${value}`}
          className={cn(
            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
            className
          )}
        >
          <span>{value}</span>
          {copied ? (
            <Check className="h-3 w-3" aria-hidden />
          ) : (
            <Copy className="h-3 w-3" aria-hidden />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {copied ? t("common.actions.copied") : t("common.actions.copy")}
      </TooltipContent>
    </Tooltip>
  );
}

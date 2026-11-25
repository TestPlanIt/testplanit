"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ClockAlert, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

export type CaseAttentionKind = "UPDATE" | "RETIRE" | "DRAFT" | "BEHIND";

const LABELS = {
  UPDATE: "updateTitle",
  RETIRE: "retireTitle",
  DRAFT: "unreviewedDraft",
  BEHIND: "issueChangedList",
} as const;

/**
 * Marks a test case in a list that is waiting on a person: a suggested
 * change to decide or an AI draft to review (sparkles), or a linked issue
 * that changed since the case was last checked against it (clock). Fetches
 * nothing: the list loads the kinds for its visible rows.
 */
export function CaseAttentionBadge({
  kind,
}: {
  kind: CaseAttentionKind | undefined;
}) {
  const t = useTranslations("repository.suggestions");
  if (!kind) return null;
  const label = t(LABELS[kind]);
  const Icon = kind === "BEHIND" ? ClockAlert : Sparkles;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            className="inline-flex h-5 w-5 items-center justify-center border-warning bg-warning p-0 text-warning-foreground hover:bg-warning/90 hover:text-warning-foreground"
            data-testid={
              kind === "BEHIND" ? "issue-changed-badge" : "ai-attention-badge"
            }
            aria-label={label}
          >
            <Icon className="h-3 w-3" />
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

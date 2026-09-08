"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isMacPlatform } from "~/hooks/useDragModifier";
import { cn } from "~/utils";

/** Far longer than the app-wide tooltip delay: the chevron is a click target
 *  first, and working down through the groups must not summon a hint over the
 *  next row. Only someone who stops on the chevron gets it. Matches the
 *  repository folder tree's chevron. */
const CHEVRON_HINT_DELAY_MS = 2500;

/**
 * Expand/collapse control for a milestone group header on the run and session
 * lists. Alt-clicking (⌥ on Mac) reaches every group instead of the one — same
 * modifier the repository folder tree uses — so the hover hint names it.
 */
export const MilestoneGroupChevron: React.FC<{
  isOpen: boolean;
  testId: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}> = ({ isOpen, testId, onClick }) => {
  // Both lists show the same hint, so it stays a single string under runs.*
  // rather than one copy per namespace.
  const tRuns = useTranslations("runs");
  const tCommon = useTranslations("common");
  const label = isOpen
    ? tCommon("actions.collapse")
    : tCommon("actions.expand");
  return (
    <TooltipProvider
      delayDuration={CHEVRON_HINT_DELAY_MS}
      // Radix otherwise reopens with no delay at all for a while after the
      // first hint, which is exactly the click-through case.
      skipDelayDuration={0}
      disableHoverableContent
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            aria-label={label}
            data-testid={testId}
            onClick={onClick}
          >
            {/* One rotating chevron rather than swapping two icons: a swap
              can't tween. Closed points at the group's start edge, which
              flips under RTL. */}
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                !isOpen && "-rotate-90 rtl:rotate-90"
              )}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">{label}</p>
          <p className="text-xs text-primary-foreground/65 mt-1">
            {tRuns(
              isMacPlatform()
                ? "milestoneGroup.altHintMac"
                : "milestoneGroup.altHintWin"
            )}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default MilestoneGroupChevron;

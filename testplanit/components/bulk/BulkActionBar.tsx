"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";

import {
  ActionBar,
  ActionOverflow,
  useContainerCompact,
  type OverflowAction,
} from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface BulkActionBarProps {
  /** Number of currently selected items; the bar hides at 0. */
  selectedCount: number;
  onClearSelection: () => void;
  /** Bulk actions, collapsed into a kebab menu on narrow windows. */
  actions: OverflowAction[];
  /** Prefix for data-testid attributes, e.g. "testrun" or "session". */
  testIdPrefix: string;
}

/**
 * Sticky toolbar shown while a list has a multi-selection. The host page owns
 * the selection state and passes its bulk actions; each action's label carries
 * its eligible-item count.
 */
export function BulkActionBar({
  selectedCount,
  onClearSelection,
  actions,
  testIdPrefix,
}: BulkActionBarProps) {
  const tCommon = useTranslations("common");
  const { ref, compact } = useContainerCompact();

  if (selectedCount === 0) return null;

  return (
    <div
      ref={ref}
      data-testid={`${testIdPrefix}-bulk-bar`}
      className="sticky top-0 z-20 mb-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm"
    >
      <ActionBar compact={compact} className="ms-auto gap-2">
        <ActionOverflow
          compact={compact}
          actions={actions}
          menuLabel={tCommon("actions.actionsLabel")}
          menuTestId={`${testIdPrefix}-bulk-menu`}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onClearSelection}
              aria-label={tCommon("actions.deselectAll")}
              data-testid={`${testIdPrefix}-bulk-clear`}
            >
              <X className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{tCommon("actions.deselectAll")}</TooltipContent>
        </Tooltip>
      </ActionBar>
    </div>
  );
}

export default BulkActionBar;

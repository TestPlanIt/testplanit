"use client";

import { MoreHorizontal, Pencil, Plus, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { glyphFromStatus, IterationStatusPip } from "./IterationStatusPip";
import type { IterationMenuAction, IterationStatusDTO } from "./types";

export interface IterationHeaderProps {
  rowIndex: number;
  total: number;
  status?: IterationStatusDTO | null;
  /** Whether this iteration already has a recorded result. */
  hasResult: boolean;
  /** Whether the parent run is completed (disables actions). */
  isRunCompleted: boolean;
  onMenuAction: (action: IterationMenuAction) => void;
}

/**
 * Surface B.2 — Main-panel iteration header above the existing
 * TestRunCaseDetails. Primary discovery point for Override / Skip / Reset.
 */
export function IterationHeader({
  rowIndex,
  total,
  status,
  hasResult,
  isRunCompleted,
  onMenuAction,
}: IterationHeaderProps) {
  const t = useTranslations("parameters");

  const glyph = glyphFromStatus(status ?? null, false);
  const statusColor = status?.color?.value;

  return (
    <header
      className="flex items-center justify-between gap-4 pl-4 pr-12 py-3 border-b bg-muted/30"
      data-testid="iteration-header"
    >
      <h2 className="text-base font-semibold">
        {t("iterationHeaderTitle", { n: rowIndex + 1, total })}
      </h2>
      <div className="flex items-center gap-3 ml-auto">
        {status && (
          <span
            className="inline-flex items-center gap-2 text-sm"
            data-testid="iteration-header-status"
          >
            <IterationStatusPip glyph={glyph} statusColor={statusColor} />
            <span>{status.name}</span>
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              data-testid="iteration-header-menu-trigger"
              aria-label={t("iterationRowMenuAria", { n: rowIndex + 1 })}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => onMenuAction("override")}
              disabled={isRunCompleted}
              data-testid="iteration-header-menu-override-values"
            >
              <Pencil className="mr-2 h-4 w-4" />
              {t("iterationOverrideValues")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onMenuAction("skip")}
              disabled={isRunCompleted}
              data-testid="iteration-header-menu-skip"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("iterationSkip")}
            </DropdownMenuItem>
            {hasResult && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => onMenuAction("reset")}
                  disabled={isRunCompleted}
                  className="text-destructive focus:text-destructive"
                  data-testid="iteration-header-menu-reset"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {t("iterationReset")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export default IterationHeader;

"use client";

import { MoreHorizontal, Pencil, Plus, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { KeyboardEvent, MouseEvent } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { glyphFromStatus, IterationStatusPip } from "./IterationStatusPip";
import {
  formatIterationValue,
  type IterationDTO,
  type IterationMenuAction,
  type IterationParameterMeta,
} from "./types";

export interface IterationRowProps {
  iteration: IterationDTO;
  parametersSchema: IterationParameterMeta[];
  isActive: boolean;
  isSelected: boolean;
  /** Run is completed — row is read-only, menu items disabled. */
  isRunCompleted: boolean;
  /** Whether the bulk-selection band is open anywhere in the sidebar. */
  hasSelection: boolean;
  onActivate: () => void;
  onToggleSelect: () => void;
  onMenuAction: (action: IterationMenuAction) => void;
}

export function IterationRow({
  iteration,
  parametersSchema,
  isActive,
  isSelected,
  isRunCompleted,
  hasSelection,
  onActivate,
  onToggleSelect,
  onMenuAction,
}: IterationRowProps) {
  const t = useTranslations("parameters");

  const glyph = glyphFromStatus(iteration.status ?? null, isActive);
  const statusColor = iteration.status?.color?.value;

  const ordered = [...parametersSchema].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );

  const summaryParts = ordered.slice(0, 2).map((p) => {
    const raw = iteration.valuesJson?.[p.name];
    return `${p.name}: ${formatIterationValue(raw, !!p.sensitive)}`;
  });
  const summary = summaryParts.join(" / ");

  const valuesLines = ordered.length
    ? ordered.map(
        (p) =>
          `${p.name}: ${formatIterationValue(
            iteration.valuesJson?.[p.name],
            !!p.sensitive
          )}`
      )
    : [];
  // Prefix the dataset row label (e.g. "Bad username") above the values
  // so users hovering the row see the same friendly identifier they
  // recognize from the dataset / matrix popover. Falls back to values-only
  // when the iteration has no label.
  const labelLine =
    iteration.label && iteration.label.trim().length > 0
      ? iteration.label
      : null;
  const fullValuesTooltip = [
    ...(labelLine ? [labelLine] : []),
    ...valuesLines,
  ].join("\n");

  const handleRowClick = (e: MouseEvent<HTMLDivElement>) => {
    // Avoid intercepting clicks that bubble up from the checkbox or menu.
    if ((e.target as HTMLElement).closest("[data-iteration-row-stop]")) {
      return;
    }
    onActivate();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onActivate();
      return;
    }
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      onToggleSelect();
    }
  };

  const checkboxVisible = hasSelection || isSelected;
  const rowBg = isActive
    ? "bg-primary/10 border-s-2 border-s-primary"
    : isSelected
      ? "bg-accent/50"
      : "bg-card hover:bg-muted/50";
  const disabledCls =
    isRunCompleted && iteration.isCompleted
      ? "opacity-60 cursor-not-allowed"
      : "";

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`iteration-row-${iteration.rowIndex}`}
      data-active={isActive}
      data-selected={isSelected}
      data-row-index={iteration.rowIndex}
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
      className={`group iteration-row flex items-center gap-2 px-3 py-2 min-h-11 w-full text-start border-b border-border/50 cursor-pointer ${rowBg} ${disabledCls} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1`}
      aria-current={isActive ? "true" : undefined}
    >
      <span
        data-iteration-row-stop=""
        className={`flex items-center justify-center transition-[width] duration-100 ${
          checkboxVisible ? "w-5" : "w-0 group-hover:w-5"
        } overflow-hidden`}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect()}
          onClick={(e) => e.stopPropagation()}
          data-testid={`iteration-row-checkbox-${iteration.rowIndex}`}
          aria-label={t("iterationSelectAria", {
            n: String(iteration.rowIndex + 1),
          })}
        />
      </span>

      <IterationStatusPip glyph={glyph} statusColor={statusColor} />

      <span className="tabular-nums text-sm font-medium w-6 shrink-0">
        {iteration.rowIndex + 1}
      </span>

      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
              {summary}
            </span>
          </TooltipTrigger>
          {fullValuesTooltip && (
            <TooltipContent
              side="right"
              className="whitespace-pre-line max-w-xs"
            >
              {fullValuesTooltip}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      {isActive && (
        <span data-iteration-row-stop="" className="ms-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="iteration-row-menu-trigger"
                onClick={(e) => e.stopPropagation()}
                aria-label={t("iterationRowMenuAria", {
                  n: String(iteration.rowIndex + 1),
                })}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" data-testid="iteration-row-menu">
              <DropdownMenuItem
                onSelect={() => onMenuAction("override")}
                disabled={isRunCompleted}
                data-testid="iteration-menu-override-values"
              >
                <Pencil className="me-2 h-4 w-4" />
                {t("iterationOverrideValues")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => onMenuAction("skip")}
                disabled={isRunCompleted}
                data-testid="iteration-menu-skip"
              >
                <Plus className="me-2 h-4 w-4" />
                {t("iterationSkip")}
              </DropdownMenuItem>
              {iteration.isCompleted && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => onMenuAction("reset")}
                    disabled={isRunCompleted}
                    className="text-destructive focus:text-destructive"
                    data-testid="iteration-menu-reset"
                  >
                    <RotateCcw className="me-2 h-4 w-4" />
                    {t("iterationReset")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      )}
    </div>
  );
}

export default IterationRow;

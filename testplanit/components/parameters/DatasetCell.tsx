"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { cn } from "~/utils";

export type DatasetCellParameterType =
  | "STRING"
  | "INTEGER"
  | "BOOLEAN"
  | "SELECT";

export interface DatasetCellParameter {
  name: string;
  type: DatasetCellParameterType;
  sensitive: boolean;
  required: boolean;
  allowedValuesJson?: unknown;
  lookupAllowedValues?: string[];
}

export interface DatasetCellProps {
  rowId: string | number;
  columnId: string;
  value: unknown;
  parameter?: DatasetCellParameter;
  /** When true, the cell is the per-row label cell (free-text, no parameter type). */
  isLabel?: boolean;
  isEditing: boolean;
  draftValue: unknown;
  error?: string;
  viewerCanReadSensitive: boolean;
  onEdit: () => void;
  onChange: (v: unknown) => void;
  onCommit: () => void;
  onCancel: () => void;
  onTab: (direction: "left" | "right") => void;
  onMoveDown: () => void;
}

/**
 * Type-aware inline cell editor for the dataset grid (Surface D.3).
 * Implements the keyboard contract from UI-SPEC D.2 and the sensitive
 * cell masking model from UI-SPEC D.4.
 *
 * State model (RESEARCH HOW Q4):
 *   - Edit-cell + draftValue + cellErrors are owned by the parent grid;
 *     this component receives them via props and emits change/commit/cancel.
 *   - Pitfall 7 (double-commit): committedRef short-circuits the blur
 *     handler when commit already fired (e.g., from Tab/Enter).
 *   - Pitfall 8 (Sheet close on Esc): Esc handler calls stopPropagation
 *     so a first Esc cancels the cell only; a second Esc closes the Sheet.
 */
export function DatasetCell({
  value,
  parameter,
  isLabel,
  isEditing,
  draftValue,
  error,
  viewerCanReadSensitive,
  onEdit,
  onChange,
  onCommit,
  onCancel,
  onTab,
  onMoveDown,
}: DatasetCellProps) {
  const t = useTranslations("parameters");
  const committedRef = useRef(false);

  useEffect(() => {
    if (isEditing) committedRef.current = false;
  }, [isEditing]);

  const safeCommit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      committedRef.current = true;
      onCancel();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      safeCommit();
      onTab(e.shiftKey ? "left" : "right");
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      safeCommit();
      onMoveDown();
      return;
    }
  };

  // ---------- Read mode ----------
  if (!isEditing) {
    // Sensitive masking gate (UI-SPEC D.4)
    if (parameter?.sensitive) {
      const deniedSentinel =
        value === "[REDACTED]" || !viewerCanReadSensitive;
      if (deniedSentinel) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="text-muted-foreground font-mono cursor-not-allowed"
                data-testid="dataset-cell-sensitive-masked"
              >
                {"••••••"}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t("datasetSensitiveDeniedTooltip")}
            </TooltipContent>
          </Tooltip>
        );
      }
      // Permitted user — show mask until clicked; click triggers edit
      // mode which reveals plaintext (handled by the parent state seeding
      // draftValue from the row's actual value).
      return (
        <span
          className="text-muted-foreground font-mono cursor-pointer"
          onClick={onEdit}
          data-testid="dataset-cell-sensitive-clickable"
        >
          {"••••••"}
        </span>
      );
    }

    // BOOLEAN — direct toggle, no edit-mode boundary (UI-SPEC D.3)
    if (parameter?.type === "BOOLEAN" && !isLabel) {
      return (
        <Checkbox
          checked={Boolean(value)}
          onCheckedChange={(v) => {
            onChange(v);
            safeCommit();
          }}
        />
      );
    }

    // STRING / INTEGER / SELECT / label — read-mode display
    const display =
      value === null || value === undefined ? "" : String(value);
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "block truncate cursor-text",
              parameter?.type === "INTEGER" &&
                "font-mono tabular-nums text-right"
            )}
            onClick={onEdit}
            data-testid="dataset-cell-display"
          >
            {display}
          </span>
        </TooltipTrigger>
        {display.length > 30 && <TooltipContent>{display}</TooltipContent>}
      </Tooltip>
    );
  }

  // ---------- Edit mode ----------
  const cellWrapperClass = cn("relative", error && "border border-destructive");

  // Label cell defaults to STRING editor when no parameter is provided
  const effectiveType: DatasetCellParameterType = isLabel
    ? "STRING"
    : (parameter?.type ?? "STRING");

  switch (effectiveType) {
    case "STRING":
      return (
        <div className={cellWrapperClass}>
          <Input
            autoFocus
            value={String(draftValue ?? "")}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={safeCommit}
            data-testid="dataset-cell-input-string"
          />
          {error ? <CellError message={error} /> : null}
        </div>
      );
    case "INTEGER":
      return (
        <div className={cellWrapperClass}>
          <Input
            type="number"
            inputMode="numeric"
            autoFocus
            value={String(draftValue ?? "")}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={safeCommit}
            data-testid="dataset-cell-input-integer"
          />
          {error ? <CellError message={error} /> : null}
        </div>
      );
    case "SELECT": {
      const options = inferSelectOptions(parameter);
      return (
        <div className={cellWrapperClass}>
          <Select
            value={String(draftValue ?? "")}
            onValueChange={(v) => {
              onChange(v);
              safeCommit();
            }}
          >
            <SelectTrigger data-testid="dataset-cell-input-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error ? <CellError message={error} /> : null}
        </div>
      );
    }
    default:
      return null;
  }
}

function inferSelectOptions(p?: DatasetCellParameter): string[] {
  if (!p) return [];
  if (Array.isArray(p.lookupAllowedValues) && p.lookupAllowedValues.length > 0) {
    return p.lookupAllowedValues.map(String);
  }
  if (Array.isArray(p.allowedValuesJson)) {
    return (p.allowedValuesJson as unknown[]).map(String);
  }
  return [];
}

function CellError({ message }: { message: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="absolute top-0 right-0 p-0.5">
          <AlertCircle
            className="text-destructive w-3 h-3"
            data-testid="dataset-cell-error"
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  );
}

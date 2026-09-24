"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FrozenTruncation } from "~/hooks/useCreateFrozenReportLink";

export type ReportDataMode = "live" | "frozen";

interface ReportDataModeFieldProps {
  value: ReportDataMode;
  onChange: (value: ReportDataMode) => void;
}

/** Live (re-run on open) or frozen (captured now) — for sharing and saving. */
export function ReportDataModeField({
  value,
  onChange,
}: ReportDataModeFieldProps) {
  const t = useTranslations("reports.frozen");
  const tCommon = useTranslations("common");

  return (
    <div className="space-y-3">
      <Label>{tCommon("fields.data")}</Label>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as ReportDataMode)}
      >
        {(["live", "frozen"] as const).map((option) => (
          <div
            key={option}
            className="flex items-start space-x-2 rounded-lg border p-4"
          >
            <RadioGroupItem
              data-testid={`report-data-mode-${option}`}
              value={option}
              id={`report-data-mode-${option}`}
              className="mt-1"
            />
            <div className="flex-1">
              <Label
                htmlFor={`report-data-mode-${option}`}
                className="font-medium cursor-pointer"
              >
                {t(`${option}.title`)}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t(`${option}.description`)}
              </p>
            </div>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}

interface FrozenTruncationWarningProps {
  /** Set when the report is over the row cap; null keeps the popup closed. */
  truncation: FrozenTruncation | null;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The report is over the row cap: ask before saving a copy that keeps only
 * the first rows. Cancel returns to the form; Save submits the truncated copy.
 */
export function FrozenTruncationWarning({
  truncation,
  disabled,
  onCancel,
  onConfirm,
}: FrozenTruncationWarningProps) {
  const t = useTranslations("reports.frozen.truncation");
  const tCommon = useTranslations("common");

  return (
    <AlertDialog
      open={truncation !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent data-testid="frozen-truncation-warning">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
            {t("title")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {truncation &&
              t("description", {
                total: truncation.totalRowCount,
                max: truncation.maxRows,
              })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={disabled}
            data-testid="frozen-truncation-cancel"
          >
            {tCommon("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={disabled}
            onClick={(event) => {
              // Keep the popup up until the save finishes.
              event.preventDefault();
              onConfirm();
            }}
            data-testid="frozen-truncation-confirm"
          >
            {tCommon("actions.save")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
